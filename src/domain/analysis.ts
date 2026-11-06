/**
 * Cálculos do motor de análise (puros, em centavos inteiros). A IA só lê estes resultados e
 * explica; nenhuma conta de dinheiro é feita pelo modelo. Toda estimativa devolve as premissas
 * usadas, para a resposta poder dizê-las.
 */

/** Divisão em centavos com arredondamento "meio para cima" (sem ponto flutuante acumulado). */
export function divCents(total: number, parts: number): number {
  if (!Number.isInteger(total) || !Number.isInteger(parts) || parts <= 0) throw new Error("divCents: valores inválidos");
  const q = Math.trunc(total / parts);
  const r = total - q * parts;
  return Math.abs(r) * 2 >= parts ? q + Math.sign(total) : q;
}

/** Percentual inteiro de `value` (0–100), arredondado. */
export function percentOf(value: number, pct: number): number {
  return divCents(value * pct, 100);
}

/** Parcelas de uma compra: iguais, e a diferença dos centavos vai para a primeira. */
export function splitInstallments(total: number, count: number): number[] {
  const base = Math.trunc(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? rest : 0));
}

export type MonthStatus = "ok" | "tight" | "short";
export type PurchaseMonth = {
  month: string;
  installment: number;
  /** Parcelas de compras anteriores que caem neste mês. */
  existingInstallments: number;
  /** Renda média − gasto médio sem parcelas − parcelas antigas − a nova parcela. */
  free: number;
  status: MonthStatus;
};
export type PurchaseSimulation = {
  total: number;
  count: number;
  installment: number;
  months: PurchaseMonth[];
  verdict: "fits" | "tight" | "does_not_fit" | "insufficient_data";
  /** A maior parcela que cabe em todos os meses, mantendo a margem (0 se nenhuma). */
  maxInstallment: number;
  safetyMargin: number;
  assumptions: string[];
  limitations: string[];
};

export type Baseline = {
  /** Meses com histórico usados na média. */
  monthsUsed: number;
  averageIncome: number;
  /** Gasto médio por mês sem contar parcelas (essas entram mês a mês). */
  averageExpenseNoInstallments: number;
  available: number;
};

/**
 * "Consigo comprar X em N vezes?" Estimativa mês a mês: renda média − gasto médio (sem
 * parcelas) − parcelas já existentes no mês − a nova parcela, comparado com uma margem de
 * segurança (percentual da renda). Não garante nada: depende do histórico se repetir.
 */
export function simulatePurchase(input: {
  total: number;
  count: number;
  months: string[];
  existingByMonth: Record<string, number>;
  baseline: Baseline;
  safetyPct: number;
}): PurchaseSimulation {
  const { total, count, months, existingByMonth, baseline, safetyPct } = input;
  const parts = splitInstallments(total, count);
  const margin = percentOf(baseline.averageIncome, safetyPct);
  const assumptions = [
    `Renda média de ${baseline.monthsUsed} ${baseline.monthsUsed === 1 ? "mês" : "meses"} anteriores e gasto médio sem parcelas, como se se repetissem.`,
    "Parcelas de compras já feitas entram no mês em que vencem.",
    "A primeira parcela nova entra no próximo mês.",
    `Margem de segurança de ${safetyPct}% da renda para imprevistos.`,
  ];
  const limitations: string[] = [];
  if (baseline.monthsUsed < 2) limitations.push("Há pouco histórico (menos de 2 meses completos com lançamentos): a estimativa é fraca.");
  if (baseline.averageIncome <= 0) limitations.push("Não há entradas registradas nos últimos meses: não dá para estimar a folga.");
  const rows: PurchaseMonth[] = months.map((month, i) => {
    const existing = existingByMonth[month] ?? 0;
    const free = baseline.averageIncome - baseline.averageExpenseNoInstallments - existing - parts[i];
    const status: MonthStatus = free < 0 ? "short" : free < margin ? "tight" : "ok";
    return { month, installment: parts[i], existingInstallments: existing, free, status };
  });
  const capacity = months.map((m) => baseline.averageIncome - baseline.averageExpenseNoInstallments - (existingByMonth[m] ?? 0) - margin);
  const maxInstallment = Math.max(0, Math.min(...capacity));
  let verdict: PurchaseSimulation["verdict"];
  if (baseline.averageIncome <= 0 || baseline.monthsUsed === 0) verdict = "insufficient_data";
  else if (rows.some((r) => r.status === "short")) verdict = "does_not_fit";
  else if (rows.some((r) => r.status === "tight")) verdict = "tight";
  else verdict = "fits";
  return { total, count, installment: parts[parts.length - 1], months: rows, verdict, maxInstallment, safetyMargin: margin, assumptions, limitations };
}

/** "Quanto preciso guardar para juntar X?" */
export function savingsPlan(input: { target: number; saved: number; averageSurplus: number; months: number | null }) {
  const remaining = Math.max(0, input.target - input.saved);
  const monthlyNeeded = input.months && input.months > 0 ? divCents(remaining, input.months) : null;
  const monthsAtCurrentPace = input.averageSurplus > 0 ? Math.ceil(remaining / input.averageSurplus) : null;
  return { remaining, monthlyNeeded, averageSurplus: input.averageSurplus, monthsAtCurrentPace };
}

/** "Quanto posso gastar por dia até receber?" */
export function dailyAllowance(input: { available: number; dueBefore: number; days: number; reserve: number }) {
  const days = Math.max(1, input.days);
  const free = input.available - input.dueBefore - input.reserve;
  return { free, days, perDay: free > 0 ? Math.trunc(free / days) : 0 };
}

export type CategoryDiff = { name: string; a: number; b: number; diff: number; percent: number | null };

/** Compara gastos por categoria entre dois meses (b em relação a a), maiores diferenças primeiro. */
export function compareCategories(a: Map<string, number>, b: Map<string, number>): CategoryDiff[] {
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names]
    .map((name) => {
      const va = a.get(name) ?? 0;
      const vb = b.get(name) ?? 0;
      return { name, a: va, b: vb, diff: vb - va, percent: va > 0 ? Math.round(((vb - va) * 100) / va) : null };
    })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.name.localeCompare(y.name));
}
