/**
 * Conciliação: a pessoa informa o saldo que o banco mostra numa data; o app compara com o saldo
 * calculado e, se houver diferença, lança um ajuste (pelo mesmo createTransaction) que mexe no
 * saldo mas não entra como receita ou despesa nos relatórios. Tudo fica registrado.
 */
import { num, type Db } from "@/lib/db";
import { isValidDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isValidCents, TOO_BIG } from "@/domain/limits";
import { UserError, assertUuid, isUuid } from "./errors";
import { createTransaction } from "./transactions";

export type Reconciliation = {
  id: string;
  date: string;
  statement: number;
  system: number;
  difference: number;
  adjustmentId: string | null;
  createdAt: string;
};

/** Saldo do app numa data: saldo inicial + tudo que já foi pago/recebido até aquele dia. */
export async function balanceOn(db: Db, userId: string, accountId: string, date: string): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT a.initial_balance_cents + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e
              WHERE e.account_id = a.id AND e.paid AND e.date <= $3::date), 0) AS balance
       FROM accounts a WHERE a.id = $1 AND a.user_id = $2`,
    [accountId, userId, date],
  );
  return rows[0] ? num(rows[0].balance) : null;
}

export async function reconcileAccount(
  db: Db,
  userId: string,
  accountId: string,
  input: { statementBalance: number; date?: string; submissionKey?: string | null },
  now = new Date(),
): Promise<Reconciliation | null> {
  assertUuid(accountId, "Conta não encontrada.");
  const date = input.date || today(now);
  if (!isValidDate(date)) throw new UserError("Data inválida.");
  if (date > today(now)) throw new UserError("A conciliação é feita com o saldo de hoje ou de um dia que já passou.");
  if (!Number.isSafeInteger(input.statementBalance)) throw new UserError("Saldo do extrato inválido.");
  if (!isValidCents(input.statementBalance)) throw new UserError(TOO_BIG);

  // A chave do formulário evita conciliar (e ajustar) duas vezes com um duplo clique.
  const key = input.submissionKey && isUuid(input.submissionKey) ? input.submissionKey : null;
  if (key) {
    const claim = await db.query("INSERT INTO form_submissions (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1", [userId, key]);
    if (!claim.rows.length) return null;
  }
  const system = await balanceOn(db, userId, accountId, date);
  if (system === null) throw new UserError("Conta não encontrada.");
  const difference = input.statementBalance - system;
  let adjustmentId: string | null = null;
  if (difference !== 0) {
    const [id] = await createTransaction(db, userId, {
      type: difference > 0 ? "income" : "expense",
      description: `Ajuste de conciliação (extrato ${formatMoney(input.statementBalance)})`,
      amount: Math.abs(difference),
      date,
      paid: true,
      accountId,
      isAdjustment: true,
    });
    adjustmentId = id;
  }
  const { rows } = await db.query(
    `INSERT INTO account_reconciliations (user_id, account_id, date, statement_cents, system_cents, adjustment_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [userId, accountId, date, input.statementBalance, system, adjustmentId],
  );
  return { id: rows[0].id, date, statement: input.statementBalance, system, difference, adjustmentId, createdAt: rows[0].created_at.toISOString() };
}

export async function listReconciliations(db: Db, userId: string, accountId: string, limit = 10): Promise<Reconciliation[]> {
  if (!isUuid(accountId)) return [];
  const { rows } = await db.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, statement_cents, system_cents, adjustment_id, created_at
       FROM account_reconciliations WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC LIMIT $3`,
    [userId, accountId, Math.min(Math.max(limit, 1), 50)],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    statement: num(r.statement_cents),
    system: num(r.system_cents),
    difference: num(r.statement_cents) - num(r.system_cents),
    adjustmentId: r.adjustment_id,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}
