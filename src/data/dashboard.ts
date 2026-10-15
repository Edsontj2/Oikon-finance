import { num, type Db } from "@/lib/db";
import { monthRange, today } from "@/lib/dates";
import { listAccounts, type AccountWithBalance } from "./accounts";
import { listCategories, type Category } from "./categories";
import { listTransactions, type Transaction } from "./transactions";

export type MonthSummary = {
  /** Entradas já recebidas no mês. */
  income: number;
  /** Saídas já pagas no mês. */
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
  /** Pendentes com data anterior a hoje (de qualquer mês). */
  overdue: { count: number; expense: number; income: number };
  expenseCategories: Category[];
  recent: Transaction[];
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

export async function getDashboard(db: Db, userId: string, month: string, now = new Date()): Promise<Dashboard> {
  const [accounts, summary, overdueRes, categories, recent] = await Promise.all([
    listAccounts(db, userId),
    monthSummary(db, userId, month),
    db.query(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense'), 0) AS expense,
              COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'), 0) AS income
         FROM transactions
        WHERE user_id = $1 AND NOT paid AND type <> 'transfer' AND date < $2`,
      [userId, today(now)],
    ),
    listCategories(db, userId, month),
    listTransactions(db, userId, { month, limit: 8 }),
  ]);
  const o = overdueRes.rows[0];
  return {
    totalBalance: accounts.reduce((sum, a) => sum + a.balance, 0),
    accounts,
    month: summary,
    overdue: { count: num(o.count), expense: num(o.expense), income: num(o.income) },
    expenseCategories: categories.filter((c) => c.kind === "expense" && (c.monthTotal > 0 || c.monthlyLimit)),
    recent,
  };
}
