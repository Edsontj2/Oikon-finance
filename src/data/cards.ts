/**
 * Cartões de crédito: configurações, faturas e as operações da fatura. Tudo que mexe em
 * dinheiro passa por createTransaction (mesma validação, mesma chave anti-duplicidade e a
 * mesma regra de saldo do resto do app); aqui só se decide o que lançar.
 */
import type { Pool } from "pg";
import { inTransaction, num, type Db } from "@/lib/db";
import { isValidDate, isValidMonth, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { UserError, assertUuid, isUuid } from "./errors";
import { isValidCents, LIMITS, TOO_BIG, requiredText } from "@/domain/limits";
import { MAX_REPEAT } from "@/domain/transactions";
import {
  buildInvoices,
  cardKinds,
  currentInvoice,
  futureCommitment,
  invoiceMonthFor,
  invoiceToPay,
  isChargeKind,
  limitUsage,
  type CardCycle,
  type CardEntry,
  type CardKind,
  type ChargeKind,
  type Invoice,
} from "@/domain/cards";
import { createTransaction } from "./transactions";

export type CardSettings = {
  creditLimit: number | null;
  closingDay: number | null;
  dueDay: number | null;
  payerAccountId: string | null;
  brand: string | null;
  last4: string | null;
};

export type Card = CardSettings & {
  id: string;
  name: string;
  /** Saldo do cartão hoje (negativo = deve). */
  balance: number;
  /** Com parcelas e lançamentos futuros. */
  projectedBalance: number;
  payerAccountName: string | null;
  limit: ReturnType<typeof limitUsage>;
  /** Fatura recebendo compras agora. */
  current: Invoice | null;
  /** Fatura fechada ainda não quitada (a que precisa pagar). */
  toPay: Invoice | null;
  /** Total das próximas faturas, para ver o limite comprometido nos próximos meses. */
  upcoming: { month: string; amount: number }[];
  configured: boolean;
};

export type CardDetail = Card & { invoices: Invoice[] };

type CardRow = Record<string, unknown>;

async function cardRows(db: Db, userId: string, todayStr: string, cardId?: string): Promise<CardRow[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.initial_balance_cents, a.credit_limit_cents, a.closing_day, a.due_day,
            a.payer_account_id, p.name AS payer_name, a.brand, a.last4, to_char(a.created_at, 'YYYY-MM-DD') AS created,
            a.initial_balance_cents + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e
               WHERE e.account_id = a.id AND e.paid AND e.date <= $2::date), 0) AS balance,
            a.initial_balance_cents + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e
               WHERE e.account_id = a.id), 0) AS projected
       FROM accounts a
       LEFT JOIN accounts p ON p.id = a.payer_account_id
      WHERE a.user_id = $1 AND a.type = 'credit_card' AND ($3::uuid IS NULL OR a.id = $3::uuid)
      ORDER BY a.created_at, a.name`,
    [userId, todayStr, cardId ?? null],
  );
  return rows;
}

/** Lançamentos do cartão (compras, estornos e pagamentos recebidos), de vários cartões de uma vez. */
async function cardEntries(db: Db, userId: string, cardIds: string[], todayStr: string): Promise<Map<string, CardEntry[]>> {
  const map = new Map<string, CardEntry[]>(cardIds.map((id) => [id, []]));
  if (!cardIds.length) return map;
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.description, t.amount_cents, to_char(t.date, 'YYYY-MM-DD') AS date, t.paid,
            t.account_id, t.to_account_id, t.card_kind, t.invoice_month, t.installment_number, t.installment_count,
            c.name AS category_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = $1 AND (t.account_id = ANY($2::uuid[]) OR t.to_account_id = ANY($2::uuid[]))
      ORDER BY t.date, t.created_at`,
    [userId, cardIds],
  );
  for (const r of rows) {
    const base = {
      id: r.id,
      date: r.date,
      amount: num(r.amount_cents),
      description: r.description,
      cardKind: r.card_kind as CardKind | null,
      invoiceMonth: r.invoice_month,
      installmentNumber: r.installment_number === null ? null : Number(r.installment_number),
      installmentCount: r.installment_count === null ? null : Number(r.installment_count),
      categoryName: r.category_name,
    };
    const settled = r.paid && r.date <= todayStr;
    if (map.has(r.account_id)) {
      // Saída do cartão (compra) ou transferência saindo dele: aumenta a fatura. Entrada: crédito.
      const kind = r.type === "income" ? "credit" : "charge";
      map.get(r.account_id)!.push({ ...base, kind, settled });
    }
    if (r.to_account_id && map.has(r.to_account_id)) {
      map.get(r.to_account_id)!.push({ ...base, kind: "payment", settled });
    }
  }
  return map;
}

