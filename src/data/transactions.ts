import { randomUUID } from "node:crypto";
import { num, type Db } from "@/lib/db";
import { addMonths, isValidDate, monthRange } from "@/lib/dates";
import { UserError, assertUuid, submissionKey, toUserError } from "./errors";
import { LIMITS, requiredText } from "./limits";

export type TransactionType = "income" | "expense" | "transfer";

export const transactionTypes: Record<TransactionType, string> = {
  income: "Entrada",
  expense: "Saída",
  transfer: "Transferência",
};

export type Transaction = {
  id: string;
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  paid: boolean;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  seriesId: string | null;
};

export type NewTransaction = {
  type: TransactionType;
  description: string;
  /** Centavos, sempre positivo. O tipo decide se soma ou subtrai. */
  amount: number;
  date: string;
  paid: boolean;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  /** Quantas vezes lançar, uma por mês (1 = só este mês). */
  repeat?: number;
  /** Chave única do envio do formulário; reenviar a mesma chave não lança de novo. */
  submissionKey?: string | null;
};

export const MAX_REPEAT = 60;

/** Datas de cada parcela de "repetir todo mês". */
export function seriesDates(firstDate: string, repeat: number): string[] {
  return Array.from({ length: repeat }, (_, i) => addMonths(firstDate, i));
}

export async function createTransaction(db: Db, userId: string, input: NewTransaction): Promise<string[]> {
  const repeat = input.repeat ?? 1;
  const toAccountId = input.type === "transfer" ? input.toAccountId || null : null;
  const categoryId = input.type === "transfer" ? null : input.categoryId || null;

  if (!(input.type in transactionTypes)) throw new UserError("Tipo de lançamento inválido.");
  const description = requiredText(input.description, LIMITS.description, "Informe a descrição.", "A descrição");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new UserError("O valor precisa ser maior que zero.");
  }
  if (!isValidDate(input.date)) throw new UserError("Data inválida.");
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
    throw new UserError(`Repetir deve ser entre 1 e ${MAX_REPEAT} meses.`);
  }
  if (input.type === "transfer") {
    if (!toAccountId) throw new UserError("Escolha a conta de destino da transferência.");
    if (toAccountId === input.accountId) throw new UserError("A conta de destino precisa ser diferente da origem.");
  }

  // Contas e categoria precisam ser do próprio usuário.
  const accountIds = toAccountId ? [input.accountId, toAccountId] : [input.accountId];
  accountIds.forEach((id) => assertUuid(id, "Conta não encontrada."));
  const owned = await db.query("SELECT id FROM accounts WHERE user_id = $1 AND id = ANY($2::uuid[])", [
    userId,
    accountIds,
  ]);
  if (owned.rows.length !== accountIds.length) throw new UserError("Conta não encontrada.");

  if (categoryId) {
    assertUuid(categoryId, "Categoria não encontrada.");
    const cat = await db.query<{ kind: string }>(
      "SELECT kind FROM categories WHERE id = $1 AND user_id = $2",
      [categoryId, userId],
    );
    if (!cat.rows[0]) throw new UserError("Categoria não encontrada.");
    if (cat.rows[0].kind !== input.type) {
      throw new UserError(
        input.type === "income" ? "Escolha uma categoria de entrada." : "Escolha uma categoria de saída.",
      );
    }
  }

  const seriesId = repeat > 1 ? randomUUID() : null;
  const dates = seriesDates(input.date, repeat);
  // Só a primeira ocorrência herda "pago"; as dos próximos meses ficam pendentes.
  const paid = dates.map((_, i) => (i === 0 ? input.paid : false));

  try {
    // Um único comando: grava a chave do formulário e os lançamentos juntos.
    // Se a chave já foi usada (duplo clique, reenvio), nada é lançado e devolve [].
    const { rows } = await db.query<{ id: string }>(
      `WITH claim AS (
         INSERT INTO form_submissions (user_id, key) SELECT $1, $11::uuid WHERE $11::uuid IS NOT NULL
         ON CONFLICT DO NOTHING RETURNING 1
       )
       INSERT INTO transactions
         (user_id, type, description, amount_cents, date, paid, account_id, to_account_id, category_id, series_id)
       SELECT $1, $2, $3, $4, d.date, d.paid, $5, $6, $7, $8
         FROM unnest($9::date[], $10::boolean[]) AS d(date, paid)
        WHERE $11::uuid IS NULL OR EXISTS (SELECT 1 FROM claim)
       RETURNING id`,
      [
        userId, input.type, description, input.amount, input.accountId, toAccountId, categoryId, seriesId,
        dates, paid, submissionKey(input.submissionKey),
      ],
    );
    return rows.map((r) => r.id);
  } catch (err) {
    throw toUserError(err);
  }
}

