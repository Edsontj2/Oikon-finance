import { num, type Db } from "@/lib/db";
import { currentMonth, monthRange, shiftMonth, today } from "@/lib/dates";
import { buildInsights, type Insight } from "@/domain/insights";
import { listAccounts, type AccountWithBalance } from "./accounts";
import { listCategories, type Category } from "./categories";
import { listTransactions, type Transaction } from "./transactions";

/**
 * "Pago" aqui é o que já mexeu no saldo: marcado como pago E com data até hoje (a mesma regra
 * do saldo das contas). Pago com data futura conta como pendente até o dia chegar.
 */
export type MonthSummary = {
  /** Entradas do mês já recebidas. */
  income: number;
  /** Saídas do mês já pagas. */
  expense: number;
  /** Entradas do mês ainda por receber. */
  pendingIncome: number;
  /** Saídas do mês ainda por pagar. */
  pendingExpense: number;
};

/** Condição SQL de "já mexeu no saldo"; `todayParam` é o parâmetro ($n) com a data de hoje. */
const settled = (alias: string, todayParam: string) => `(${alias}paid AND ${alias}date <= ${todayParam}::date)`;

/** Uma compra parcelada que ainda tem parcelas por pagar. */
export type OpenInstallment = {
  seriesId: string;
  description: string;
  count: number;
  /** Parcelas que já saíram do saldo. */
  settledCount: number;
  /** Valor da próxima parcela e quanto falta no total, em centavos. */
  nextAmount: number;
  remaining: number;
  nextDate: string;
  lastDate: string;
};

/** Entradas e saídas lançadas num mês (pagas e pendentes; transferências não entram). */
export type MonthFlow = { month: string; income: number; expense: number };

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
  installments: OpenInstallment[];
  /** Os 6 meses que terminam no mês exibido, do mais antigo ao mais novo. */
  flow: MonthFlow[];
  /** Hoje ("AAAA-MM-DD"), para as métricas de ritmo do mês corrente. */
  today: string;
};

/** Transferências não entram: só mudam o dinheiro de lugar, não são ganho nem gasto. */
export async function monthSummary(db: Db, userId: string, month: string, now = new Date()): Promise<MonthSummary> {
  const { start, end } = monthRange(month);
  const done = settled("", "$4");
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'  AND ${done}), 0)     AS income,
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense' AND ${done}), 0)     AS expense,
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'  AND NOT ${done}), 0) AS pending_income,
       COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense' AND NOT ${done}), 0) AS pending_expense
     FROM transactions
     WHERE user_id = $1 AND date >= $2 AND date < $3`,
    [userId, start, end, today(now)],
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

/**
 * Saldo total no fim do mês se tudo o que vence até lá for pago e recebido: o que já mexeu
 * no saldo + todos os lançamentos com data até o fim do mês (inclusive atrasados de antes).
 */
async function endOfMonthBalance(db: Db, userId: string, month: string, todayStr: string): Promise<number> {
  const { end } = monthRange(month);
  const { rows } = await db.query(
    `SELECT (SELECT COALESCE(SUM(initial_balance_cents), 0) FROM accounts WHERE user_id = $1)
          + (SELECT COALESCE(SUM(delta), 0) FROM transaction_effects
              WHERE user_id = $1 AND ((paid AND date <= $3::date) OR date < $2)) AS total`,
    [userId, end, todayStr],
  );
  return num(rows[0].total);
}

/** Compras parceladas (saídas) com parcelas ainda por pagar, as que terminam antes primeiro. */
async function openInstallments(db: Db, userId: string, todayStr: string): Promise<OpenInstallment[]> {
  const { rows } = await db.query(
    `SELECT series_id,
            (array_agg(description ORDER BY installment_number))[1] AS description,
            max(installment_count) AS count,
            count(*) FILTER (WHERE paid AND date <= $2::date) AS settled_count,
            (array_agg(amount_cents ORDER BY date) FILTER (WHERE NOT (paid AND date <= $2::date)))[1] AS next_amount,
            SUM(amount_cents) FILTER (WHERE NOT (paid AND date <= $2::date)) AS remaining,
            to_char(min(date) FILTER (WHERE NOT (paid AND date <= $2::date)), 'YYYY-MM-DD') AS next_date,
            to_char(max(date), 'YYYY-MM-DD') AS last_date
       FROM transactions
      WHERE user_id = $1 AND type = 'expense' AND installment_count IS NOT NULL
      GROUP BY series_id
     HAVING count(*) FILTER (WHERE NOT (paid AND date <= $2::date)) > 0
      ORDER BY max(date), 2`,
    [userId, todayStr],
  );
  return rows.map((r) => ({
    seriesId: r.series_id,
    description: r.description,
    count: num(r.count),
    settledCount: num(r.settled_count),
    nextAmount: num(r.next_amount),
    remaining: num(r.remaining),
    nextDate: r.next_date,
    lastDate: r.last_date,
  }));
}

async function monthlyFlow(db: Db, userId: string, month: string): Promise<MonthFlow[]> {
  const months = [5, 4, 3, 2, 1, 0].map((n) => shiftMonth(month, -n));
  const { rows } = await db.query(
    `SELECT to_char(date, 'YYYY-MM') AS month,
            COALESCE(SUM(amount_cents) FILTER (WHERE type = 'income'), 0) AS income,
            COALESCE(SUM(amount_cents) FILTER (WHERE type = 'expense'), 0) AS expense
       FROM transactions
      WHERE user_id = $1 AND date >= $2 AND date < $3
      GROUP BY 1`,
    [userId, `${months[0]}-01`, monthRange(month).end],
  );
  return months.map((m) => {
    const r = rows.find((x) => x.month === m);
    return { month: m, income: r ? num(r.income) : 0, expense: r ? num(r.expense) : 0 };
  });
}

async function uncategorizedExpense(db: Db, userId: string, month: string, todayStr: string) {
  const { start, end } = monthRange(month);
  const done = settled("", "$4");
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE ${done}), 0) AS paid,
            COALESCE(SUM(amount_cents) FILTER (WHERE NOT ${done}), 0) AS pending
       FROM transactions
      WHERE user_id = $1 AND type = 'expense' AND category_id IS NULL AND date >= $2 AND date < $3`,
    [userId, start, end, todayStr],
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
  const [accounts, summary, pending, categories, uncategorized, recent, history, endOfMonth, installments, flow] = await Promise.all([
    listAccounts(db, userId, now),
    monthSummary(db, userId, month, now),
    overdueAndDueSoon(db, userId, todayStr),
    listCategories(db, userId, month, now),
    uncategorizedExpense(db, userId, month, todayStr),
    listTransactions(db, userId, { month, limit: 8 }),
    expenseHistory(db, userId, month),
    endOfMonthBalance(db, userId, month, todayStr),
    openInstallments(db, userId, todayStr),
    monthlyFlow(db, userId, month),
  ]);
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const expenseCategories = categories.filter((c) => c.kind === "expense");

  const insights = buildInsights({
    month,
    isCurrentMonth: month === currentMonth(now),
    isFutureMonth: month > currentMonth(now),
    installmentsEnding: installments
      .filter((i) => i.lastDate.startsWith(month))
      .map((i) => ({ description: i.description, amount: i.nextAmount })),
    totalBalance,
    endOfMonthBalance: endOfMonth,
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
    installments,
    flow,
    today: todayStr,
  };
}