function cycleOf(r: CardRow): CardCycle {
  return { closingDay: r.closing_day === null ? null : Number(r.closing_day), dueDay: r.due_day === null ? null : Number(r.due_day) };
}

function toCard(r: CardRow, entries: CardEntry[], todayStr: string): CardDetail {
  const cycle = cycleOf(r);
  const initial = num(r.initial_balance_cents);
  const invoices = buildInvoices(entries, cycle, todayStr, -initial, invoiceMonthFor(r.created as string, cycle));
  const creditLimit = r.credit_limit_cents === null ? null : num(r.credit_limit_cents);
  const projectedBalance = num(r.projected);
  return {
    id: r.id as string,
    name: r.name as string,
    creditLimit,
    closingDay: cycle.closingDay,
    dueDay: cycle.dueDay,
    payerAccountId: (r.payer_account_id as string) ?? null,
    payerAccountName: (r.payer_name as string) ?? null,
    brand: (r.brand as string) ?? null,
    last4: (r.last4 as string) ?? null,
    balance: num(r.balance),
    projectedBalance,
    limit: limitUsage(creditLimit, projectedBalance),
    current: currentInvoice(invoices, todayStr, cycle) ?? null,
    toPay: invoiceToPay(invoices) ?? null,
    upcoming: futureCommitment(invoices, todayStr),
    configured: cycle.closingDay !== null && cycle.dueDay !== null,
    invoices,
  };
}

/** Todos os cartões com todas as faturas (para previsões). */
export async function listCardDetails(db: Db, userId: string, now = new Date()): Promise<CardDetail[]> {
  const todayStr = today(now);
  const rows = await cardRows(db, userId, todayStr);
  const entries = await cardEntries(db, userId, rows.map((r) => r.id as string), todayStr);
  return rows.map((r) => toCard(r, entries.get(r.id as string) ?? [], todayStr));
}

/** Todos os cartões, com a fatura atual, a que falta pagar e o limite. */
export async function listCards(db: Db, userId: string, now = new Date()): Promise<Card[]> {
  return (await listCardDetails(db, userId, now)).map(({ invoices: _all, ...card }) => card);
}

/** Um cartão com todas as faturas (da primeira até a última parcela lançada). */
export async function getCard(db: Db, userId: string, cardId: string, now = new Date()): Promise<CardDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return null;
  const todayStr = today(now);
  const [row] = await cardRows(db, userId, todayStr, cardId);
  if (!row) return null;
  const entries = await cardEntries(db, userId, [cardId], todayStr);
  return toCard(row, entries.get(cardId) ?? [], todayStr);
}

async function requireCard(db: Db, userId: string, cardId: string, now: Date): Promise<CardDetail> {
  assertUuid(cardId, "Cartão não encontrado.");
  const card = await getCard(db, userId, cardId, now);
  if (!card) throw new UserError("Cartão não encontrado.");
  return card;
}

function dayField(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 31) throw new UserError(`${label} deve ser um dia entre 1 e 31.`);
  return value;
}

/** Salva limite, fechamento, vencimento, conta pagadora, bandeira e final. Mudança de limite vai para o histórico. */
export async function updateCardSettings(db: Db, userId: string, cardId: string, input: CardSettings): Promise<void> {
  assertUuid(cardId, "Cartão não encontrado.");
  const closingDay = dayField(input.closingDay, "O fechamento");
  const dueDay = dayField(input.dueDay, "O vencimento");
  if ((closingDay === null) !== (dueDay === null)) throw new UserError("Informe o dia de fechamento e o de vencimento.");
  if (closingDay !== null && closingDay === dueDay) throw new UserError("Fechamento e vencimento precisam ser dias diferentes.");
  const limit = input.creditLimit;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) throw new UserError("O limite precisa ser maior que zero.");
  if (limit !== null && !isValidCents(limit)) throw new UserError(TOO_BIG);
  const brand = input.brand?.trim() ? requiredText(input.brand, 30, "", "A bandeira") : null;
  const last4 = input.last4?.trim() || null;
  if (last4 !== null && !/^[0-9]{4}$/.test(last4)) throw new UserError("O final do cartão são os 4 últimos números.");
  if (input.payerAccountId) {
    assertUuid(input.payerAccountId, "Conta pagadora não encontrada.");
    const own = await db.query("SELECT type FROM accounts WHERE id = $1 AND user_id = $2", [input.payerAccountId, userId]);
    if (!own.rows[0] || input.payerAccountId === cardId) throw new UserError("Conta pagadora não encontrada.");
    if (own.rows[0].type === "credit_card") throw new UserError("A fatura é paga por uma conta, não por outro cartão.");
  }
  const { rows } = await db.query<{ old_limit: string | null }>(
    `WITH old AS (SELECT credit_limit_cents FROM accounts WHERE id = $1 AND user_id = $2 AND type = 'credit_card' FOR UPDATE)
     UPDATE accounts a
        SET credit_limit_cents = $3, closing_day = $4, due_day = $5, payer_account_id = $6, brand = $7, last4 = $8
       FROM old
      WHERE a.id = $1 AND a.user_id = $2
      RETURNING old.credit_limit_cents AS old_limit`,
    [cardId, userId, limit, closingDay, dueDay, input.payerAccountId || null, brand, last4],
  );
  if (!rows.length) throw new UserError("Cartão não encontrado.");
  const oldLimit = rows[0].old_limit === null ? null : num(rows[0].old_limit);
  if (oldLimit !== limit) {
    await db.query("INSERT INTO card_limit_changes (user_id, account_id, limit_cents) VALUES ($1, $2, $3)", [userId, cardId, limit]);
  }
}

