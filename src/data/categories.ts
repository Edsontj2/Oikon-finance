import { num, type Db } from "@/lib/db";
import { monthRange } from "@/lib/dates";
import { UserError, assertUuid, pgCode } from "./errors";

export type CategoryKind = "income" | "expense";

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  monthlyLimit: number | null;
  /** Total lançado no mês (pago ou pendente). */
  monthTotal: number;
};

export async function listCategories(db: Db, userId: string, month: string): Promise<Category[]> {
  const { start, end } = monthRange(month);
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.kind, c.monthly_limit_cents,
            COALESCE(SUM(t.amount_cents), 0) AS month_total
       FROM categories c
       LEFT JOIN transactions t
              ON t.category_id = c.id AND t.date >= $2 AND t.date < $3
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.kind DESC, c.name`,
    [userId, start, end],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    monthlyLimit: r.monthly_limit_cents === null ? null : num(r.monthly_limit_cents),
    monthTotal: num(r.month_total),
  }));
}

export async function createCategory(
  db: Db,
  userId: string,
  input: { name: string; kind: CategoryKind; monthlyLimit: number | null },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new UserError("Informe o nome da categoria.");
  if (input.kind !== "income" && input.kind !== "expense") throw new UserError("Tipo de categoria inválido.");
  if (input.monthlyLimit !== null && input.monthlyLimit <= 0) {
    throw new UserError("O limite mensal precisa ser maior que zero.");
  }
  try {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO categories (user_id, name, kind, monthly_limit_cents) VALUES ($1, $2, $3, $4) RETURNING id",
      [userId, name, input.kind, input.kind === "expense" ? input.monthlyLimit : null],
    );
    return rows[0].id;
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Já existe uma categoria com esse nome.");
    throw err;
  }
}

export async function deleteCategory(db: Db, userId: string, categoryId: string): Promise<void> {
  assertUuid(categoryId, "Categoria não encontrada.");
  // Os lançamentos da categoria continuam existindo, só ficam sem categoria.
  await db.query("DELETE FROM categories WHERE id = $1 AND user_id = $2", [categoryId, userId]);
}