export async function listTransactions(
  db: Db,
  userId: string,
  filter: { month: string; accountId?: string; limit?: number },
): Promise<Transaction[]> {
  const { start, end } = monthRange(filter.month);
  const params: unknown[] = [userId, start, end];
  let accountFilter = "";
  if (filter.accountId) {
    params.push(filter.accountId);
    accountFilter = `AND (t.account_id = $${params.length} OR t.to_account_id = $${params.length})`;
  }
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.description, t.amount_cents, to_char(t.date, 'YYYY-MM-DD') AS date, t.paid,
            t.account_id, a.name AS account_name, t.to_account_id, ta.name AS to_account_name,
            t.category_id, c.name AS category_name, t.series_id
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ta ON ta.id = t.to_account_id
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = $1 AND t.date >= $2 AND t.date < $3 ${accountFilter}
      ORDER BY t.date DESC, t.created_at DESC
      ${filter.limit ? `LIMIT ${Math.floor(filter.limit)}` : ""}`,
    params,
  );
  return rows.map(mapTransaction);
}

function mapTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: r.id as string,
    type: r.type as TransactionType,
    description: r.description as string,
    amount: num(r.amount_cents),
    date: r.date as string,
    paid: r.paid as boolean,
    accountId: r.account_id as string,
    accountName: r.account_name as string,
    toAccountId: (r.to_account_id as string) ?? null,
    toAccountName: (r.to_account_name as string) ?? null,
    categoryId: (r.category_id as string) ?? null,
    categoryName: (r.category_name as string) ?? null,
    seriesId: (r.series_id as string) ?? null,
  };
}

/** Marca como pago/recebido ou volta para pendente. */
export async function setPaid(db: Db, userId: string, transactionId: string, paid: boolean): Promise<void> {
  assertUuid(transactionId, "Lançamento não encontrado.");
  const { rowCount } = await db.query("UPDATE transactions SET paid = $3 WHERE id = $1 AND user_id = $2", [
    transactionId,
    userId,
    paid,
  ]);
  if (!rowCount) throw new UserError("Lançamento não encontrado.");
}

/**
 * Exclui um lançamento. Com scope "future", exclui também as próximas ocorrências
 * da mesma série (repetir todo mês) a partir da data dele.
 */
export async function deleteTransaction(
  db: Db,
  userId: string,
  transactionId: string,
  scope: "one" | "future" = "one",
): Promise<number> {
  assertUuid(transactionId, "Lançamento não encontrado.");
  if (scope === "future") {
    const { rowCount } = await db.query(
      `DELETE FROM transactions t
        USING transactions ref
        WHERE ref.id = $1 AND ref.user_id = $2
          AND t.user_id = $2
          AND (t.id = ref.id OR (ref.series_id IS NOT NULL AND t.series_id = ref.series_id AND t.date >= ref.date))`,
      [transactionId, userId],
    );
    return rowCount ?? 0;
  }
  const { rowCount } = await db.query("DELETE FROM transactions WHERE id = $1 AND user_id = $2", [
    transactionId,
    userId,
  ]);
  return rowCount ?? 0;
}
