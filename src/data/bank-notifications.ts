/**
 * Notificações de banco vindas do app Android. Chegam como indícios: o leitor entende o que
 * pode, sugere conta, descrição e categoria, e a pessoa confirma (ou ignora) no site. Só depois
 * de confirmar vira lançamento, pelo mesmo serviço de lançamentos do app.
 */
import { num, type Db } from "@/lib/db";
import { isMoneyAccount, type AccountType } from "@/domain/accounts";
import { notificationDirection, parseBankNotification, type NotificationKind, type ParsedNotification } from "@/domain/bank-notification";
import type { TransactionType } from "@/domain/transactions";
import { UserError, assertUuid } from "./errors";
import { createTransaction } from "./transactions";
import type { DeviceAuth } from "./devices";

export const MAX_BATCH = 50;

export type IncomingNotification = { id: string; package: string; appName?: string | null; title?: string | null; text: string; postedAt: string };

export type Suggestion = {
  type: TransactionType | null;
  description: string;
  accountId: string | null;
  /** Conta encontrada pelo final do cartão ou pelo banco (sem ambiguidade). */
  accountSure: boolean;
  categoryId: string | null;
  installments: number | null;
};

export type BankNotification = {
  id: string;
  package: string;
  appName: string | null;
  title: string | null;
  body: string;
  postedAt: string;
  status: "pending" | "confirmed" | "ignored" | "discarded";
  parsed: ParsedNotification;
  suggestion: Suggestion;
  transactionId: string | null;
  /** Lançamento parecido que já existe (mesmo valor, mesma conta, ±1 dia). */
  similar: { id: string; description: string; date: string } | null;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type AccountRow = { id: string; name: string; type: AccountType; institution: string | null; last4: string | null };

function describe(kind: NotificationKind, who: string | null): string {
  switch (kind) {
    case "pix_out": return who ? `Pix para ${who}` : "Pix enviado";
    case "pix_in": return who ? `Pix de ${who}` : "Pix recebido";
    case "transfer_out": return who ? `Transferência para ${who}` : "Transferência enviada";
    case "transfer_in": return who ? `Transferência de ${who}` : "Transferência recebida";
    case "refund": return who ? `Estorno ${who}` : "Estorno";
    case "payment": return who ? `Pagamento ${who}` : "Pagamento";
    default: return who ?? "Compra";
  }
}

/** Conta pelo final do cartão; senão pelo banco do app; senão, se só houver uma do tipo. */
export function suggestAccount(accounts: AccountRow[], p: ParsedNotification): { accountId: string | null; sure: boolean } {
  const cards = accounts.filter((a) => a.type === "credit_card");
  if (p.last4) {
    const byLast4 = cards.filter((a) => a.last4 === p.last4);
    if (byLast4.length === 1) return { accountId: byLast4[0].id, sure: true };
  }
  const wantsCard = p.kind === "purchase" && !p.debit;
  const pool = wantsCard ? cards : accounts.filter((a) => isMoneyAccount(a.type) && a.type !== "cash" && a.type !== "investment");
  const inst = p.institution ? norm(p.institution) : null;
  if (inst) {
    const byBank = pool.filter((a) => norm(`${a.institution ?? ""} ${a.name}`).includes(inst));
    if (byBank.length === 1) return { accountId: byBank[0].id, sure: true };
  }
  return pool.length === 1 ? { accountId: pool[0].id, sure: false } : { accountId: null, sure: false };
}

function validIncoming(n: IncomingNotification): boolean {
  if (!n || typeof n.id !== "string" || !/^[\w:.-]{1,100}$/.test(n.id)) return false;
  if (typeof n.package !== "string" || !/^[\w.]{1,120}$/.test(n.package)) return false;
  if (typeof n.text !== "string" || !n.text.trim() || n.text.length > 1000) return false;
  const t = Date.parse(n.postedAt);
  return Number.isFinite(t) && t < Date.now() + 86_400_000 && t > Date.now() - 31 * 86_400_000;
}

/** Recebe um lote do celular. Reenviar o mesmo lote não duplica (id do celular é único). */
export async function ingestNotifications(db: Db, device: DeviceAuth, items: IncomingNotification[]): Promise<{ accepted: number; toConfirm: number; duplicates: number; invalid: number }> {
  if (device.paused) throw new UserError("A leitura de notificações está pausada no site.");
  if (!Array.isArray(items) || items.length > MAX_BATCH) throw new UserError(`Envie até ${MAX_BATCH} notificações por vez.`);
  const valid = items.filter(validIncoming);
  if (!valid.length) return { accepted: 0, toConfirm: 0, duplicates: 0, invalid: items.length };
  const { rows: accounts } = await db.query<AccountRow>(
    "SELECT id, name, type, institution, last4 FROM accounts WHERE user_id = $1 AND NOT archived AND type <> 'loan'",
    [device.userId],
  );
  const records = valid.map((n) => {
    const parsed = parseBankNotification({ packageName: n.package, appName: n.appName, title: n.title, text: n.text });
    const direction = notificationDirection(parsed.kind);
    const status = direction && parsed.confidence >= 0.5 ? "pending" : "discarded";
    return { n, parsed, status };
  });
  const { rows } = await db.query<{ id: string; status: string }>(
    `INSERT INTO bank_notifications (user_id, device_id, external_id, package, app_name, title, body, posted_at, status, parsed)
     SELECT $1, $2, d.ext, d.pkg, left(d.app, 80), left(d.title, 200), left(d.body, 1000), d.posted, d.status, d.parsed
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[], $9::text[], $10::jsonb[])
            AS d(ext, pkg, app, title, body, posted, status, parsed)
     ON CONFLICT (user_id, external_id) DO NOTHING
     RETURNING id, status`,
    [
      device.userId, device.deviceId,
      records.map((r) => r.n.id), records.map((r) => r.n.package), records.map((r) => r.n.appName ?? null),
      records.map((r) => r.n.title ?? null), records.map((r) => r.n.text), records.map((r) => new Date(r.n.postedAt).toISOString()),
      records.map((r) => r.status), records.map((r) => JSON.stringify({ ...r.parsed, account: suggestAccount(accounts, r.parsed) })),
    ],
  );
  return {
    accepted: rows.length,
    toConfirm: rows.filter((r) => r.status === "pending").length,
    duplicates: valid.length - rows.length,
    invalid: items.length - valid.length,
  };
}

export async function listNotifications(db: Db, userId: string, status: "pending" | "done" = "pending"): Promise<BankNotification[]> {
  const { rows } = await db.query(
    `SELECT n.*, to_char(n.posted_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS posted_day,
            (SELECT category_id FROM transactions t
              WHERE t.user_id = n.user_id AND t.category_id IS NOT NULL
                AND lower(t.description) = lower(coalesce(n.parsed->>'counterpart', ''))
              ORDER BY t.date DESC LIMIT 1) AS hist_category,
            (SELECT json_build_object('id', t.id, 'description', t.description, 'date', to_char(t.date, 'YYYY-MM-DD'))
               FROM transactions t
              WHERE n.status = 'pending' AND t.user_id = n.user_id AND t.amount_cents = (n.parsed->>'amount')::bigint
                AND (t.account_id = (n.parsed->'account'->>'accountId')::uuid OR (n.parsed->'account'->>'accountId') IS NULL)
                AND t.date BETWEEN (n.posted_at AT TIME ZONE 'America/Sao_Paulo')::date - 1 AND (n.posted_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
              LIMIT 1) AS similar
       FROM bank_notifications n
      WHERE n.user_id = $1 AND ${status === "pending" ? "n.status = 'pending'" : "n.status <> 'pending'"}
      ORDER BY n.posted_at DESC
      LIMIT ${status === "pending" ? 200 : 50}`,
    [userId],
  );
  return rows.map((r) => {
    const parsed = r.parsed as ParsedNotification & { account?: { accountId: string | null; sure: boolean } };
    const direction = notificationDirection(parsed.kind);
    return {
      id: r.id,
      package: r.package,
      appName: r.app_name,
      title: r.title,
      body: r.body,
      postedAt: r.posted_day,
      status: r.status,
      parsed,
      transactionId: r.transaction_id,
      similar: r.similar ?? null,
      suggestion: {
        type: direction,
        description: describe(parsed.kind, parsed.counterpart),
        accountId: parsed.account?.accountId ?? null,
        accountSure: parsed.account?.sure ?? false,
        categoryId: r.hist_category ?? null,
        installments: parsed.installments,
      },
    };
  });
}

export async function countPendingNotifications(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query("SELECT count(*) AS n FROM bank_notifications WHERE user_id = $1 AND status = 'pending'", [userId]);
  return num(rows[0].n);
}

export type ConfirmInput = {
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  installments?: number | null;
};

/** Confirma: lança pelo serviço do app (a própria notificação é a chave: não lança duas vezes). */
export async function confirmNotification(db: Db, userId: string, id: string, input: ConfirmInput): Promise<string | null> {
  assertUuid(id, "Notificação não encontrada.");
  const { rows } = await db.query<{ status: string }>("SELECT status FROM bank_notifications WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!rows[0]) throw new UserError("Notificação não encontrada.");
  if (rows[0].status !== "pending") throw new UserError("Essa notificação já foi resolvida.");
  const installments = input.installments && input.installments > 1 ? input.installments : undefined;
  const ids = await createTransaction(db, userId, {
    type: input.type,
    description: input.description,
    amount: input.amount,
    date: input.date,
    paid: true,
    accountId: input.accountId,
    toAccountId: input.toAccountId ?? null,
    categoryId: input.categoryId ?? null,
    installments: input.type === "expense" ? installments : undefined,
    amountIsTotal: true,
    submissionKey: id,
  });
  await db.query(
    `UPDATE bank_notifications SET status = 'confirmed', decided_at = now(), transaction_id = coalesce($3::uuid, transaction_id)
      WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [id, userId, ids[0] ?? null],
  );
  return ids[0] ?? null;
}

export async function ignoreNotification(db: Db, userId: string, id: string): Promise<void> {
  assertUuid(id, "Notificação não encontrada.");
  const { rowCount } = await db.query(
    "UPDATE bank_notifications SET status = 'ignored', decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending'",
    [id, userId],
  );
  if (!rowCount) throw new UserError("Notificação não encontrada ou já resolvida.");
}

