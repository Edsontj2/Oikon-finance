/**
 * Motor de análise financeira: as consultas que o OIKON IA usa. Cada função recebe o usuário
 * autenticado e só lê dados dele; tudo em centavos e já calculado aqui (o modelo nunca faz
 * conta). Reaproveita os serviços do app (painel, previsão, cartões, agenda, metas, orçamento).
 */
import { num, type Db } from "@/lib/db";
import { currentMonth, isValidMonth, monthRange, shiftMonth, today } from "@/lib/dates";
import { isMoneyAccount } from "@/domain/accounts";
import { compareCategories, dailyAllowance, savingsPlan, simulatePurchase, type Baseline } from "@/domain/analysis";
import { addDays } from "@/domain/forecast";
import { listAccounts } from "./accounts";
import { listCardDetails } from "./cards";
import { listBills } from "./bills";
import { listGoals } from "./goals";
import { balanceForecast } from "./forecast";
import { monthSummary, openInstallments } from "./dashboard";
import { monthBudget } from "./budget";
import { getOverview } from "./overview";
import { searchTransactions } from "./transactions";
import { UserError } from "./errors";

function checkMonth(month: string | undefined, now: Date): string {
  const m = month ?? currentMonth(now);
  if (!isValidMonth(m)) throw new UserError("Mês inválido (use AAAA-MM).");
  return m;
}

export async function getAccountBalances(db: Db, userId: string, now = new Date()) {
  const accounts = (await listAccounts(db, userId, now)).filter((a) => !a.archived);
  return {
    accounts: accounts.map((a) => ({ name: a.name, type: a.type, balance: a.balance, projectedBalance: a.projectedBalance })),
    availableInAccounts: accounts.filter((a) => isMoneyAccount(a.type)).reduce((s, a) => s + a.balance, 0),
  };
}

export async function getMonthlyIncome(db: Db, userId: string, month?: string, now = new Date()) {
  const m = checkMonth(month, now);
  const s = await monthSummary(db, userId, m, now);
  return { month: m, received: s.income, expected: s.pendingIncome, total: s.income + s.pendingIncome };
}

export async function getMonthlyExpenses(db: Db, userId: string, month?: string, now = new Date()) {
  const m = checkMonth(month, now);
  const s = await monthSummary(db, userId, m, now);
  return { month: m, paid: s.expense, toPay: s.pendingExpense, total: s.expense + s.pendingExpense };
}

export async function getExpensesByCategory(db: Db, userId: string, month?: string, now = new Date()) {
  const m = checkMonth(month, now);
  const b = await monthBudget(db, userId, m, now);
  const flat = b.lines.flatMap((l) => [l, ...l.children.map((c) => ({ ...c, name: `${l.name} › ${c.name}` }))]);
  return {
    month: m,
    categories: flat
      .filter((l) => l.total > 0 || l.limit)
      .map((l) => ({ name: l.name, paid: l.paid, pending: l.pending, total: l.total, budget: l.limit, average3Months: l.average, unusual: l.unusual }))
      .sort((x, y) => y.total - x.total),
    uncategorized: b.uncategorized.paid + b.uncategorized.pending,
    total: b.expense.total,
    budgetAlerts: b.alerts,
  };
}

export async function getTransactions(
  db: Db, userId: string, filter: { month?: string; type?: "income" | "expense" | "transfer"; search?: string; limit?: number }, now = new Date(),
) {
  const month = filter.month ? checkMonth(filter.month, now) : undefined;
  const { items, total } = await searchTransactions(db, userId, { month, type: filter.type, search: filter.search, limit: Math.min(filter.limit ?? 30, 50) });
  return {
    totalCount: total,
    shown: items.length,
    items: items.map((t) => ({
      date: t.date, description: t.description, type: t.type, amount: t.amount, paid: t.paid, account: t.accountName,
      category: t.categoryName, installment: t.installmentCount ? `${t.installmentNumber}/${t.installmentCount}` : null,
    })),
  };
}

export async function getCreditCardInvoices(db: Db, userId: string, now = new Date()) {
  const cards = await listCardDetails(db, userId, now);
  return cards.map((c) => ({
    name: c.name,
    limit: c.creditLimit,
    limitAvailable: c.limit?.available ?? null,
    toPay: c.toPay ? { month: c.toPay.month, dueDate: c.toPay.dueDate, remaining: c.toPay.remaining, status: c.toPay.status } : null,
    current: c.current ? { month: c.current.month, closingDate: c.current.closingDate, total: c.current.total } : null,
    upcoming: c.upcoming,
  }));
}

