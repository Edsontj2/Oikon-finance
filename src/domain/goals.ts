/** Metas: regras puras (sem banco), para a tela e os testes. */
import { addMonths } from "@/lib/dates";

export type GoalKind = "goal" | "emergency";
export const goalKinds: Record<GoalKind, string> = { goal: "Objetivo", emergency: "Reserva de emergência" };

export type GoalStatus = "done" | "on_track" | "behind" | "late" | "no_date";

export type GoalProgress = {
  saved: number;
  remaining: number;
  percent: number;
  /** Meses inteiros até a data (o mês atual conta). */
  monthsLeft: number | null;
  /** Quanto guardar por mês para chegar na data. */
  monthlyNeeded: number | null;
  status: GoalStatus;
};

/** Meses do mês de `from` até o de `to`, contando os dois (mínimo 1). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

/**
 * Progresso de uma meta. "No ritmo" compara o guardado com uma linha reta da criação até a data:
 * é uma referência simples, não uma previsão.
 */
export function goalProgress(input: { target: number; saved: number; targetDate: string | null; createdAt: string; today: string }): GoalProgress {
  const saved = Math.max(0, input.saved);
  const remaining = Math.max(0, input.target - saved);
  const percent = Math.min(100, Math.floor((saved / input.target) * 100));
  if (remaining === 0) return { saved, remaining, percent: 100, monthsLeft: null, monthlyNeeded: null, status: "done" };
  if (!input.targetDate) return { saved, remaining, percent, monthsLeft: null, monthlyNeeded: null, status: "no_date" };
  if (input.targetDate < input.today) return { saved, remaining, percent, monthsLeft: 0, monthlyNeeded: remaining, status: "late" };
  const monthsLeft = monthsBetween(input.today, input.targetDate);
  const monthlyNeeded = Math.ceil(remaining / monthsLeft);
  const total = monthsBetween(input.createdAt, input.targetDate);
  const elapsed = total - monthsLeft;
  const expected = Math.floor((input.target * elapsed) / total);
  return { saved, remaining, percent, monthsLeft, monthlyNeeded, status: saved >= expected ? "on_track" : "behind" };
}

export const goalStatusLabel: Record<GoalStatus, string> = {
  done: "Concluída",
  on_track: "No ritmo",
  behind: "Abaixo do ritmo",
  late: "Prazo passou",
  no_date: "Sem prazo",
};

/** Reserva de emergência sugerida: meses × gasto médio mensal (arredondado para cima em R$ 100). */
export function emergencyTarget(averageMonthlyExpense: number, months: number): number {
  return Math.ceil((averageMonthlyExpense * months) / 10_000) * 10_000;
}

/** Data em que a meta chega lá guardando `monthly` por mês (null se não guardar nada). */
export function reachDate(remaining: number, monthly: number, today: string): string | null {
  if (remaining <= 0) return today;
  if (monthly <= 0) return null;
  return addMonths(today, Math.ceil(remaining / monthly));
}
