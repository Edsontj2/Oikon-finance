import Link from "next/link";
import { AlertTriangle, CircleAlert, Info, Sparkles, TrendingUp } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { formatDate, formatMonth } from "@/lib/dates";
import { monthParam, type SearchParams } from "@/lib/search-params";
import { getDashboard } from "@/data/dashboard";
import { getOverview } from "@/data/overview";
import { balanceForecast } from "@/data/forecast";
import { formatMoney } from "@/lib/money";
import { LineChart } from "@/components/line-chart";
import { accountTypes } from "@/domain/accounts";
import { signedAmount } from "@/domain/transactions";
import type { Insight } from "@/domain/insights";
import { Money } from "@/components/money";
import { MonthNav } from "@/components/month-nav";
import { LimitBar } from "./categorias/limit-bar";
import { InstallmentsCard, PaceCard } from "./dashboard-cards";
import { FlowChart } from "./flow-chart";

const insightIcons: Record<Insight["tone"], typeof Info> = {
  bad: CircleAlert,
  warn: AlertTriangle,
  good: TrendingUp,
  info: Info,
};

export default async function PainelPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUserId();
  const month = monthParam(await searchParams);
  const db = getDb();
  const [d, overview, forecast] = await Promise.all([getDashboard(db, userId, month), getOverview(db, userId), balanceForecast(db, userId)]);
  const result = d.month.income - d.month.expense;
  const isCurrentMonth = month === d.today.slice(0, 7);
  const categoryRows = [
    ...d.expenseCategories,
    ...(d.uncategorized.paidTotal + d.uncategorized.pendingTotal > 0
      ? [{ id: "sem-categoria", name: "Sem categoria", monthlyLimit: null, ...d.uncategorized, monthTotal: d.uncategorized.paidTotal + d.uncategorized.pendingTotal }]
      : []),
  ].sort((a, b) => b.monthTotal - a.monthTotal);

  return (
    <>
      <div className="page-head">
        <h1>Painel</h1>
      </div>
      <MonthNav month={month} path="/" />

      <div className="grid">
        <div className="card stat">
          <div className="label">Saldo total hoje</div>
          <div className="value"><Money cents={d.totalBalance} testId="saldo-total" /></div>
        </div>
        <div className="card stat">
          <div className="label">Entradas recebidas</div>
          <div className="value"><Money cents={d.month.income} testId="entradas-mes" /></div>
          {d.month.pendingIncome > 0 && <div className="hint">+ <Money cents={d.month.pendingIncome} testId="a-receber" /> a receber</div>}
        </div>
        <div className="card stat">
          <div className="label">Saídas pagas</div>
          <div className="value"><Money cents={-d.month.expense} testId="saidas-mes" /></div>
          {d.month.pendingExpense > 0 && <div className="hint"><Money cents={d.month.pendingExpense} testId="a-pagar" /> a pagar</div>}
        </div>
        <div className="card stat">
          <div className="label">Resultado do mês</div>
          <div className="value"><Money cents={result} signed testId="resultado-mes" /></div>
        </div>
      </div>

      <section className="card overview" aria-labelledby="panorama-title">
        <h2 id="panorama-title">Panorama hoje</h2>
        <div className="grid">
          <div className="stat">
            <div className="label">Dinheiro nas contas</div>
            <div className="value"><Money cents={overview.available} testId="saldo-disponivel" /></div>
            <div className="hint">Patrimônio líquido: <Money cents={overview.netWorth} testId="patrimonio" /> (contas − cartões − dívidas)</div>
          </div>
          {overview.cards.count > 0 && (
            <div className="stat">
              <div className="label">Cartões: fatura a pagar</div>
              <div className="value"><Money cents={overview.cards.toPay} testId="faturas-a-pagar" /></div>
              <div className="hint">
                Fatura aberta: <Money cents={overview.cards.openInvoices} />
                {overview.cards.limit !== null && <> · limite livre <Money cents={overview.cards.limitAvailable ?? 0} /> de <Money cents={overview.cards.limit} /></>}
              </div>
            </div>
          )}
          {(overview.debts.count > 0 || overview.debts.lentReceivable > 0) && (
            <div className="stat">
              <div className="label">Dívidas em aberto</div>
              <div className="value"><Money cents={overview.debts.owed} testId="dividas-abertas" /></div>
              {overview.debts.lentReceivable > 0 && <div className="hint">A receber de empréstimos: <Money cents={overview.debts.lentReceivable} /></div>}
            </div>
          )}
          <div className="stat">
            <div className="label">Renda comprometida</div>
            <div className="value" data-testid="comprometimento">{overview.commitment.percent === null ? "—" : `${overview.commitment.percent}%`}</div>
            <div className="hint">
              {formatMoney(overview.commitment.monthly)} por mês em parcelas e contas fixas
              {overview.commitment.averageIncome > 0 ? <> · renda média {formatMoney(overview.commitment.averageIncome)}</> : " · sem renda registrada nos últimos meses"}
            </div>
          </div>
        </div>
        <h3 className="label">Previsão de dinheiro nas contas</h3>
        <div className="horizons">
          {forecast.points.map((p) => (
            <Link key={p.days} href="/planejamento" className={`horizon ${p.balance < 0 ? "negative" : ""}`}>
              <div className="label">{p.days} dias</div>
              <div className={`value ${p.balance < 0 ? "negative" : ""}`}>{formatMoney(p.balance)}</div>
            </Link>
          ))}
        </div>
        {forecast.firstNegative && <p className="hint negative-text">Atenção: pelo previsto, o saldo fica negativo em {formatDate(forecast.firstNegative)}.</p>}
        <Link href="/planejamento" className="card-link">Ver previsão e orçamento</Link>
      </section>

      <section className="card insights" aria-labelledby="insights-title">
        <h2 id="insights-title"><Sparkles size={18} aria-hidden /> Análise de {formatMonth(month).split(" de ")[0]}</h2>
        <ul>
          {d.insights.map((insight, i) => {
            const Icon = insightIcons[insight.tone];
            return (
              <li key={i} className={`insight insight-${insight.tone}`}>
                <Icon size={18} aria-hidden />
                <div>
                  <strong>{insight.title}</strong>
                  {insight.detail && <span>{insight.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className={isCurrentMonth ? "grid grid-2" : undefined}>
        {isCurrentMonth && <PaceCard today={d.today} month={d.month} />}
        <InstallmentsCard items={d.installments} />
      </div>

      <FlowChart flow={d.flow} />

      <section className="card" aria-labelledby="patrimonio-title">
        <h2 id="patrimonio-title" className="card-icon-title"><TrendingUp size={18} aria-hidden /> Evolução do patrimônio · 12 meses</h2>
        <LineChart
          points={overview.netWorthHistory.map((p) => ({ key: p.month, label: formatMonth(p.month).slice(0, 3) + "/" + p.month.slice(2, 4), value: p.net, detail: `Contas ${formatMoney(p.assets)} · cartões e dívidas ${formatMoney(p.debts)}` }))}
          ariaLabel="Patrimônio líquido no fim de cada mês"
          tickEvery={3}
          tableTitle="Mês"
        />
        <p className="hint">Saldo no fim de cada mês (o atual, até hoje), somando contas e descontando cartões e dívidas.</p>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2>Contas</h2>
          <ul className="mini-list">
            {d.accounts.filter((a) => !a.archived).map((a) => (
              <li key={a.id}>
                <span>{a.name}<span className="hint">{accountTypes[a.type]}</span></span>
                <Money cents={a.balance} testId={`saldo-${a.name}`} />
              </li>
            ))}
          </ul>
          <Link href="/contas" className="card-link">Gerenciar contas</Link>
        </section>

        <section className="card">
          <h2>Gastos por categoria</h2>
          {categoryRows.length === 0 ? (
            <p className="muted">Nenhuma saída neste mês.</p>
          ) : (
            <ul className="mini-list">
              {categoryRows.map((c) => (
                <li key={c.id} className="mini-list-block">
                  <span className="mini-list-line">
                    <span>{c.name}</span>
                    <span>
                      <Money cents={c.paidTotal} />
                      {c.monthlyLimit !== null && <span className="muted"> de <Money cents={c.monthlyLimit} /></span>}
                    </span>
                  </span>
                  {c.pendingTotal > 0 && <span className="hint">+ <Money cents={c.pendingTotal} /> pendente</span>}
                  {c.monthlyLimit !== null && <LimitBar total={c.monthTotal} limit={c.monthlyLimit} />}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/categorias?mes=${month}`} className="card-link">Ver categorias</Link>
        </section>
      </div>

      <section className="card">
        <h2>Últimos lançamentos do mês</h2>
        {d.recent.length === 0 ? (
          <p className="muted">Nada lançado neste mês.</p>
        ) : (
          <ul className="mini-list">
            {d.recent.map((t) => (
              <li key={t.id}>
                <span>
                  {t.description} {!t.paid && <span className="tag tag-pending">pendente</span>}
                  <span className="hint">{formatDate(t.date)}</span>
                </span>
                <Money cents={signedAmount(t)} signed={t.type !== "transfer"} />
              </li>
            ))}
          </ul>
        )}
        <Link href={`/lancamentos?mes=${month}`} className="card-link">Ver todos os lançamentos do mês</Link>
      </section>
    </>
  );
}
