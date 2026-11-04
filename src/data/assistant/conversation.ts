/**
 * Conversa do assistente: recebe uma mensagem já verificada (o webhook confere a assinatura),
 * descobre de quem é, entende o pedido e responde. Lançamentos nunca são gravados direto:
 * viram uma operação pendente, mostrada para confirmação, e só então passam pelo mesmo
 * createTransaction do app (que valida contas, categorias, valores e posse dos dados).
 */
import type { Db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { accountTypes } from "@/domain/accounts";
import {
  buildDraft,
  detectIntent,
  findAccounts,
  findAmount,
  missingField,
  normalize,
  type AccountRef,
  type Draft,
} from "@/domain/assistant/parser";
import { listAccountOptions, listAccounts } from "../accounts";
import { listCategoryOptions } from "../categories";
import { UserError } from "../errors";
import { allowAttempt } from "../rate-limit";
import { createTransaction, searchTransactions, setPaid } from "../transactions";
import { getLinkByPhone, redeemLinkCode, type WhatsappLink } from "./link";
import { answerQuery } from "./queries";

/** Quanto tempo uma operação espera confirmação. */
export const PENDING_MINUTES = 15;

export type IncomingMessage = { id: string; phone: string; text: string };
export type HandleResult = { reply: string | null; duplicate?: boolean };

type MarkPaidDraft = { operation: "mark_paid"; transactionId: string; description: string; amount: number; date: string };
type PendingDraft = Draft | MarkPaidDraft;
type PendingOp = { id: string; draft: PendingDraft; missing: string | null };

const HELP = [
  "*Assistente OIKON* — exemplos:",
  "• _Gastei 45 reais com almoço no Nubank_",
  "• _Recebi 3900 de salário no Inter_",
  "• _Transferi 300 do Nubank para o Inter_",
  "• _Comprei 900 em 3 vezes no cartão C6_",
  "• _Paguei 500 da fatura do C6 usando o Inter_",
  "• _Adicionar conta de energia de 180 para dia 15_",
  "• _Quanto tenho de dinheiro?_  _Quanto gastei este mês?_",
  "• _Quais contas vencem amanhã?_  _Resumo do mês_",
  "Antes de gravar qualquer lançamento eu mostro um resumo para você confirmar.",
].join("\n");

const NOT_LINKED = [
  "Este número ainda não está vinculado ao OIKON.",
  "No app, abra *Configurações → WhatsApp*, gere o código e envie aqui: *vincular 123456*.",
].join("\n");

const LIMITS = {
  perPhone: { limit: 20, windowSeconds: 60 },
  linkPerPhone: { limit: 5, windowSeconds: 10 * 60 },
};

export async function handleIncomingMessage(db: Db, msg: IncomingMessage, now = new Date()): Promise<HandleResult> {
  const body = msg.text.slice(0, 2000);
  const inserted = await db.query(
    "INSERT INTO whatsapp_messages (id, phone, body) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id",
    [msg.id, msg.phone, body],
  );
  // Webhook reenviado: já tratado, não responde de novo.
  if (!inserted.rowCount) return { reply: null, duplicate: true };

  let userId: string | null = null;
  try {
    if (!(await allowAttempt(db, `wa:${msg.phone}`, LIMITS.perPhone))) {
      return await finish(db, msg.id, null, "Muitas mensagens em pouco tempo. Espere um minuto e tente de novo.", "ignored");
    }
    const n = normalize(body);
    const intent = detectIntent(n);

    if (intent.kind === "link") {
      if (!(await allowAttempt(db, `wa-link:${msg.phone}`, LIMITS.linkPerPhone))) {
        return await finish(db, msg.id, null, "Muitas tentativas de vínculo. Gere um código novo no app daqui a 10 minutos.", "ignored");
      }
      userId = await redeemLinkCode(db, msg.phone, intent.code);
      const reply = userId
        ? "WhatsApp vinculado ao OIKON. ✅\nEnvie *ajuda* para ver o que posso fazer."
        : "Código inválido ou vencido. Gere um novo em *Configurações → WhatsApp* no app.";
      return await finish(db, msg.id, userId, reply, "processed");
    }

    const link = await getLinkByPhone(db, msg.phone);
    if (!link) return await finish(db, msg.id, null, NOT_LINKED, "processed");
    userId = link.userId;
    if (link.status === "paused") {
      return await finish(db, msg.id, userId, "O assistente está pausado. Reative em *Configurações → WhatsApp* no app.", "processed");
    }

    const reply = await respond(db, link, body, n, intent, now);
    return await finish(db, msg.id, userId, reply, "processed");
  } catch (err) {
    const known = err instanceof UserError;
    if (!known) console.error("whatsapp: erro ao processar mensagem", { id: msg.id, err });
    const reply = known ? err.message : "Não consegui processar agora. Tente de novo em instantes.";
    return await finish(db, msg.id, userId, reply, "error", known ? err.message : err instanceof Error ? err.name : "erro");
  }
}

async function finish(db: Db, id: string, userId: string | null, reply: string | null, status: string, error?: string): Promise<HandleResult> {
  await db.query("UPDATE whatsapp_messages SET user_id = $2, reply = $3, status = $4, error = $5 WHERE id = $1", [
    id,
    userId,
    reply?.slice(0, 4096) ?? null,
    status,
    error?.slice(0, 500) ?? null,
  ]);
  return { reply };
}

async function respond(db: Db, link: WhatsappLink, text: string, n: string, intent: ReturnType<typeof detectIntent>, now: Date): Promise<string> {
  const userId = link.userId;
  const pending = await openPending(db, userId);

  switch (intent.kind) {
    case "help":
      return HELP;
    case "cancel": {
      if (!pending) return "Não há nenhuma operação esperando confirmação.";
      await db.query("UPDATE whatsapp_pending_ops SET state = 'cancelled', closed_at = now() WHERE id = $1 AND state = 'open'", [pending.id]);
      return "Operação cancelada. Nada foi registrado.";
    }
    case "confirm": {
      if (!pending) return "Não há nenhuma operação esperando confirmação (ou ela passou de 15 minutos).";
      if (pending.missing) return await askFor(db, userId, pending.draft as Draft, pending.missing);
      return await execute(db, userId, pending, now);
    }
    case "query":
      return await answerQuery(db, userId, intent.query, text, now);
    case "mark_paid":
      if (!link.allowEntries) return "Lançamentos pelo WhatsApp estão desativados nas configurações.";
      return await proposeMarkPaid(db, userId, n, now);
    case "entry": {
      if (!link.allowEntries) return "Lançamentos pelo WhatsApp estão desativados nas configurações.";
      const accounts = await listAccountOptions(db, userId);
      const categories = await listCategoryOptions(db, userId);
      const draft = buildDraft(text, intent.operation, { accounts, categories, now, scheduled: intent.scheduled });
      // Conta padrão só quando configurada e sem ambiguidade (transferência precisa das duas pontas).
      if (!draft.accountId && draft.operation !== "transfer" && link.defaultAccountId && accounts.some((a) => a.id === link.defaultAccountId)) {
        draft.accountId = link.defaultAccountId;
      }
      return await saveDraft(db, userId, draft, accounts);
    }
    case "unknown":
    case "link": {
      // Resposta ao que perguntei ("Foi em qual conta?" -> "Nubank"): continua a operação aberta.
      if (pending?.missing) return await fillMissing(db, userId, pending, text, n);
      return "Não entendi. 🤔 Envie *ajuda* para ver exemplos do que posso fazer.";
    }
  }
}

async function openPending(db: Db, userId: string): Promise<PendingOp | null> {
  await db.query("UPDATE whatsapp_pending_ops SET state = 'expired', closed_at = now() WHERE user_id = $1 AND state = 'open' AND expires_at <= now()", [userId]);
  const { rows } = await db.query("SELECT id, draft, missing FROM whatsapp_pending_ops WHERE user_id = $1 AND state = 'open'", [userId]);
  return rows[0] ? { id: rows[0].id, draft: rows[0].draft, missing: rows[0].missing } : null;
}

/** Guarda a operação (substituindo a anterior, se houver) e pergunta o que falta ou pede confirmação. */
async function saveDraft(db: Db, userId: string, draft: PendingDraft, accounts: AccountRef[]): Promise<string> {
  const missing = draft.operation === "mark_paid" ? null : missingField(draft);
  await db.query("UPDATE whatsapp_pending_ops SET state = 'cancelled', closed_at = now() WHERE user_id = $1 AND state = 'open'", [userId]);
  await db.query(
    `INSERT INTO whatsapp_pending_ops (user_id, draft, missing, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, JSON.stringify(draft), missing, PENDING_MINUTES],
  );
  if (missing) return askFor(db, userId, draft as Draft, missing, accounts);
  return confirmationText(draft, accounts, await listCategoryOptions(db, userId));
}

async function askFor(db: Db, userId: string, draft: Draft, missing: string, accounts?: AccountRef[]): Promise<string> {
  if (missing === "amount") return "Qual foi o valor?";
  const list = accounts ?? (await listAccountOptions(db, userId));
  const options = list
    .filter((a) => (missing === "destination" ? a.id !== draft.accountId : true))
    .map((a) => `• ${a.name}`)
    .join("\n");
  if (!list.length) return "Você ainda não tem contas cadastradas. Crie uma no app primeiro.";
  const question =
    missing === "destination"
      ? "Para qual conta foi a transferência?"
      : draft.operation === "transfer"
        ? "De qual conta saiu o dinheiro?"
        : draft.operation === "income"
          ? "Entrou em qual conta?"
          : "Foi em qual conta ou cartão?";
  return `${question}\n${options}`;
}

async function fillMissing(db: Db, userId: string, pending: PendingOp, text: string, n: string): Promise<string> {
  const draft = pending.draft as Draft;
  const accounts = await listAccountOptions(db, userId);
  if (pending.missing === "amount") {
    const amount = findAmount(text);
    if (!amount) return "Não achei o valor. Escreva só o número, por exemplo: 45,90";
    draft.amount = amount.cents;
  } else {
    const found = findAccounts(n, accounts)[0]?.account;
    if (!found) return `Não achei essa conta. ${await askFor(db, userId, draft, pending.missing!, accounts)}`;
    if (pending.missing === "destination") draft.destinationAccountId = found.id;
    else draft.accountId = found.id;
  }
  return saveDraft(db, userId, draft, accounts);
}

function confirmationText(draft: PendingDraft, accounts: AccountRef[], categories: Array<{ id: string; name: string }>): string {
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—";
  if (draft.operation === "mark_paid") {
    return [`*Marcar como pago?*`, `${draft.description}: ${formatMoney(draft.amount)}`, `Vencimento: ${formatDate(draft.date)}`, "", "Responda *sim* para confirmar ou *não* para cancelar."].join("\n");
  }
  const type = { expense: "Despesa", income: "Receita", transfer: "Transferência entre contas" }[draft.operation];
  const account = accounts.find((a) => a.id === draft.accountId);
  const isCard = account?.type === "credit_card";
  const lines = [
    "*Confirme o lançamento:*",
    `Tipo: ${type}${draft.paid ? "" : " (agendada, fica pendente)"}`,
    `Valor: ${formatMoney(draft.amount ?? 0)}${draft.installments ? ` em ${draft.installments}x` : ""}`,
    draft.operation === "transfer" ? null : `Descrição: ${draft.description}`,
    draft.operation === "transfer" ? null : `Categoria: ${categories.find((c) => c.id === draft.categoryId)?.name ?? "Sem categoria"}`,
    draft.operation === "transfer" ? `De: ${name(draft.accountId)}` : `${draft.operation === "income" ? "Conta" : isCard ? "Cartão" : "Conta"}: ${name(draft.accountId)}${account ? ` (${accountTypes[account.type as keyof typeof accountTypes] ?? account.type})` : ""}`,
    draft.operation === "transfer" ? `Para: ${name(draft.destinationAccountId)}` : null,
    `Data: ${formatDate(draft.date)}${draft.repeatMonths ? ` · repete todo mês (${draft.repeatMonths} meses)` : ""}`,
    "",
    "Responda *sim* para confirmar ou *não* para cancelar.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/**
 * Confirma: fecha a operação numa única atualização (duas confirmações seguidas não gravam
 * duas vezes) e grava pelo serviço do app, com a própria operação como chave de envio.
 */
async function execute(db: Db, userId: string, pending: PendingOp, now: Date): Promise<string> {
  const claim = await db.query(
    "UPDATE whatsapp_pending_ops SET state = 'confirmed', closed_at = now() WHERE id = $1 AND user_id = $2 AND state = 'open' AND expires_at > now() RETURNING id",
    [pending.id, userId],
  );
  if (!claim.rowCount) return "Essa operação já foi confirmada, cancelada ou passou do prazo.";
  const draft = pending.draft;
  try {
    if (draft.operation === "mark_paid") {
      await setPaid(db, userId, draft.transactionId, true, now);
      await db.query("UPDATE whatsapp_pending_ops SET transaction_ids = ARRAY[$2::uuid] WHERE id = $1", [pending.id, draft.transactionId]);
      return `Marcado como pago: ${draft.description} (${formatMoney(draft.amount)}).`;
    }
    const ids = await createTransaction(db, userId, {
      type: draft.operation,
      description: draft.description,
      amount: draft.amount ?? 0,
      date: draft.date,
      paid: draft.paid,
      accountId: draft.accountId ?? "",
      toAccountId: draft.destinationAccountId,
      categoryId: draft.categoryId,
      installments: draft.installments ?? undefined,
      amountIsTotal: true,
      repeat: draft.installments ? undefined : draft.repeatMonths ?? 1,
      submissionKey: pending.id,
    });
    await db.query("UPDATE whatsapp_pending_ops SET transaction_ids = $2 WHERE id = $1", [pending.id, ids]);
    const accounts = await listAccounts(db, userId, now);
    const account = accounts.find((a) => a.id === draft.accountId);
    const destination = accounts.find((a) => a.id === draft.destinationAccountId);
    const label = { expense: "Despesa registrada", income: "Receita registrada", transfer: "Transferência registrada" }[draft.operation];
    return [
      `${label} com sucesso. ✅`,
      `Valor: ${formatMoney(draft.amount ?? 0)}${draft.installments ? ` em ${draft.installments}x` : ""}`,
      draft.operation === "transfer"
        ? `${account?.name}: ${formatMoney(account?.balance ?? 0)} · ${destination?.name}: ${formatMoney(destination?.balance ?? 0)}`
        : `${account?.type === "credit_card" ? "Cartão" : "Conta"}: ${account?.name}`,
      draft.operation !== "transfer" && account
        ? account.type === "credit_card"
          ? `Fatura em aberto no cartão: ${formatMoney(Math.max(0, -account.balance))}`
          : `Novo saldo: ${formatMoney(account.balance)}${draft.paid ? "" : " (agendada: só muda quando for paga)"}`
        : null,
    ].filter(Boolean).join("\n");
  } catch (err) {
    await db.query("UPDATE whatsapp_pending_ops SET state = 'failed' WHERE id = $1", [pending.id]);
    if (err instanceof UserError) return `Não registrei: ${err.message}`;
    throw err;
  }
}

/** "Marcar conta de água como paga": procura pendentes com essas palavras e pede confirmação. */
async function proposeMarkPaid(db: Db, userId: string, n: string, now: Date): Promise<string> {
  const words = n
    .replace(/^marca(r)?\s+|\s+como pag[oa]$|^(ja )?paguei a conta de\s*/g, "")
    .split(" ")
    .filter((w) => w.length > 2 && !["conta", "contas", "de", "da", "do"].includes(w));
  if (!words.length) return "Qual conta? Exemplo: _marcar conta de água como paga_";
  const { items } = await searchTransactions(db, userId, { search: words[words.length - 1], limit: 50 });
  const candidates = items.filter((t) => !t.paid && t.type !== "income").sort((a, b) => a.date.localeCompare(b.date));
  if (!candidates.length) return `Não achei conta pendente com "${words.join(" ")}".`;
  const t = candidates[0];
  const accounts = await listAccountOptions(db, userId);
  const draft: MarkPaidDraft = { operation: "mark_paid", transactionId: t.id, description: t.description, amount: t.amount, date: t.date };
  const note = candidates.length > 1 ? `\n(Há ${candidates.length} pendentes; escolhi a que vence primeiro.)` : "";
  return (await saveDraft(db, userId, draft, accounts)) + note;
}