export async function limitHistory(db: Db, userId: string, cardId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return [];
  const { rows } = await db.query(
    `SELECT limit_cents, changed_at FROM card_limit_changes WHERE user_id = $1 AND account_id = $2 ORDER BY changed_at DESC LIMIT 20`,
    [userId, cardId],
  );
  return rows.map((r) => ({ limit: r.limit_cents === null ? null : num(r.limit_cents), changedAt: (r.changed_at as Date).toISOString() }));
}

function amountField(amount: number, label = "O valor"): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError(`${label} precisa ser maior que zero.`);
  if (!isValidCents(amount)) throw new UserError(TOO_BIG);
  return amount;
}

function dateField(date: string | undefined, now: Date): string {
  const d = date || today(now);
  if (!isValidDate(d)) throw new UserError("Data inválida.");
  return d;
}

function monthField(month: string | null | undefined): string | null {
  if (!month) return null;
  if (!isValidMonth(month)) throw new UserError("Fatura inválida.");
  return month;
}

export type InvoicePayment = {
  /** Centavos; pode ser menor que a fatura (pagamento parcial, o resto vai para o rotativo). */
  amount: number;
  fromAccountId: string;
  date?: string;
  /** false = só agendar (fica pendente até marcar como pago). */
  paid?: boolean;
  submissionKey?: string | null;
};

/** Pagamento da fatura = transferência da conta pagadora para o cartão (não é uma nova despesa). */
export async function payInvoice(db: Db, userId: string, cardId: string, input: InvoicePayment, now = new Date()) {
  const card = await requireCard(db, userId, cardId, now);
  const amount = amountField(input.amount);
  const date = dateField(input.date, now);
  if (input.fromAccountId === cardId) throw new UserError("Escolha a conta que vai pagar a fatura.");
  const ids = await createTransaction(db, userId, {
    type: "transfer",
    description: `Pagamento da fatura ${card.name}`,
    amount,
    date,
    paid: input.paid !== false,
    accountId: input.fromAccountId,
    toAccountId: cardId,
    submissionKey: input.submissionKey,
  });
  return ids;
}

export type Refund = { amount: number; description: string; date?: string; categoryId?: string | null; invoiceMonth?: string | null; submissionKey?: string | null };

/** Estorno: crédito no cartão. Nos relatórios abate o gasto (não vira receita). */
export async function addRefund(db: Db, userId: string, cardId: string, input: Refund, now = new Date()) {
  await requireCard(db, userId, cardId, now);
  const description = requiredText(input.description || "Estorno", LIMITS.description, "Informe a descrição.", "A descrição");
  return createTransaction(db, userId, {
    type: "income",
    description,
    amount: amountField(input.amount),
    date: dateField(input.date, now),
    paid: true,
    accountId: cardId,
    categoryId: input.categoryId || null,
    cardKind: "refund",
    invoiceMonth: monthField(input.invoiceMonth),
    submissionKey: input.submissionKey,
  });
}

export type Charge = { kind: ChargeKind; amount: number; description?: string; date?: string; invoiceMonth?: string | null; submissionKey?: string | null };