export async function getUpcomingBills(db: Db, userId: string, days = 30, now = new Date()) {
  const horizon = Math.min(Math.max(Math.floor(days), 1), 90);
  const limit = addDays(today(now), horizon);
  const { groups } = await listBills(db, userId, now);
  const items = groups.flatMap((g) => g.items.map((i) => ({ ...i, overdue: g.key === "overdue" }))).filter((i) => i.date <= limit);
  return {
    days: horizon,
    items: items.map((i) => ({ date: i.date, description: i.description, kind: i.kind, amount: i.amount, account: i.accountName, overdue: i.overdue, projected: Boolean(i.projected) })),
    toPay: items.filter((i) => i.kind === "pay" || i.kind === "invoice").reduce((s, i) => s + i.amount, 0),
    toReceive: items.filter((i) => i.kind === "receive").reduce((s, i) => s + i.amount, 0),
  };
}

export async function getFinancialGoals(db: Db, userId: string, now = new Date()) {
  const goals = await listGoals(db, userId, now);
  return goals.map((g) => ({
    name: g.name, kind: g.kind, target: g.target, targetDate: g.targetDate, saved: g.progress.saved, remaining: g.progress.remaining,
    percent: g.progress.percent, monthlyNeeded: g.progress.monthlyNeeded, status: g.progress.status,
  }));
}

export async function getCashFlowForecast(db: Db, userId: string, now = new Date()) {
  const f = await balanceForecast(db, userId, now);
  return {
    today: f.today, start: f.start,
    points: f.points.map((p) => ({ days: p.days, date: p.date, balance: p.balance, inflow: p.inflow, outflow: p.outflow })),
    lowest: f.lowest, firstNegative: f.firstNegative,
    assumptions: ["Considera pendentes, contas de todo mês e faturas de cartão nas datas previstas, se tudo for pago e recebido em dia."],
  };
}

export async function getFinancialSummary(db: Db, userId: string, now = new Date()) {
  const month = currentMonth(now);
  const [overview, summary, forecast] = await Promise.all([getOverview(db, userId, now), monthSummary(db, userId, month, now), balanceForecast(db, userId, now)]);
  const in30 = forecast.points.find((p) => p.days === 30);
  return {
    month,
    available: overview.available,
    netWorth: overview.netWorth,
    monthIncome: { received: summary.income, expected: summary.pendingIncome },
    monthExpense: { paid: summary.expense, toPay: summary.pendingExpense },
    monthResult: summary.income + summary.pendingIncome - summary.expense - summary.pendingExpense,
    cards: { toPay: overview.cards.toPay, openInvoices: overview.cards.openInvoices },
    debts: overview.debts,
    commitmentPercent: overview.commitment.percent,
    forecast30Days: in30 ? in30.balance : null,
    firstNegativeDate: forecast.firstNegative,
  };
}

