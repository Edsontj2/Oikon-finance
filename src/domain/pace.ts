/** Métricas de ritmo do mês corrente: quanto já foi gasto por dia e quanto ainda dá para gastar. */
export type MonthPace = {
  dayOfMonth: number;
  daysInMonth: number;
  /** Dias que faltam contando hoje. */
  daysLeft: number;
  /** Saídas já pagas divididas pelos dias que passaram (contando hoje). */
  dailyAverage: number;
  /** O que sobra no mês com tudo o que está lançado: entradas − saídas (pagas e pendentes). */
  monthLeftover: number;
  /** Quanto dá para gastar por dia, até o fim do mês, sem o mês fechar no negativo (0 se já fecha). */
  perDayAvailable: number;
  /** Parte das entradas recebidas que não saiu (null sem entradas). */
  savingsRate: number | null;
};

export function monthPace(
  todayStr: string,
  m: { income: number; expense: number; pendingIncome: number; pendingExpense: number },
): MonthPace {
  const [year, month, day] = todayStr.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysLeft = daysInMonth - day + 1;
  const monthLeftover = m.income + m.pendingIncome - m.expense - m.pendingExpense;
  return {
    dayOfMonth: day,
    daysInMonth,
    daysLeft,
    dailyAverage: Math.round(m.expense / day),
    monthLeftover,
    perDayAvailable: monthLeftover > 0 ? Math.floor(monthLeftover / daysLeft) : 0,
    savingsRate: m.income > 0 ? (m.income - m.expense) / m.income : null,
  };
}