/** Juros, multa/tarifa/anuidade ou IOF: o valor que o banco cobrou, lançado como saída do cartão. */
export async function addCharge(db: Db, userId: string, cardId: string, input: Charge, now = new Date()) {
  await requireCard(db, userId, cardId, now);
  if (!isChargeKind(input.kind)) throw new UserError("Escolha o tipo de encargo.");
  const description = input.description?.trim() || cardKinds[input.kind];
  return createTransaction(db, userId, {
    type: "expense",
    description: requiredText(description, LIMITS.description, "Informe a descrição.", "A descrição"),
    amount: amountField(input.amount),
    date: dateField(input.date, now),
    paid: true,
    accountId: cardId,
    cardKind: input.kind,
    invoiceMonth: monthField(input.invoiceMonth),
    submissionKey: input.submissionKey,
  });
}

export type InvoicePlan = { month: string; count: number; installmentAmount: number; submissionKey?: string | null };

/**
 * Parcelamento da fatura em N vezes de um valor (o que o banco ofereceu, já com juros).
 * Lança: um crédito que quita a fatura, as N parcelas nas próximas faturas e, se as parcelas
 * somam mais do que se devia, a diferença como juros (é o único gasto novo: a compra já contou).
 */
export async function installInvoice(db: Db, userId: string, cardId: string, input: InvoicePlan, now = new Date()) {
  const key = input.submissionKey ?? null;
  // Reenvio do mesmo formulário (a fatura já foi parcelada com esta chave): não faz nada.
  if (key && isUuid(key)) {
    const used = await db.query("SELECT 1 FROM form_submissions WHERE user_id = $1 AND key = $2", [userId, key]);
    if (used.rows.length) return [];
  }
  const card = await requireCard(db, userId, cardId, now);
  const month = monthField(input.month);
  const invoice = card.invoices.find((i) => i.month === month);
  if (!invoice) throw new UserError("Fatura não encontrada.");
  if (invoice.status === "open" || invoice.status === "future") throw new UserError("Só dá para parcelar uma fatura fechada.");
  if (invoice.remaining <= 0) throw new UserError("Essa fatura não tem saldo a pagar.");
  const count = input.count;
  if (!Number.isInteger(count) || count < 2 || count > MAX_REPEAT) throw new UserError(`Parcelas devem ser entre 2 e ${MAX_REPEAT}.`);
  const each = amountField(input.installmentAmount, "O valor da parcela");
  const total = each * count;
  if (!isValidCents(total)) throw new UserError(TOO_BIG);
  if (total < invoice.remaining) throw new UserError(`As parcelas somam ${formatMoney(total)}, menos que o saldo da fatura (${formatMoney(invoice.remaining)}).`);
  const interest = total - invoice.remaining;

  // O crédito leva a chave do formulário: um reenvio não parcela de novo.
  const credit = await createTransaction(db, userId, {
    type: "income",
    description: `Parcelamento da fatura de ${invoice.month}`,
    amount: total,
    date: today(now),
    paid: true,
    accountId: cardId,
    cardKind: "invoice_credit",
    invoiceMonth: invoice.month,
    submissionKey: key,
  });
  if (key && credit.length === 0) return [];
  const ids = [...credit];
  if (interest > 0) {
    ids.push(
      ...(await createTransaction(db, userId, {
        type: "expense",
        description: `Juros do parcelamento da fatura de ${invoice.month}`,
        amount: interest,
        date: today(now),
        paid: true,
        accountId: cardId,
        cardKind: "interest",
        invoiceMonth: invoice.month,
      })),
    );
  }
  // Primeira parcela hoje: cai na fatura aberta (a próxima a vencer), uma por fatura depois.
  const firstDate = today(now);
  ids.push(
    ...(await createTransaction(db, userId, {
      type: "expense",
      description: `Parcelamento da fatura de ${invoice.month}`,
      amount: each,
      date: firstDate,
      paid: true,
      accountId: cardId,
      installments: count,
      cardKind: "invoice_installment",
    })),
  );
  return ids;
}

/** Move um lançamento do cartão para outra fatura (ou volta a seguir a data, com `null`). */
export async function moveToInvoice(db: Db, userId: string, transactionId: string, month: string | null): Promise<void> {
  assertUuid(transactionId, "Lançamento não encontrado.");
  const invoiceMonth = monthField(month);
  const { rowCount } = await db.query(
    `UPDATE transactions t SET invoice_month = $3
       FROM accounts a
      WHERE t.id = $1 AND t.user_id = $2 AND a.id = t.account_id AND a.type = 'credit_card'`,
    [transactionId, userId, invoiceMonth],
  );
  if (!rowCount) throw new UserError("Lançamento de cartão não encontrado.");
}

