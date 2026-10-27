import { num, type Db } from "@/lib/db";
import { UserError, assertUuid, pgCode, submissionKey, toUserError } from "./errors";
import { LIMITS, requiredText } from "./limits";

export const accountTypes = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
} as const;
export type AccountType = keyof typeof accountTypes;

export type AccountWithBalance = {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  /** Saldo atual: saldo inicial + tudo que já foi pago/recebido. */
  balance: number;
  /** Saldo depois que os pendentes forem pagos/recebidos. */
  projectedBalance: number;
};

/**
 * Efeito de um lançamento no saldo de uma conta:
 * entrada soma, saída subtrai, transferência subtrai da origem e soma no destino.
 */
const effectSql = `
  CASE
    WHEN t.type = 'income'   THEN t.amount_cents
    WHEN t.type = 'expense'  THEN -t.amount_cents
    WHEN t.type = 'transfer' AND t.account_id = a.id    THEN -t.amount_cents
    WHEN t.type = 'transfer' AND t.to_account_id = a.id THEN t.amount_cents
  END`;

export async function listAccounts(db: Db, userId: string): Promise<AccountWithBalance[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.type, a.initial_balance_cents,
            a.initial_balance_cents + COALESCE(SUM(CASE WHEN t.paid THEN ${effectSql} END), 0) AS balance,
            a.initial_balance_cents + COALESCE(SUM(${effectSql}), 0) AS projected
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id OR t.to_account_id = a.id
      WHERE a.user_id = $1
      GROUP BY a.id
      ORDER BY a.created_at, a.name`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    initialBalance: num(r.initial_balance_cents),
    balance: num(r.balance),
    projectedBalance: num(r.projected),
  }));
}

export async function createAccount(
  db: Db,
  userId: string,
  input: { name: string; type: AccountType; initialBalance: number; submissionKey?: string | null },
): Promise<string | null> {
  const name = requiredText(input.name, LIMITS.accountName, "Informe o nome da conta.", "O nome da conta");
  if (!(input.type in accountTypes)) throw new UserError("Tipo de conta inválido.");
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
      [userId, name, input.type, input.initialBalance, submissionKey(input.submissionKey)],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    throw toUserError(err);
  }
}

export async function deleteAccount(db: Db, userId: string, accountId: string): Promise<void> {
  assertUuid(accountId, "Conta não encontrada.");
  try {
    await db.query("DELETE FROM accounts WHERE id = $1 AND user_id = $2", [accountId, userId]);
  } catch (err) {
    if (pgCode(err) === "23503") {
      throw new UserError("Essa conta tem lançamentos. Exclua os lançamentos antes de excluir a conta.");
    }
    throw err;
  }
}
