import { num, type Db } from "@/lib/db";
import { today } from "@/lib/dates";
import { UserError, assertUuid, pgCode, submissionKey, toUserError, validateOnce } from "./errors";
import { LIMITS, TOO_BIG, isValidCents, requiredText } from "@/domain/limits";

import {
  accountTypes,
  isAccountColor,
  isAccountIcon,
  isAccountType,
  type AccountIcon,
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
    `SELECT a.id, a.name, a.type, a.initial_balance_cents, a.institution, a.color, a.icon, a.archived, a.overdraft_limit_cents,
            count(DISTINCT e.transaction_id) AS transaction_count,
            a.initial_balance_cents + COALESCE(SUM(e.delta) FILTER (WHERE e.paid AND e.date <= $2), 0) AS balance,
            a.initial_balance_cents + COALESCE(SUM(e.delta), 0) AS projected
       FROM accounts a
       LEFT JOIN transaction_effects e ON e.account_id = a.id
      WHERE a.user_id = $1
      GROUP BY a.id
      ORDER BY a.archived, a.created_at, a.name`,
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
    institution: r.institution ?? null,
    color: r.color ?? null,
    icon: r.icon ?? null,
    archived: r.archived === true,
    overdraftLimit: r.overdraft_limit_cents === null ? null : num(r.overdraft_limit_cents),
  }));
}

/**
 * Só id e nome (para listas de seleção), sem calcular saldo. Contas arquivadas ficam de fora,
 * a não ser com `includeArchived` (filtros e edição de lançamentos antigos).
 */
export async function listAccountOptions(
  db: Db,
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<AccountOption[]> {
  const { rows } = await db.query<AccountOption>(
    `SELECT id, name, type, archived FROM accounts
      WHERE user_id = $1 AND ($2 OR NOT archived) ORDER BY archived, created_at, name`,
    [userId, opts.includeArchived === true],
  );
  return rows;
}

export type AccountInput = {
  name: string;
  type: AccountType;
  initialBalance: number;
  institution?: string | null;
  color?: string | null;
  icon?: AccountIcon | null;
  /** Cheque especial em centavos (só conta corrente). */
  overdraftLimit?: number | null;
};

async function validateAccount(db: Db, userId: string, input: AccountInput, exceptId?: string) {
  const name = requiredText(input.name, LIMITS.accountName, "Informe o nome da conta.", "O nome da conta");
  if (!isAccountType(input.type)) throw new UserError("Tipo de conta inválido.");
  if (!Number.isSafeInteger(input.initialBalance)) throw new UserError("Saldo inicial inválido.");
  if (!isValidCents(input.initialBalance)) throw new UserError(TOO_BIG);
  const { rows } = await db.query(
    "SELECT 1 FROM accounts WHERE user_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3::uuid",
    [userId, name, exceptId ?? null],
  );
  if (rows.length) throw new UserError("Você já tem uma conta com esse nome.");
  const institution = input.institution?.trim()
    ? requiredText(input.institution, 40, "", "O nome da instituição")
    : null;
  const color = input.color || null;
  if (color !== null && !isAccountColor(color)) throw new UserError("Cor inválida.");
  const icon = input.icon || null;
  if (icon !== null && !isAccountIcon(icon)) throw new UserError("Ícone inválido.");
  const overdraftLimit = input.overdraftLimit ?? null;
  if (overdraftLimit !== null) {
    if (input.type !== "checking") throw new UserError("Cheque especial só vale para conta corrente.");
    if (!Number.isSafeInteger(overdraftLimit) || overdraftLimit <= 0) throw new UserError("O cheque especial precisa ser maior que zero.");
    if (!isValidCents(overdraftLimit)) throw new UserError(TOO_BIG);
  }
  return { ...input, name, institution, color, icon, overdraftLimit };
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
       INSERT INTO accounts (user_id, name, type, initial_balance_cents, institution, color, icon, overdraft_limit_cents)
       SELECT $1, $2, $3, $4, $6, $7, $8, $9 WHERE $5::uuid IS NULL OR EXISTS (SELECT 1 FROM claim)
       RETURNING id`,
      [userId, account.name, account.type, account.initialBalance, key, account.institution, account.color, account.icon, account.overdraftLimit],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    throw toUserError(err);
  }
}

export async function updateAccount(db: Db, userId: string, accountId: string, input: AccountInput): Promise<void> {
  assertUuid(accountId, "Conta não encontrada.");
  const account = await validateAccount(db, userId, input, accountId);
  try {
    const { rowCount } = await db.query(
      `UPDATE accounts SET name = $3, type = $4, initial_balance_cents = $5, institution = $6, color = $7, icon = $8,
              overdraft_limit_cents = $9
        WHERE id = $1 AND user_id = $2`,
      [accountId, userId, account.name, account.type, account.initialBalance, account.institution, account.color, account.icon, account.overdraftLimit],
    );
    if (!rowCount) throw new UserError("Conta não encontrada.");
  } catch (err) {
    // Deixar de ser cartão com limite/fechamento cadastrados.
    if (pgCode(err) === "23514") throw new UserError("Esse cartão tem limite ou fechamento cadastrados: limpe em Cartões antes de mudar o tipo.");
    throw err;
  }
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

/**
 * Arquiva (some das listas de escolha, fica no histórico) ou reativa a conta. Só arquiva com
 * saldo zerado e sem nada pendente ou futuro, para o dinheiro não "sumir" dos totais.
 */
export async function setAccountArchived(db: Db, userId: string, accountId: string, archived: boolean, now = new Date()): Promise<void> {
  assertUuid(accountId, "Conta não encontrada.");
  if (archived) {
    const account = (await listAccounts(db, userId, now)).find((a) => a.id === accountId);
    if (!account) throw new UserError("Conta não encontrada.");
    if (account.balance !== 0 || account.projectedBalance !== 0) {
      throw new UserError("Só dá para arquivar com o saldo zerado e sem lançamentos pendentes ou futuros.");
    }
  }
  const { rowCount } = await db.query("UPDATE accounts SET archived = $3 WHERE id = $1 AND user_id = $2", [accountId, userId, archived === true]);
  if (!rowCount) throw new UserError("Conta não encontrada.");
}
