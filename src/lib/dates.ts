const TIME_ZONE = "America/Sao_Paulo";

/** Data de hoje no fuso de São Paulo, como "AAAA-MM-DD". */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export function currentMonth(now: Date = new Date()): string {
  return today(now).slice(0, 7);
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-10" -> { start: "2026-10-01", end: "2026-11-01" } (fim exclusivo). */
export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

/** "2026-01", -1 -> "2025-12" */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Soma meses mantendo o dia; se o mês não tiver o dia (31/01 + 1), usa o último dia do mês. */
export function addMonths(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const month = shiftMonth(`${y}-${String(m).padStart(2, "0")}`, delta);
  const [ny, nm] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${month}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

const monthNames = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-10" -> "outubro de 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${monthNames[m - 1]} de ${y}`;
}

/** "2026-10-05" -> "05/10/2026" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
