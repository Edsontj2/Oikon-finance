import Link from "next/link";
import { CalendarClock, Gauge } from "lucide-react";
import type { MonthSummary, OpenInstallment } from "@/data/dashboard";
import { monthPace } from "@/domain/pace";
import { formatDate, formatMonth } from "@/lib/dates";
import { Money } from "@/components/money";

/** Ritmo do mês corrente: média por dia, quanto ainda dá para gastar por dia e quanto sobra. */
export function PaceCard({ today, month }: { today: string; month: MonthSummary }) {
  const p = monthPace(today, month);
  return (
    <section className="card" aria-labelledby="ritmo-title">
      <h2 id="ritmo-title" className="card-icon-title"><Gauge size={18} aria-hidden /> Ritmo do mês</h2>
      <div className="metrics">
        <div className="metric">
          <span className="label">Pode gastar por dia</span>
          <Money cents={p.perDayAvailable} testId="pode-gastar-dia" />
          <span className="hint">
            {p.monthLeftover > 0
              ? `nos ${p.daysLeft} dias que faltam, sem fechar o mês no negativo`
              : p.monthLeftover < 0
                ? "o mês já fecha no negativo com o que está lançado"
                : "lance as entradas do mês para calcular"}
          </span>
        </div>
        <div className="metric">
          <span className="label">Gasto médio por dia</span>
          <Money cents={p.dailyAverage} testId="media-dia" />
          <span className="hint">nos {p.dayOfMonth} dias até hoje</span>
        </div>
        <div className="metric">
          <span className="label">Sobra prevista do mês</span>
          <Money cents={p.monthLeftover} signed testId="sobra-mes" />
          <span className="hint">entradas − saídas, pagas e pendentes</span>
        </div>
        <div className="metric">
          <span className="label">Guardado do que recebeu</span>
          <strong className="metric-value" data-testid="taxa-economia">
            {p.savingsRate === null ? "—" : `${Math.round(p.savingsRate * 100)}%`}
          </strong>
          <span className="hint">{p.savingsRate === null ? "nenhuma entrada recebida ainda" : "entradas recebidas − saídas pagas"}</span>
        </div>
      </div>
      <div className="progress" aria-label={`Dia ${p.dayOfMonth} de ${p.daysInMonth}`}>
        <span style={{ width: `${(p.dayOfMonth / p.daysInMonth) * 100}%` }} />
      </div>
      <p className="hint">Dia {p.dayOfMonth} de {p.daysInMonth}</p>
    </section>
  );
}

/** Compras parceladas em aberto: quanto falta, a próxima parcela e quando termina cada uma. */
export function InstallmentsCard({ items }: { items: OpenInstallment[] }) {
  const remaining = items.reduce((s, i) => s + i.remaining, 0);
  const perMonth = items.reduce((s, i) => s + i.nextAmount, 0);
  const freeFrom = items.reduce((last, i) => (i.lastDate > last ? i.lastDate : last), "");
  return (
    <section className="card" aria-labelledby="parcelas-title">
      <h2 id="parcelas-title" className="card-icon-title"><CalendarClock size={18} aria-hidden /> Parcelamentos</h2>
      {items.length === 0 ? (
        <p className="muted">Nenhuma compra parcelada em aberto. Para lançar uma, use &quot;Parcelado&quot; no novo lançamento.</p>
      ) : (
        <>
          <div className="metrics metrics-3">
            <div className="metric">
              <span className="label">Falta pagar</span>
              <Money cents={remaining} testId="parcelas-restante" />
            </div>
            <div className="metric">
              <span className="label">Parcelas por mês</span>
              <Money cents={perMonth} testId="parcelas-mes" />
            </div>
            <div className="metric">
              <span className="label">Livre das parcelas</span>
              <strong className="metric-value metric-text" data-testid="parcelas-fim">{formatMonth(freeFrom.slice(0, 7))}</strong>
            </div>
          </div>
          <ul className="mini-list">
            {items.slice(0, 5).map((i) => (
              <li key={i.seriesId} className="mini-list-block" data-testid="parcelamento">
                <span className="mini-list-line">
                  <span>{i.description}</span>
                  <Money cents={i.remaining} />
                </span>
                <span className="hint">
                  {i.settledCount} de {i.count} pagas · próxima {formatDate(i.nextDate)} de <Money cents={i.nextAmount} /> · termina em{" "}
                  {formatDate(i.lastDate)}
                </span>
                <span className="bar" aria-hidden><span style={{ width: `${(i.settledCount / i.count) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
          {items.length > 5 && <p className="hint">e mais {items.length - 5}.</p>}
        </>
      )}
      <Link href="/lancamentos" className="card-link">Ver lançamentos</Link>
    </section>
  );
}
