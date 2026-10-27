import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/dates";

/** Uma observação sobre as finanças do mês, calculada a partir dos lançamentos. */
export type Insight = {
  tone: "bad" | "warn" | "good" | "info";
  title: string;
  detail?: string;
};

export type InsightInput = {
  /** Mês exibido ("AAAA-MM") e se é o mês corrente. */
  month: string;
  isCurrentMonth: boolean;
  totalBalance: number;
  accounts: Array<{ name: string; type: string; balance: number }>;
  /** Do mês exibido: pago e pendente, em centavos. */
  income: number;
  expense: number;
  pendingIncome: number;
  pendingExpense: number;
  overdue: { count: number; expense: number; income: number };
  dueSoon: { count: number; amount: number };
  /** Total de saídas (pagas + pendentes) de cada um dos 3 meses anteriores. */
  previousExpenses: number[];
  categories: Array<{ name: string; monthTotal: number; monthlyLimit: number | null; previousAverage: number }>;
};

const MAX_INSIGHTS = 5;
const order: Record<Insight["tone"], number> = { bad: 0, warn: 1, good: 2, info: 3 };

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Regras simples e explicáveis; devolve as mais importantes primeiro. */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const monthName = formatMonth(input.month).split(" de ")[0];
  const committedExpense = input.expense + input.pendingExpense;

  if (input.overdue.count > 0) {
    const parts = [
      input.overdue.expense > 0 ? `${formatMoney(input.overdue.expense)} a pagar` : null,
      input.overdue.income > 0 ? `${formatMoney(input.overdue.income)} a receber` : null,
    ].filter(Boolean);
    out.push({
      tone: "bad",
      title: `${plural(input.overdue.count, "lançamento atrasado", "lançamentos atrasados")}`,
      detail: `${parts.join(" e ") || "Pendências"} com data vencida. Se já pagou, marque como pago em Lançamentos.`,
    });
  }

  for (const account of input.accounts) {
    if (account.balance < 0 && account.type !== "credit_card") {
      out.push({ tone: "bad", title: `${account.name} está no negativo`, detail: `Saldo de ${formatMoney(account.balance)}.` });
    }
  }

  for (const c of input.categories) {
    if (c.monthlyLimit === null) continue;
    if (c.monthTotal > c.monthlyLimit) {
      out.push({
        tone: "warn",
        title: `${c.name} passou do limite`,
        detail: `${formatMoney(c.monthTotal)} de ${formatMoney(c.monthlyLimit)} (${formatMoney(c.monthTotal - c.monthlyLimit)} acima).`,
      });
    } else if (c.monthTotal >= c.monthlyLimit * 0.8) {
      out.push({
        tone: "info",
        title: `${c.name} está perto do limite`,
        detail: `${percent(c.monthTotal / c.monthlyLimit)} usado: restam ${formatMoney(c.monthlyLimit - c.monthTotal)}.`,
      });
    }
  }

  if (input.isCurrentMonth && input.dueSoon.count > 0) {
    out.push({
      tone: "warn",
      title: `${plural(input.dueSoon.count, "conta vence", "contas vencem")} nos próximos 7 dias`,
      detail: `Total de ${formatMoney(input.dueSoon.amount)}.`,
    });
  }

  if (input.isCurrentMonth && (input.pendingIncome > 0 || input.pendingExpense > 0)) {
    const endOfMonth = input.totalBalance + input.pendingIncome - input.pendingExpense;
    out.push(
      endOfMonth < 0
        ? { tone: "bad", title: `Previsão: ${monthName} termina no negativo`, detail: `Com os pendentes do mês, o saldo total fica em ${formatMoney(endOfMonth)}.` }
        : { tone: "info", title: `Previsão para o fim de ${monthName}: ${formatMoney(endOfMonth)}`, detail: "Saldo total se tudo o que está pendente no mês for pago e recebido." },
    );
  }

  const history = input.previousExpenses.filter((v) => v > 0);
  if (history.length > 0 && committedExpense > 0) {
    const average = history.reduce((s, v) => s + v, 0) / history.length;
    const change = (committedExpense - average) / average;
    if (change >= 0.1) {
      out.push({
        tone: "warn",
        title: `Gastos de ${monthName} ${percent(change)} acima da média`,
        detail: `${formatMoney(committedExpense)} contra a média de ${formatMoney(Math.round(average))} dos últimos ${plural(history.length, "mês", "meses")}.`,
      });
    } else if (change <= -0.1 && !input.isCurrentMonth) {
      out.push({
        tone: "good",
        title: `Gastos de ${monthName} ${percent(-change)} abaixo da média`,
        detail: `${formatMoney(committedExpense)} contra a média de ${formatMoney(Math.round(average))}.`,
      });
    }
  }

  const grew = input.categories
    .filter((c) => c.previousAverage > 0 && c.monthTotal - c.previousAverage >= 5000 && c.monthTotal >= c.previousAverage * 1.25)
    .sort((a, b) => b.monthTotal - b.previousAverage - (a.monthTotal - a.previousAverage))[0];
  if (grew) {
    out.push({
      tone: "info",
      title: `${grew.name} cresceu este mês`,
      detail: `${formatMoney(grew.monthTotal - Math.round(grew.previousAverage))} a mais que a média dos meses anteriores.`,
    });
  }

  if (input.income > 0) {
    const saved = input.income - input.expense;
    if (saved < 0) {
      out.push({ tone: "bad", title: "Saídas pagas maiores que as entradas", detail: `Diferença de ${formatMoney(-saved)} em ${monthName}.` });
    } else if (saved / input.income >= 0.1) {
      out.push({ tone: "good", title: `Você guardou ${percent(saved / input.income)} do que recebeu`, detail: `${formatMoney(saved)} em ${monthName} até agora.` });
    }
  }

  if (out.length === 0) {
    out.push(
      committedExpense === 0 && input.income === 0
        ? { tone: "info", title: "Ainda sem movimento neste mês", detail: "Lance entradas e saídas para ver análises aqui." }
        : { tone: "good", title: "Tudo em dia", detail: "Nenhum atraso, limite estourado ou alerta neste mês." },
    );
  }

  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, MAX_INSIGHTS);
}
