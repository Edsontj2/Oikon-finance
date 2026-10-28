import { num, type Db } from "@/lib/db";
import { monthRange, today } from "@/lib/dates";
import { UserError, assertUuid, pgCode, submissionKey, toUserError, validateOnce } from "./errors";
import { LIMITS, TOO_BIG, isValidCents, requiredText } from "@/domain/limits";

import {
  categoryKinds,
  isCategoryKind,
  type Category,
  type CategoryKind,
  type CategoryOption,
} from "@/domain/categories";

export { categoryKinds, isCategoryKind, type Category, type CategoryKind, type CategoryOption };

/** Totais do mês por categoria; "pago" é o que já mexeu no saldo (pago e com data até hoje). */
export async function listCategories(db: Db, userId: string, month: string, now = new Date()): Promise<Category[]> {
  const { start, end } = monthRange(month);
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.kind, c.monthly_limit_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.paid AND t.date <= $4::date), 0) AS paid_total,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE NOT (t.paid AND t.date <= $4::date)), 0) AS pending_total
       FROM categories c
       LEFT JOIN transactions t
              ON t.category_id = c.id AND t.date >= $2 AND t.date < $3
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY CASE c.kind WHEN 'expense' THEN 0 ELSE 1 END, c.name`,
    [userId, start, end, today(now)],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    monthlyLimit: r.monthly_limit_cents === null ? null : num(r.monthly_limit_cents),
    paidTotal: num(r.paid_total),
    pendingTotal: num(r.pending_total),
    monthTotal: num(r.paid_total) + num(r.pending_total),
  }));
}

/** Só id, nome e tipo (para listas de seleção). */
export async function listCategoryOptions(db: Db, userId: string): Promise<CategoryOption[]> {
  const { rows } = await db.query<CategoryOption>(
    "SELECT id, name, kind FROM categories WHERE user_id = $1 ORDER BY name",
    [userId],
  );
  return rows;
}

type CategoryFields = { name: string; monthlyLimit: number | null };

async function validateCategory(db: Db, userId: string, kind: CategoryKind, input: CategoryFields, exceptId?: string) {
  const name = requiredText(input.name, LIMITS.categoryName, "Informe o nome da categoria.", "O nome da categoria");
  if (input.monthlyLimit !== null) {
    if (kind === "income") throw new UserError("Limite mensal só vale para categorias de saída.");
    if (!Number.isSafeInteger(input.monthlyLimit) || input.monthlyLimit <= 0) {
      throw new UserError("O limite mensal precisa ser maior que zero.");
    }
    if (!isValidCents(input.monthlyLimit)) throw new UserError(TOO_BIG);
  }
  const { rows } = await db.query(
    `SELECT 1 FROM categories
      WHERE user_id = $1 AND kind = $2 AND lower(name) = lower($3) AND id IS DISTINCT FROM $4::uuid`,
    [userId, kind, name, exceptId ?? null],
  );
  if (rows.length) throw new UserError("Já existe uma categoria com esse nome.");
  return { name, monthlyLimit: input.monthlyLimit };
}

export async function createCategory(
  db: Db,
  userId: string,
  input: CategoryFields & { kind: CategoryKind; submissionKey?: string | null },
): Promise<string | null> {
  if (!isCategoryKind(input.kind)) throw new UserError("Tipo de categoria inválido.");
  const key = submissionKey(input.submissionKey);
  const category = await validateOnce(db, userId, key, () => validateCategory(db, userId, input.kind, input));
  if (!category) return null;
  try {
    const { rows } = await db.query<{ id: string }>(
      `WITH claim AS (
         INSERT INTO form_submissions (user_id, key) SELECT $1, $5::uuid WHERE $5::uuid IS NOT NULL
         ON CONFLICT DO NOTHING RETURNING 1
       )
       INSERT INTO categories (user_id, name, kind, monthly_limit_cents)
       SELECT $1, $2, $3, $4 WHERE $5::uuid IS NULL OR EXISTS (SELECT 1 FROM claim)
       RETURNING id`,
      [userId, category.name, input.kind, category.monthlyLimit, key],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Já existe uma categoria com esse nome.");
    throw toUserError(err);
  }
}

/** Muda nome e limite (o tipo não muda: os lançamentos dependem dele). */
export async function updateCategory(db: Db, userId: string, categoryId: string, input: CategoryFields): Promise<void> {
  assertUuid(categoryId, "Categoria não encontrada.");
  const { rows } = await db.query<{ kind: CategoryKind }>(
    "SELECT kind FROM categories WHERE id = $1 AND user_id = $2",
    [categoryId, userId],
  );
  if (!rows[0]) throw new UserError("Categoria não encontrada.");
  const category = await validateCategory(db, userId, rows[0].kind, input, categoryId);
  try {
    await db.query("UPDATE categories SET name = $3, monthly_limit_cents = $4 WHERE id = $1 AND user_id = $2", [
      categoryId,
      userId,
      category.name,
      category.monthlyLimit,
    ]);
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Já existe uma categoria com esse nome.");
    throw toUserError(err);
  }
}

export async function deleteCategory(db: Db, userId: string, categoryId: string): Promise<void> {
  assertUuid(categoryId, "Categoria não encontrada.");
  // Os lançamentos da categoria continuam existindo, só ficam sem categoria.
  const { rowCount } = await db.query("DELETE FROM categories WHERE id = $1 AND user_id = $2", [categoryId, userId]);
  if (!rowCount) throw new UserError("Categoria não encontrada.");
}
