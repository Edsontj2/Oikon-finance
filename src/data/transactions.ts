import { randomUUID } from "node:crypto";
import { num, type Db } from "@/lib/db";
import { addMonths, isValidDate, monthRange, today } from "@/lib/dates";
import { UserError, assertUuid, isUuid, submissionKey, toUserError } from "./errors";
import { LIMITS, TOO_BIG, isValidCents, requiredText } from "@/domain/limits";

import {
  MAX_REPEAT,
  isTransactionType,
  transactionTypes,
  type Transaction,
  type TransactionType,
} from "@/domain/transactions";

export { MAX_REPEAT, isTransactionType, transactionTypes, type Transaction, type TransactionType };

/** Campos de um lançamento, iguais para criar e editar. */
export type TransactionInput = {
  type: TransactionType;
  description: string;
  /** Centavos, sempre positivo. O tipo decide se soma ou subtrai. */
  amount: number;
  date: string;
  paid: boolean;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
};

export type NewTransaction = TransactionInput & {
  /** Quantas vezes lançar, uma por mês (1 = só este mês). */
  repeat?: number;
  /** Chave única do envio do formulário; reenviar a mesma chave não lança de novo. */
  submissionKey?: string | null;
};

/** Datas de cada parcela de "repetir todo mês". */
export function seriesDates(firstDate: string, repeat: number): string[] {
  return Array.from({ length: repeat }, (_, i) => addMonths(firstDate, i));
}

type ValidTransaction = TransactionInput & { toAccountId: string | null; categoryId: string | null };

/** Valida os campos e confere que contas e categoria são do próprio usuário. */
async function validateTransaction(db: Db, userId: string, input: TransactionInput): Promise<ValidTransaction> {
  if (!isTransactionType(input.type)) throw new UserError("Tipo de lançamento inválido.");
  const description = requiredText(input.description, LIMITS.description, "Informe a descrição.", "A descrição");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new UserError("O valor precisa ser maior que zero.");
  }
  if (!isValidCents(input.amount)) throw new UserError(TOO_BIG);
  if (!isValidDate(input.date)) throw new UserError("Data inválida.");

  const toAccountId = input.type === "transfer" ? input.toAccountId || null : null;
  const categoryId = input.type === "transfer" ? null : input.categoryId || null;
  if (input.type === "transfer") {
    if (!toAccountId) throw new UserError("Escolha a conta de destino da transferência.");
    if (toAccountId === input.accountId) throw new UserError("A conta de destino precisa ser diferente da origem.");
  }

  const accountIds = toAccountId ? [input.accountId, toAccountId] : [input.accountId];
  accountIds.forEach((id) => assertUuid(id, "Conta não encontrada."));
  const owned = await db.query("SELECT id FROM accounts WHERE user_id = $1 AND id = ANY($2::uuid[])", [
    userId,
    accountIds,
  ]);
  if (owned.rows.length !== accountIds.length) throw new UserError("Conta não encontrada.");

  if (categoryId) {
    assertUuid(categoryId, "Categoria não encontrada.");
    const cat = await db.query<{ kind: string }>("SELECT kind FROM categories WHERE id = $1 AND user_id = $2", [
      categoryId,
      userId,
    ]);
    if (!cat.rows[0]) throw new UserError("Categoria não encontrada.");
    if (cat.rows[0].kind !== input.type) {
      throw new UserError(
        input.type === "income" ? "Escolha uma categoria de entrada." : "Escolha uma categoria de saída.",
      );
    }
  }
  return { ...input, description, toAccountId, categoryId, paid: input.paid === true };
}

export async function createTransaction(db: Db, userId: string, input: NewTransaction): Promise<string[]> {
  const repeat = input.repeat ?? 1;
  const tx = await validateTransaction(db, userId, input);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
    throw new UserError(`Repetir deve ser entre 1 e ${MAX_REPEAT} meses.`);
  }

  const seriesId = repeat > 1 ? randomUUID() : null;
  const dates = seriesDates(tx.date, repeat);
  // Só a primeira ocorrência herda "pago"; as dos próximos meses ficam pendentes.
  const paid = dates.map((_, i) => (i === 0 ? tx.paid : false));

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
        userId, tx.type, tx.description, tx.amount, tx.accountId, tx.toAccountId, tx.categoryId, seriesId,
        dates, paid, submissionKey(input.submissionKey),
      ],
    );
    return rows.map((r) => r.id);
  } catch (err) {
    throw toUserError(err);
  }
}