/** Compara os gastos por categoria de dois meses (padrão: este mês e o anterior). */
export async function compareMonthlyExpenses(db: Db, userId: string, monthA?: string, monthB?: string, now = new Date()) {
  const b = checkMonth(monthB, now);
  const a = monthA ? checkMonth(monthA, now) : shiftMonth(b, -1);
  const byMonth = async (m: string) => {
    const { start, end } = monthRange(m);
    const { rows } = await db.query(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(r.amount_cents) AS total
         FROM report_transactions r LEFT JOIN categories c ON c.id = r.category_id
        WHERE r.user_id = $1 AND r.type = 'expense' AND r.date >= $2 AND r.date < $3 GROUP BY 1`,
      [userId, start, end],
    );
    return new Map(rows.map((r) => [r.name as string, num(r.total)]));
  };
  const [ma, mb] = await Promise.all([byMonth(a), byMonth(b)]);
  const totalA = [...ma.values()].reduce((s, v) => s + v, 0);
  const totalB = [...mb.values()].reduce((s, v) => s + v, 0);
  return {
    monthA: a, monthB: b, totalA, totalB, diff: totalB - totalA,
    categories: compareCategories(ma, mb).slice(0, 15),
    note: b === currentMonth(now) ? "O mês atual ainda não terminou: inclui os pendentes já lançados." : null,
  };
}

/** Renda e gasto médios (sem parcelas) dos últimos 3 meses completos com lançamentos. */
export async function spendingBaseline(db: Db, userId: string, now = new Date()): Promise<Baseline> {
  const cur = currentMonth(now);
  const first = shiftMonth(cur, -3);
  const { rows } = await db.query(
    `SELECT to_char(r.date, 'YYYY-MM') AS month,
            COALESCE(SUM(r.amount_cents) FILTER (WHERE r.type = 'income'), 0) AS income,
            COALESCE(SUM(r.amount_cents) FILTER (WHERE r.type = 'expense' AND t.installment_count IS NULL), 0) AS expense
       FROM report_transactions r
       JOIN transactions t ON t.id = r.id
      WHERE r.user_id = $1 AND r.date >= $2 AND r.date < $3
      GROUP BY 1`,
    [userId, `${first}-01`, monthRange(cur).start],
  );
  const used = rows.filter((r) => num(r.income) > 0 || num(r.expense) > 0);
  const n = used.length;
  const available = (await getAccountBalances(db, userId, now)).availableInAccounts;
  if (!n) return { monthsUsed: 0, averageIncome: 0, averageExpenseNoInstallments: 0, available };
  const sum = (k: "income" | "expense") => used.reduce((s, r) => s + num(r[k]), 0);
  return { monthsUsed: n, averageIncome: Math.round(sum("income") / n), averageExpenseNoInstallments: Math.round(sum("expense") / n), available };
}

const MAX_PURCHASE = 100_000_000_00; // R$ 100 milhões

/** "Consigo comprar um celular de R$ 2.000 em 10 vezes?" */
export async function simulateInstallmentPurchase(
  db: Db, userId: string, input: { total: number; installments: number; safetyPct?: number }, now = new Date(),
) {
  if (!Number.isInteger(input.total) || input.total <= 0 || input.total > MAX_PURCHASE) throw new UserError("Valor da compra inválido.");
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 48) throw new UserError("Parcelas: de 1 a 48.");
  const safetyPct = input.safetyPct ?? 10;
  if (!Number.isInteger(safetyPct) || safetyPct < 0 || safetyPct > 50) throw new UserError("Margem de segurança: de 0% a 50%.");
  const cur = currentMonth(now);
  const months = Array.from({ length: input.installments }, (_, i) => shiftMonth(cur, i + 1));
  const [baseline, open] = await Promise.all([spendingBaseline(db, userId, now), db.query(
    `SELECT to_char(date, 'YYYY-MM') AS month, SUM(amount_cents) AS total
       FROM transactions
      WHERE user_id = $1 AND type = 'expense' AND installment_count IS NOT NULL AND NOT (paid AND date <= $2::date)
        AND date >= $3 AND date < $4
      GROUP BY 1`,
    [userId, today(now), `${months[0]}-01`, monthRange(months[months.length - 1]).end],
  )]);
  const existingByMonth = Object.fromEntries(open.rows.map((r) => [r.month as string, num(r.total)]));
  const result = simulatePurchase({ total: input.total, count: input.installments, months, existingByMonth, baseline, safetyPct });
  return { ...result, baseline, disclaimer: "Estimativa com base no seu histórico, não uma garantia de que a compra é segura." };
}

/** "Quanto posso gastar por dia até receber?" */
export async function getDailySpendingAllowance(db: Db, userId: string, now = new Date()) {
  const todayStr = today(now);
  const [{ availableInAccounts }, bills] = await Promise.all([getAccountBalances(db, userId, now), getUpcomingBills(db, userId, 45, now)]);
  const nextIncome = bills.items.find((i) => i.kind === "receive" && !i.overdue && i.date >= todayStr) ?? null;
  const until = nextIncome?.date ?? addDays(todayStr, 30);
  const dueBefore = bills.items.filter((i) => (i.kind === "pay" || i.kind === "invoice") && i.date <= until).reduce((s, i) => s + i.amount, 0);
  const days = Math.max(1, Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${todayStr}T12:00:00Z`)) / 86_400_000));
  const r = dailyAllowance({ available: availableInAccounts, dueBefore, days, reserve: 0 });
  return {
    ...r, available: availableInAccounts, dueBefore, until,
    nextIncome: nextIncome ? { date: nextIncome.date, description: nextIncome.description, amount: nextIncome.amount } : null,
    assumptions: [
      nextIncome ? `Até a próxima entrada prevista (${nextIncome.description}).` : "Sem entrada prevista lançada: considerei os próximos 30 dias.",
      "Desconta as contas e faturas que vencem até lá.",
    ],
  };
}

/** "Quanto preciso economizar para juntar R$ 5.000?" */
export async function planSavings(db: Db, userId: string, input: { target: number; months?: number | null }, now = new Date()) {
  if (!Number.isInteger(input.target) || input.target <= 0 || input.target > MAX_PURCHASE) throw new UserError("Valor do objetivo inválido.");
  if (input.months != null && !(Number.isInteger(input.months) && input.months >= 1 && input.months <= 600)) throw new UserError("Meses: de 1 a 600.");
  const baseline = await spendingBaseline(db, userId, now);
  const installments = (await openInstallments(db, userId, today(now))).reduce((s, i) => s + i.nextAmount, 0);
  const surplus = baseline.averageIncome - baseline.averageExpenseNoInstallments - installments;
  return {
    ...savingsPlan({ target: input.target, saved: 0, averageSurplus: surplus, months: input.months ?? null }),
    target: input.target, baselineMonths: baseline.monthsUsed,
    assumptions: ["Sobra média = renda média − gasto médio sem parcelas − parcelas do próximo mês."],
  };
}
