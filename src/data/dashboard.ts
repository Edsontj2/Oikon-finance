import { num, type Db } from "@/lib/db";
import { currentMonth, monthRange, shiftMonth, today } from "@/lib/dates";
import { buildInsights, type Insight } from "@/domain/insights";
import { listAccounts, type AccountWithBalance } from "./accounts";
import { listCategories, type Category } from "./categories";
import { listTransactions, type Transaction } from "./transactions";

export type MonthSummary = {
  /** Entradas do mês marcadas como recebidas. */
  income: number;
  /** Saídas do mês marcadas como pagas. */
  expense: number;
  /** Entradas do mês ainda não recebidas. */
  pendingIncome: number;
  /** Saídas do mês ainda não pagas. */
  pendingExpense: number;
};

export type Dashboard = {
  totalBalance: number;
  accounts: AccountWithBalance[];
  month: MonthSummary;
  /** Pendentes com data anterior a hoje (de qualquer mês), igual à marcação "atrasado" da lista. */
  overdue: { count: number; expense: number; income: number; transfer: number };
  /** Gastos por categoria: a soma de `paidTotal` (+ sem categoria) é igual a `month.expense`. */
  expenseCategories: Category[];
  uncategorized: { paidTotal: number; pendingTotal: number };
  recent: Transaction[];
  insights: Insight[];
};

/** Transferências não entram: só mudam o dinheiro de lugar, não são ganho nem gasto. */
export async function monthSummary(db: Db, userId: string, month: string): Promise<MonthSummary> {
  const { start, end } = monthRange(month);
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'  AND paid), 0)     AS income,
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense' AND paid), 0)     AS expense,
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'  AND NOT paid), 0) AS pending_income,
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense' AND NOT paid), 0) AS pending_expense
     FROM transactions
     WHERE user_id = $1 AND date >= $2 AND date < $3`,
    [userId, start, end],
  );
  const r = rows[0];
  return {
    income: num(r.income),
    expense: num(r.expense),
    pendingIncome: num(r.pending_income),
    pendingExpense: num(r.pending_expense),
  };
}

async function overdueAndDueSoon(db: Db, userId: string, todayStr: string) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE date < $2) AS overdue_count,
       COALESCE(SUM(amount_cents) FILTER (WHERE date < $2 AND type = 'expense'), 0)  AS overdue_expense,
       COALESCE(SUM(amount_cents) FILTER (WHERE date < $2 AND type = 'income'), 0)   AS overdue_income,
       COALESCE(SUM(amount_cents) FILTER (WHERE date < $2 AND type = 'transfer'), 0) AS overdue_transfer,
       COUNT(*) FILTER (WHERE date >= $2 AND date <= ($2::date + 7) AND type <> 'income') AS soon_count,
       COALESCE(SUM(amount_cents) FILTER (WHERE date >= $2 AND date <= ($2::date + 7) AND type <> 'income'), 0) AS soon_amount
     FROM transactions
     WHERE user_id = $1 AND NOT paid`,
    [userId, todayStr],
  );
  const r = rows[0];
  return {
    overdue: {
      count: num(r.overdue_count),
      expense: num(r.overdue_expense),
      income: num(r.overdue_income),
      transfer: num(r.overdue_transfer),
    },
    dueSoon: { count: num(r.soon_count), amount: num(r.soon_amount) },
  };
}

async function uncategorizedExpense(db: Db, userId: string, month: string) {
  const { start, end } = monthRange(month);
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE paid), 0) AS paid,
            COALESCE(SUM(amount_cents) FILTER (WHERE NOT paid), 0) AS pending
       FROM transactions
      WHERE user_id = $1 AND type = 'expense' AND category_id IS NULL AND date >= $2 AND date < $3`,
    [userId, start, end],
  );
  return { paidTotal: num(rows[0].paid), pendingTotal: num(rows[0].pending) };
}

/** Saídas (pagas e pendentes) dos 3 meses anteriores, no total e por categoria. */
async function expenseHistory(db: Db, userId: string, month: string) {
  const months = [3, 2, 1].map((n) => shiftMonth(month, -n));
  const { rows } = await db.query(
    `SELECT to_char(date, 'YYYY-MM') AS month, category_id, SUM(amount_cents) AS total
       FROM transactions
      WHERE user_id = $1 AND type = 'expense' AND date >= $2 AND date < $3
      GROUP BY 1, 2`,
    [userId, `${months[0]}-01`, monthRange(month).start],
  );
  const totals = months.map((m) => rows.filter((r) => r.month === m).reduce((s, r) => s + num(r.total), 0));
  const byCategory = new Map<string, number>();
  for (const r of rows) if (r.category_id) byCategory.set(r.category_id, (byCategory.get(r.category_id) ?? 0) + num(r.total));
  return { totals, categoryAverage: (id: string) => (byCategory.get(id) ?? 0) / months.length };
}

export async function getDashboard(db: Db, userId: string, month: string, now = new Date()): Promise<Dashboard> {
  const todayStr = today(now);
  const [accounts, summary, pending, categories, uncategorized, recent, history] = await Promise.all([
    listAccounts(db, userId, now),
    monthSummary(db, userId, month),
    overdueAndDueSoon(db, userId, todayStr),
    listCategories(db, userId, month),
    uncategorizedExpense(db, userId, month),
    listTransactions(db, userId, { month, limit: 8 }),
    expenseHistory(db, userId, month),
  ]);
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const expenseCategories = categories.filter((c) => c.kind === "expense");

  const insights = buildInsights({
    month,
    isCurrentMonth: month === currentMonth(now),
    totalBalance,
    accounts,
    ...summary,
    overdue: pending.overdue,
    dueSoon: pending.dueSoon,
    previousExpenses: history.totals,
    categories: expenseCategories.map((c) => ({
      name: c.name,
      monthTotal: c.monthTotal,
      monthlyLimit: c.monthlyLimit,
      previousAverage: history.categoryAverage(c.id),
    })),
  });

  return {
    totalBalance,
    accounts,
    month: summary,
    overdue: pending.overdue,
    expenseCategories: expenseCategories.filter((c) => c.monthTotal > 0 || c.monthlyLimit !== null),
    uncategorized,
    recent,
    insights,
  };
}