// ---------- Conta corrente com cartão de crédito ----------

export type AccountCardInput = { creditLimit: number | null; closingDay: number | null; dueDay: number | null; last4?: string | null };

async function requireCheckingWithoutCard(db: Db, userId: string, accountId: string) {
  assertUuid(accountId, "Conta não encontrada.");
  const { rows } = await db.query(
    `SELECT a.name, a.type, a.archived, a.institution, a.color,
            EXISTS (SELECT 1 FROM accounts c WHERE c.card_of_account_id = a.id) AS has_card
       FROM accounts a WHERE a.id = $1 AND a.user_id = $2`,
    [accountId, userId],
  );
  const acc = rows[0];
  if (!acc) throw new UserError("Conta não encontrada.");
  if (acc.type !== "checking") throw new UserError("Só conta corrente pode ter cartão de crédito ligado.");
  if (acc.archived) throw new UserError("Reative a conta antes de ligar um cartão.");
  if (acc.has_card) throw new UserError("Esta conta já tem um cartão de crédito.");
  return acc as { name: string; institution: string | null; color: string | null };
}

/**
 * Cria o cartão de crédito de uma conta corrente: um cartão (faturas, limite, parcelas) ligado à
 * conta, que fica como pagadora da fatura. Tudo numa transação: ou cria e liga, ou nada muda.
 */
export async function addCardToAccount(pool: Pool, userId: string, accountId: string, input: AccountCardInput): Promise<string> {
  return inTransaction(pool, async (db) => {
    const acc = await requireCheckingWithoutCard(db, userId, accountId);
    let name = `Cartão ${acc.name}`.slice(0, LIMITS.accountName);
    const { rows: taken } = await db.query("SELECT 1 FROM accounts WHERE user_id = $1 AND lower(name) = lower($2)", [userId, name]);
    if (taken.length) name = `${acc.name} crédito`.slice(0, LIMITS.accountName);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO accounts (user_id, name, type, initial_balance_cents, institution, color, card_of_account_id)
       VALUES ($1, $2, 'credit_card', 0, $3, $4, $5) RETURNING id`,
      [userId, name, acc.institution, acc.color, accountId],
    );
    const cardId = rows[0].id;
    await updateCardSettings(db, userId, cardId, {
      creditLimit: input.creditLimit, closingDay: input.closingDay, dueDay: input.dueDay, payerAccountId: accountId, brand: null, last4: input.last4 ?? null,
    });
    return cardId;
  });
}

/** Liga um cartão já cadastrado a uma conta corrente (a conta passa a pagar a fatura). */
export async function linkCardToAccount(db: Db, userId: string, accountId: string, cardId: string): Promise<void> {
  await requireCheckingWithoutCard(db, userId, accountId);
  assertUuid(cardId, "Cartão não encontrado.");
  const { rowCount } = await db.query(
    `UPDATE accounts SET card_of_account_id = $3, payer_account_id = $3
      WHERE id = $1 AND user_id = $2 AND type = 'credit_card' AND card_of_account_id IS NULL`,
    [cardId, userId, accountId],
  );
  if (!rowCount) throw new UserError("Cartão não encontrado ou já ligado a outra conta.");
}

/** Desliga o cartão da conta (ele continua existindo como cartão separado, com tudo que tinha). */
export async function unlinkCard(db: Db, userId: string, cardId: string): Promise<void> {
  assertUuid(cardId, "Cartão não encontrado.");
  const { rowCount } = await db.query(
    "UPDATE accounts SET card_of_account_id = NULL WHERE id = $1 AND user_id = $2 AND card_of_account_id IS NOT NULL",
    [cardId, userId],
  );
  if (!rowCount) throw new UserError("Cartão não encontrado.");
}

/** O cartão ligado a uma conta corrente (ou null). */
export async function getAccountCard(db: Db, userId: string, accountId: string, now = new Date()): Promise<CardDetail | null> {
  if (!isUuid(accountId)) return null;
  const { rows } = await db.query("SELECT id FROM accounts WHERE user_id = $1 AND card_of_account_id = $2", [userId, accountId]);
  return rows[0] ? getCard(db, userId, rows[0].id, now) : null;
}

/** Cartões ainda sem conta corrente (para ligar a uma). */
export async function listUnlinkedCards(db: Db, userId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query(
    "SELECT id, name FROM accounts WHERE user_id = $1 AND type = 'credit_card' AND card_of_account_id IS NULL AND NOT archived ORDER BY created_at, name",
    [userId],
  );
  return rows;
}
