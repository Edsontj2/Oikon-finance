/**
 * Orçamento do mês: planejado (limite de cada categoria) × realizado (pago + pendente).
 * Nos meses que ainda não chegaram, os recorrentes ("Todo mês") entram como previstos.
 */
import { num, type Db } from "@/lib/db";
import { monthRange, today } from "@/lib/dates";
import { groupCategories } from "@/domain/categories";
import { listCategories } from "./categories";
import { expenseHistory, monthSummary } from "./dashboard";

export type BudgetStatus = "none" | "ok" | "warn" | "over";

export type BudgetLine = {
  id: string;
  name: string;
  limit: number | null;
  paid: number;
  /** Pendentes do mês + recorrentes previstos. */
  pending: number;
  total: number;
  percent: number | null;
  status: BudgetStatus;
  /** Média dos 3 meses anteriores. */
  average: number;
  /** Gasto bem acima da média (30% e pelo menos R$ 50 a mais). */
  unusual: boolean;
  children: BudgetLine[];
};

export type MonthBudget = {
  month: string;
  lines: BudgetLine[];
  uncategorized: { paid: number; pending: number };
  planned: number;
  /** Total das categorias com limite (para comparar com o planejado). */
  plannedSpent: number;
  expense: { paid: number; pending: number; total: number };
  income: { received: number; expected: number };
  alerts: { name: string; status: "warn" | "over"; percent: number }[];
};

export function budgetStatus(total: number, limit: number | null): { percent: number | null; status: BudgetStatus } {
  if (!limit) return { percent: null, status: "none" };
  const percent = Math.round((total / limit) * 100);
  return { percent, status: percent >= 100 ? (total > limit ? "over" : "warn") : percent >= 80 ? "warn" : "ok" };
}

const isUnusual = (total: number, average: number) => average > 0 && total > average * 1.3 && total - average >= 5_000;

/** Recorrentes que ainda vão ser lançados no mês (meses depois do último já lançado). */
async function projectedRecurring(db: Db, userId: string, month: string) {
  const { rows } = await db.query(
    `SELECT type, category_id, amount_cents FROM recurring_rules
      WHERE user_id = $1 AND active AND to_char(generated_through, 'YYYY-MM') < $2 AND type <> 'transfer'
        AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.recurring_id = recurring_rules.id AND to_char(x.recurring_month, 'YYYY-MM') = $2)`,
    [userId, month],
  );
  const byCategory = new Map<string | null, number>();
  let income = 0;
  for (const r of rows) {
    if (r.type === "income") income += num(r.amount_cents);
    else byCategory.set(r.category_id, (byCategory.get(r.category_id) ?? 0) + num(r.amount_cents));
  }
  return { byCategory, income };
}

export async function monthBudget(db: Db, userId: string, month: string, now = new Date()): Promise<MonthBudget> {
  const todayStr = today(now);
  const { start, end } = monthRange(month);
  const [categories, summary, history, projected, uncategorized] = await Promise.all([
    listCategories(db, userId, month, now),
    monthSummary(db, userId, month, now),
    expenseHistory(db, userId, month),
    projectedRecurring(db, userId, month),
    db.query(
      `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE paid AND date <= $4::date), 0) AS paid,
              COALESCE(SUM(amount_cents) FILTER (WHERE NOT (paid AND date <= $4::date)), 0) AS pending
         FROM report_transactions
        WHERE user_id = $1 AND type = 'expense' AND category_id IS NULL AND date >= $2 AND date < $3`,
      [userId, start, end, todayStr],
    ),
  ]);

  const line = (c: { id: string; name: string; monthlyLimit: number | null; paidTotal: number; pendingTotal: number }, extraPending: number, average: number, children: BudgetLine[] = []): BudgetLine => {
    const pending = c.pendingTotal + extraPending;
    const total = c.paidTotal + pending;
    return { id: c.id, name: c.name, limit: c.monthlyLimit, paid: c.paidTotal, pending, total, ...budgetStatus(total, c.monthlyLimit), average, unusual: isUnusual(total, average), children };
  };

  const lines = groupCategories(categories.filter((c) => c.kind === "expense"))
    .map((g) => {
      const children = g.children.map((c) => line(c, projected.byCategory.get(c.id) ?? 0, history.categoryAverage(c.id)));
      const own = line(g, projected.byCategory.get(g.id) ?? 0, history.categoryAverage(g.id));
      // Linha da principal com o total do grupo (é nele que vale o limite da principal).
      const paid = own.paid + children.reduce((s, c) => s + c.paid, 0);
      const pending = own.pending + children.reduce((s, c) => s + c.pending, 0);
      const average = own.average + children.reduce((s, c) => s + c.average, 0);
      const total = paid + pending;
      return { ...own, paid, pending, total, average, ...budgetStatus(total, g.monthlyLimit), unusual: isUnusual(total, average), children };
    })
    .filter((l) => l.limit !== null || l.total > 0 || l.children.some((c) => c.limit !== null))
    .sort((a, b) => (b.limit !== null ? 1 : 0) - (a.limit !== null ? 1 : 0) || b.total - a.total);

  // Planejado: limite da principal; sem ele, os limites das subcategorias.
  let planned = 0;
  let plannedSpent = 0;
  for (const l of lines) {
    if (l.limit !== null) {
      planned += l.limit;
      plannedSpent += l.total;
    } else {
      for (const c of l.children) if (c.limit !== null) (planned += c.limit), (plannedSpent += c.total);
    }
  }

  const alerts = lines
    .flatMap((l) => [l, ...l.children])
    .filter((l): l is BudgetLine & { status: "warn" | "over"; percent: number } => l.status === "warn" || l.status === "over")
    .map((l) => ({ name: l.name, status: l.status, percent: l.percent }));

  const uncPending = num(uncategorized.rows[0].pending) + (projected.byCategory.get(null) ?? 0);
  const projectedExpense = [...projected.byCategory.values()].reduce((s, v) => s + v, 0);
  return {
    month,
    lines,
    uncategorized: { paid: num(uncategorized.rows[0].paid), pending: uncPending },
    planned,
    plannedSpent,
    expense: { paid: summary.expense, pending: summary.pendingExpense + projectedExpense, total: summary.expense + summary.pendingExpense + projectedExpense },
    income: { received: summary.income, expected: summary.pendingIncome + projected.income },
    alerts,
  };
}