/** Edita um lançamento (só ele; os outros meses de uma série não mudam). */
export async function updateTransaction(
  db: Db,
  userId: string,
  transactionId: string,
  input: TransactionInput,
): Promise<void> {
  assertUuid(transactionId, "Lançamento não encontrado.");
  const tx = await validateTransaction(db, userId, input);
  try {
    const { rowCount } = await db.query(
      `UPDATE transactions
          SET type = $3, description = $4, amount_cents = $5, date = $6, paid = $7,
              account_id = $8, to_account_id = $9, category_id = $10
        WHERE id = $1 AND user_id = $2`,
      [
        transactionId, userId, tx.type, tx.description, tx.amount, tx.date, tx.paid,
        tx.accountId, tx.toAccountId, tx.categoryId,
      ],
    );
    if (!rowCount) throw new UserError("Lançamento não encontrado.");
  } catch (err) {
    throw toUserError(err);
  }
}

export type TransactionFilter = {
  /** "AAAA-MM"; sem mês, busca em todos os meses. */
  month?: string;
  accountId?: string;
  type?: TransactionType;
  /** Trecho da descrição (sem diferenciar maiúsculas). */
  search?: string;
  limit?: number;
  offset?: number;
};

function buildFilter(userId: string, filter: TransactionFilter) {
  const params: unknown[] = [userId];
  const where = ["t.user_id = $1"];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filter.month) {
    const { start, end } = monthRange(filter.month);
    where.push(`t.date >= ${add(start)} AND t.date < ${add(end)}`);
  }
  if (filter.accountId) {
    const p = add(filter.accountId);
    where.push(`(t.account_id = ${p} OR t.to_account_id = ${p})`);
  }
  if (filter.type) where.push(`t.type = ${add(filter.type)}`);
  if (filter.search?.trim()) {
    const escaped = filter.search.trim().slice(0, LIMITS.description).replace(/[\\%_]/g, "\\$&");
    where.push(`t.description ILIKE ${add(`%${escaped}%`)}`);
  }
  return { params, where: where.join(" AND ") };
}

const selectColumns = `
  t.id, t.type, t.description, t.amount_cents, to_char(t.date, 'YYYY-MM-DD') AS date, t.paid,
  t.account_id, a.name AS account_name, t.to_account_id, ta.name AS to_account_name,
  t.category_id, c.name AS category_name, t.series_id
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id`;

/** Lançamentos com filtros e paginação; devolve também o total (para "mostrar mais"). */
export async function searchTransactions(
  db: Db,
  userId: string,
  filter: TransactionFilter,
): Promise<{ items: Transaction[]; total: number }> {
  // Conta de outra pessoa ou id malformado: simplesmente não acha nada.
  if (filter.accountId !== undefined && !isUuid(filter.accountId)) return { items: [], total: 0 };
  const { params, where } = buildFilter(userId, filter);
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 50), 1), 500);
  const offset = Math.max(Math.floor(filter.offset ?? 0), 0);
  const [list, count] = await Promise.all([
    db.query(
      `SELECT ${selectColumns}
        WHERE ${where}
        ORDER BY t.date DESC, t.created_at DESC, t.id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    db.query(`SELECT count(*) AS n FROM transactions t WHERE ${where}`, params),
  ]);
  return { items: list.rows.map(mapTransaction), total: num(count.rows[0].n) };
}

/** Lançamentos de um mês (atalho usado pelo painel e pelos testes). */
export async function listTransactions(
  db: Db,
  userId: string,
  filter: { month: string; accountId?: string; limit?: number },
): Promise<Transaction[]> {
  return (await searchTransactions(db, userId, { ...filter, limit: filter.limit ?? 500 })).items;
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
/**
 * Marca como pago ou pendente. Pagar antes da data quer dizer que foi pago hoje: a data vira
 * hoje e o valor sai do saldo na hora (senão o saldo só mudaria no dia do vencimento).
 */
export async function setPaid(db: Db, userId: string, transactionId: string, paid: boolean, now = new Date()): Promise<void> {
  assertUuid(transactionId, "Lançamento não encontrado.");
  const { rowCount } = await db.query(
    `UPDATE transactions
        SET paid = $3, date = CASE WHEN $3 THEN LEAST(date, $4::date) ELSE date END
      WHERE id = $1 AND user_id = $2`,
    [transactionId, userId, paid === true, today(now)],
  );
  if (!rowCount) throw new UserError("Lançamento não encontrado.");
}

/**
 * Exclui um lançamento. Com scope "future", exclui também as próximas ocorrências
 * da mesma série (repetir todo mês) a partir da data dele. Devolve quantos apagou.
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
