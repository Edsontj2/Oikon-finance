import Link from "next/link";
import { AlertTriangle, CalendarRange, PiggyBank, Target } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { monthParam, type SearchParams } from "@/lib/search-params";
import { balanceForecast } from "@/data/forecast";
import { monthBudget, type BudgetLine } from "@/data/budget";
import { Money } from "@/components/money";
import { MonthNav } from "@/components/month-nav";
import { LineChart } from "@/components/line-chart";

function BudgetRow({ line, child = false }: { line: BudgetLine; child?: boolean }) {
  const pct = line.limit ? Math.min(100, Math.round((line.total / line.limit) * 100)) : 0;
  return (
    <li className={`budget-line ${child ? "child" : ""}`} data-testid="orcamento-linha">
      <span className="mini-list-line">
        <span>
          {child && <span className="muted" aria-hidden>↳ </span>}
          {line.name}
          {line.status === "over" && <> <span className="tag tag-late">estourou</span></>}
          {line.status === "warn" && <> <span className="tag tag-pending">{line.percent}% do limite</span></>}
          {line.unusual && <> <span className="tag tag-pending" title={`Média dos 3 meses anteriores: ${formatMoney(line.average)}`}>acima do normal</span></>}
        </span>
        <span>
          <Money cents={line.total} />
          {line.limit !== null && <span className="muted"> de <Money cents={line.limit} /></span>}
        </span>
      </span>
      {line.pending > 0 && <span className="hint"><Money cents={line.paid} /> pago + <Money cents={line.pending} /> pendente ou previsto</span>}
      {line.limit !== null && (
        <>
          <span className={`bar ${line.status === "over" ? "over" : line.status === "warn" ? "warn" : ""}`}><span style={{ width: `${pct}%` }} /></span>
          <span className="hint">
            {line.total <= line.limit ? <>Sobram <Money cents={line.limit - line.total} /></> : <>Passou <Money cents={line.total - line.limit} /></>}
          </span>
        </>
      )}
    </li>
  );
}

export default async function PlanejamentoPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUserId();
  const month = monthParam(await searchParams);
  const db = getDb();
  const [forecast, budget] = await Promise.all([balanceForecast(db, userId), monthBudget(db, userId, month)]);
  const chartPoints = forecast.daily
    .filter((_, i) => i % 3 === 0 || i === forecast.daily.length - 1)
    .map((d) => ({ key: d.date, label: formatDate(d.date).slice(0, 5), value: d.balance }));
  const planned = budget.planned;

  return (
    <>
      <div className="page-head">
        <h1>Planejamento</h1>
        <Link href="/metas" className="btn btn-secondary"><Target size={18} aria-hidden /> Metas</Link>
      </div>

      <section className="card" aria-labelledby="previsao-title">
        <h2 id="previsao-title" className="card-icon-title"><CalendarRange size={18} aria-hidden /> Previsão de saldo</h2>
        <p className="muted">
          Dinheiro nas contas hoje: <Money cents={forecast.start} testId="previsao-hoje" />. Somamos o que está agendado, os
          recorrentes dos próximos meses e as faturas de cartão no vencimento.
        </p>
        <div className="horizons">
          {forecast.points.map((p) => (
            <div key={p.days} className="horizon" data-testid={`previsao-${p.days}`}>
              <div className="label">Em {p.days} dias · {formatDate(p.date).slice(0, 5)}</div>
              <div className={`value ${p.balance < 0 ? "negative" : ""}`}><Money cents={p.balance} /></div>
              <div className="hint">+{formatMoney(p.inflow)} · −{formatMoney(p.outflow)}</div>
            </div>
          ))}
        </div>
        {forecast.firstNegative && (
          <div className="insight insight-bad" role="note">
            <AlertTriangle size={18} aria-hidden />
            <div>
              <strong>O saldo fica negativo em {formatDate(forecast.firstNegative)}.</strong> O ponto mais baixo é{" "}
              {formatMoney(forecast.lowest.balance)} em {formatDate(forecast.lowest.date)}.
            </div>
          </div>
        )}
        <LineChart points={chartPoints} ariaLabel="Saldo previsto nos próximos 90 dias" tickEvery={8} tableTitle="Dia" />
        <p className="hint">
          É uma previsão: considera que tudo será pago e recebido na data.
          {forecast.overdue.inflow + forecast.overdue.outflow > 0 && (
            <> Atrasados entram como se fossem resolvidos hoje ({formatMoney(forecast.overdue.outflow)} a pagar, {formatMoney(forecast.overdue.inflow)} a receber).</>
          )}
        </p>
      </section>

      <section className="card" aria-labelledby="orcamento-title">
        <h2 id="orcamento-title" className="card-icon-title"><PiggyBank size={18} aria-hidden /> Orçamento de {formatMonth(month)}</h2>
        <MonthNav month={month} path="/planejamento" />
        <div className="grid">
          <div className="stat">
            <div className="label">Planejado (limites)</div>
            <div className="value"><Money cents={planned} testId="orcamento-planejado" /></div>
            {planned > 0 && <div className="hint">Gasto nessas categorias: <Money cents={budget.plannedSpent} testId="orcamento-gasto" /></div>}
          </div>
          <div className="stat">
            <div className="label">Saídas do mês</div>
            <div className="value"><Money cents={budget.expense.total} testId="orcamento-saidas" /></div>
            <div className="hint"><Money cents={budget.expense.paid} /> pago · <Money cents={budget.expense.pending} /> pendente ou previsto</div>
          </div>
          <div className="stat">
            <div className="label">Entradas do mês</div>
            <div className="value"><Money cents={budget.income.received + budget.income.expected} testId="orcamento-entradas" /></div>
            <div className="hint"><Money cents={budget.income.received} /> recebido · <Money cents={budget.income.expected} /> previsto</div>
          </div>
          <div className="stat">
            <div className="label">Sobra prevista</div>
            <div className="value"><Money cents={budget.income.received + budget.income.expected - budget.expense.total} signed testId="orcamento-sobra" /></div>
          </div>
        </div>

        {budget.lines.length === 0 && budget.uncategorized.paid + budget.uncategorized.pending === 0 ? (
          <p className="muted">Nenhuma saída neste mês. Defina limites em <Link href="/categorias">Categorias</Link> para planejar.</p>
        ) : (
          <ul className="list">
            {budget.lines.flatMap((l) => [<BudgetRow key={l.id} line={l} />, ...l.children.map((c) => <BudgetRow key={c.id} line={c} child />)])}
            {budget.uncategorized.paid + budget.uncategorized.pending > 0 && (
              <li className="budget-line">
                <span className="mini-list-line">
                  <span>Sem categoria</span>
                  <Money cents={budget.uncategorized.paid + budget.uncategorized.pending} />
                </span>
              </li>
            )}
          </ul>
        )}
        <p className="hint">
          O planejado é o limite mensal de cada categoria (o da principal vale para as subcategorias juntas). Em meses futuros, os
          lançamentos &quot;Todo mês&quot; entram como previstos. <Link href={`/categorias?mes=${month}`}>Ajustar limites</Link>
        </p>
      </section>
    </>
  );
}
