import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonth, shiftMonth } from "@/lib/dates";
import { withParams } from "@/lib/search-params";

/** ‹ outubro de 2026 › — mantém os outros filtros da página. */
export function MonthNav({ month, path, params = {} }: { month: string; path: string; params?: Record<string, string | undefined> }) {
  return (
    <nav className="month-nav" aria-label="Mês">
      <Link href={withParams(path, { ...params, mes: shiftMonth(month, -1) })} aria-label="Mês anterior">
        <ChevronLeft size={18} aria-hidden />
      </Link>
      <strong>{formatMonth(month)}</strong>
      <Link href={withParams(path, { ...params, mes: shiftMonth(month, 1) })} aria-label="Próximo mês">
        <ChevronRight size={18} aria-hidden />
      </Link>
    </nav>
  );
}
