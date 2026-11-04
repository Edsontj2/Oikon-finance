/** Previsão de saldo: junta os movimentos previstos por dia e acumula a partir do saldo de hoje. */

export type ForecastMove = { date: string; delta: number; source: "pending" | "recurring" | "invoice" };
export type ForecastPoint = { days: number; date: string; balance: number; inflow: number; outflow: number };
export type Forecast = {
  today: string;
  /** Saldo das contas de dinheiro hoje (sem cartão nem empréstimo). */
  start: number;
  points: ForecastPoint[];
  /** Um ponto por dia, de hoje até o maior horizonte. */
  daily: { date: string; balance: number }[];
  lowest: { date: string; balance: number };
  /** Primeiro dia em que o saldo fica negativo (null se não fica). */
  firstNegative: string | null;
  /** Pendências com data já passada: entram como se fossem pagas/recebidas hoje. */
  overdue: { inflow: number; outflow: number };
};

export const FORECAST_HORIZONS = [7, 15, 30, 60, 90] as const;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildForecast(todayStr: string, start: number, moves: ForecastMove[], horizons: readonly number[] = FORECAST_HORIZONS): Forecast {
  const maxDays = Math.max(...horizons);
  const end = addDays(todayStr, maxDays);
  const byDay = new Map<string, { inflow: number; outflow: number }>();
  const overdue = { inflow: 0, outflow: 0 };
  for (const m of moves) {
    if (m.date > end || m.delta === 0) continue;
    const day = m.date < todayStr ? todayStr : m.date;
    if (m.date < todayStr) m.delta > 0 ? (overdue.inflow += m.delta) : (overdue.outflow -= m.delta);
    const slot = byDay.get(day) ?? { inflow: 0, outflow: 0 };
    if (m.delta > 0) slot.inflow += m.delta;
    else slot.outflow -= m.delta;
    byDay.set(day, slot);
  }
  const daily: Forecast["daily"] = [];
  const points: ForecastPoint[] = [];
  let balance = start;
  let inflow = 0;
  let outflow = 0;
  let lowest = { date: todayStr, balance: start };
  let firstNegative: string | null = start < 0 ? todayStr : null;
  for (let i = 0; i <= maxDays; i++) {
    const date = addDays(todayStr, i);
    const slot = byDay.get(date);
    if (slot) {
      balance += slot.inflow - slot.outflow;
      inflow += slot.inflow;
      outflow += slot.outflow;
    }
    daily.push({ date, balance });
    if (balance < lowest.balance) lowest = { date, balance };
    if (balance < 0 && firstNegative === null) firstNegative = date;
    if (horizons.includes(i)) points.push({ days: i, date, balance, inflow, outflow });
  }
  return { today: todayStr, start, points, daily, lowest, firstNegative, overdue };
}
