import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatMonth, shiftMonth } from "@/lib/dates";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Valor em reais; com signed, mostra + verde ou − vermelho. */
export function Money({ cents, signed = false, testId }: { cents: number; signed?: boolean; testId?: string }) {
  const tone = cents < 0 ? "neg" : cents > 0 && signed ? "pos" : "";
  const text = signed && cents > 0 ? `+ ${formatMoney(cents)}` : formatMoney(cents);
  return (
    <span className={`money ${tone}`} data-testid={testId} data-cents={cents}>
      {text}
    </span>
  );
}

export function Flash({ params }: { params: Record<string, string | string[] | undefined> }) {
  const erro = param(params, "erro");
  const ok = param(params, "ok");
  if (erro) return <p className="flash erro" role="alert">{erro}</p>;
  if (ok) return <p className="flash ok" role="status">{ok}</p>;
  return null;
}

export function MonthNav({ month, path, extra = "" }: { month: string; path: string; extra?: string }) {
  return (
    <nav className="month-nav" aria-label="Mês">
      <Link href={`${path}?mes=${shiftMonth(month, -1)}${extra}`} aria-label="Mês anterior">‹</Link>
      <strong>{formatMonth(month)}</strong>
      <Link href={`${path}?mes=${shiftMonth(month, 1)}${extra}`} aria-label="Próximo mês">›</Link>
    </nav>
  );
}
