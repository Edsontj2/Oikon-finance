import { num, type Db } from "@/lib/db";
import { today } from "@/lib/dates";
import { UserError, assertUuid, pgCode, submissionKey, toUserError, validateOnce } from "./errors";
import { LIMITS, requiredText } from "@/domain/limits";

import {
  accountTypes,
  isAccountType,
  type AccountOption,
  type AccountType,
  type AccountWithBalance,
} from "@/domain/accounts";

export { accountTypes, isAccountType, type AccountOption, type AccountType, type AccountWithBalance };

/**
 * Saldo atual: saldo inicial + o que já foi pago/recebido com data até hoje.
 * Previsto: inclui pendentes e lançamentos com data no futuro.
 * A regra de quanto cada lançamento soma ou subtrai está na view transaction_effects (migração 0003).
 */
export async function listAccounts(db: Db, userId: string, now: Date = new Date()): Promise<AccountWithBalance[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.type, a.initial_balance_cents,
            count(DISTINCT e.transaction_id) AS transaction_count,
            a.initial_balance_cents + COALESCE(SUM(e.delta) FILTER (WHERE e.paid AND e.date <= $2), 0) AS balance,
            a.initial_balance_cents + COALESCE(SUM(e.delta), 0) AS projected
       FROM accounts a
       LEFT JOIN transaction_effects e ON e.account_id = a.id
      WHERE a.user_id = $1
      GROUP BY a.id
      ORDER BY a.created_at, a.name`,
    [userId, today(now)],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    initialBalance: num(r.initial_balance_cents),
    balance: num(r.balance),
    projectedBalance: num(r.projected),
    transactionCount: num(r.transaction_count),
  }));
}

/** Só id e nome (para listas de seleção), sem calcular saldo. */
export async function listAccountOptions(db: Db, userId: string): Promise<AccountOption[]> {
  const { rows } = await db.query<AccountOption>(
    "SELECT id, name, type FROM accounts WHERE user_id = $1 ORDER BY created_at, name",
    [userId],
  );
  return rows;
}

export type AccountInput = { name: string; type: AccountType; initialBalance: number };

async function validateAccount(db: Db, userId: string, input: AccountInput, exceptId?: string) {
  const name = requiredText(input.name, LIMITS.accountName, "Informe o nome da conta.", "O nome da conta");
  if (!isAccountType(input.type)) throw new UserError("Tipo de conta inválido.");
  if (!Number.isSafeInteger(input.initialBalance)) throw new UserError("Saldo inicial inválido.");
  const { rows } = await db.query(
    "SELECT 1 FROM accounts WHERE user_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3::uuid",
    [userId, name, exceptId ?? null],
  );
  if (rows.length) throw new UserError("Você já tem uma conta com esse nome.");
  return { ...input, name };
}

export async function createAccount(
  db: Db,
  userId: string,
  input: AccountInput & { submissionKey?: string | null },
): Promise<string | null> {
  const key = submissionKey(input.submissionKey);
  const account = await validateOnce(db, userId, key, () => validateAccount(db, userId, input));
  if (!account) return null;
  try {
    // A chave do formulário é gravada no mesmo comando: um reenvio com a mesma chave não cria nada.
    const { rows } = await db.query<{ id: string }>(
      `WITH claim AS (
         INSERT INTO form_submissions (user_id, key) SELECT $1, $5::uuid WHERE $5::uuid IS NOT NULL
         ON CONFLICT DO NOTHING RETURNING 1
       )
       INSERT INTO accounts (user_id, name, type, initial_balance_cents)
       SELECT $1, $2, $3, $4 WHERE $5::uuid IS NULL OR EXISTS (SELECT 1 FROM claim)
       RETURNING id`,
      [userId, account.name, account.type, account.initialBalance, key],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    throw toUserError(err);
  }
}

export async function updateAccount(db: Db, userId: string, accountId: string, input: AccountInput): Promise<void> {
  assertUuid(accountId, "Conta não encontrada.");
  const account = await validateAccount(db, userId, input, accountId);
  const { rowCount } = await db.query(
    "UPDATE accounts SET name = $3, type = $4, initial_balance_cents = $5 WHERE id = $1 AND user_id = $2",
    [accountId, userId, account.name, account.type, account.initialBalance],
  );
  if (!rowCount) throw new UserError("Conta não encontrada.");
}

export async function deleteAccount(db: Db, userId: string, accountId: string): Promise<void> {
  assertUuid(accountId, "Conta não encontrada.");
  try {
    const { rowCount } = await db.query("DELETE FROM accounts WHERE id = $1 AND user_id = $2", [accountId, userId]);
    if (!rowCount) throw new UserError("Conta não encontrada.");
  } catch (err) {
    if (pgCode(err) === "23503") {
      throw new UserError("Essa conta tem lançamentos. Exclua ou mude os lançamentos de conta antes de excluí-la.");
    }
    throw err;
  }
}
