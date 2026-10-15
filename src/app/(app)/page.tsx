import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { currentMonth, formatDate, isValidMonth } from "@/lib/dates";
import { getDashboard } from "@/data/dashboard";
import { accountTypes } from "@/data/accounts";
import { Flash, Money, MonthNav, param, type SearchParams } from "../ui";
import { signedAmount } from "./lancamentos/amount";

export default async function PainelPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const mes = param(params, "mes");
  const month = mes && isValidMonth(mes) ? mes : currentMonth();
  const d = await getDashboard(getDb(), userId, month);
  const result = d.month.income - d.month.expense;

  return (
    <>
      <h1>Painel</h1>
      <Flash params={params} />
      <MonthNav month={month} path="/" />

      <div className="grid">
        <div className="card stat">
          <div className="label">Saldo total (todas as contas)</div>
          <div className="value"><Money cents={d.totalBalance} testId="saldo-total" /></div>
        </div>
        <div className="card stat">
          <div className="label">Entradas recebidas no mês</div>
          <div className="value"><Money cents={d.month.income} testId="entradas-mes" /></div>
        </div>
        <div className="card stat">
          <div className="label">Saídas pagas no mês</div>
          <div className="value"><Money cents={-d.month.expense} testId="saidas-mes" /></div>
        </div>
        <div className="card stat">
          <div className="label">Resultado do mês</div>
          <div className="value"><Money cents={result} signed testId="resultado-mes" /></div>
        </div>
      </div>

      <div className="grid">
        <div className="card stat">
          <div className="label">A receber no mês</div>
          <div className="value"><Money cents={d.month.pendingIncome} testId="a-receber" /></div>
        </div>
        <div className="card stat">
          <div className="label">A pagar no mês</div>
          <div className="value"><Money cents={d.month.pendingExpense} testId="a-pagar" /></div>
        </div>
        {d.overdue.count > 0 && (
          <div className="card stat">
            <div className="label">Pendentes atrasados</div>
            <div className="value" data-testid="atrasados">{d.overdue.count}</div>
            <div className="muted">
              <Money cents={-d.overdue.expense} /> a pagar · <Money cents={d.overdue.income} /> a receber
            </div>
          </div>
        )}
      </div>

      <div className="grid">
        <section className="card">
          <h2>Contas</h2>
          <table>
            <tbody>
              {d.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}<div className="hint">{accountTypes[a.type]}</div></td>
                  <td className="num"><Money cents={a.balance} testId={`saldo-${a.name}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><Link href="/contas">Gerenciar contas</Link></p>
        </section>

        <section className="card">
          <h2>Gastos por categoria</h2>
          {d.expenseCategories.length === 0 && <p className="muted">Nenhuma saída neste mês.</p>}
          {d.expenseCategories.map((c) => {
            const pct = c.monthlyLimit ? Math.min(100, Math.round((c.monthTotal / c.monthlyLimit) * 100)) : 0;
            const over = c.monthlyLimit !== null && c.monthTotal > c.monthlyLimit;
            return (
              <div key={c.id} className="cat-row">
                <div className="top">
                  <span>{c.name}</span>
                  <span>
                    <Money cents={c.monthTotal} />
                    {c.monthlyLimit && <span className="muted"> de <Money cents={c.monthlyLimit} /></span>}
                  </span>
                </div>
                {c.monthlyLimit && (
                  <div className={`bar ${over ? "over" : ""}`} title={`${pct}% do limite`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <section className="card">
        <h2>Últimos lançamentos do mês</h2>
        {d.recent.length === 0 ? (
          <p className="muted">
            Nada lançado neste mês. <Link href={`/lancamentos?mes=${month}`}>Fazer um lançamento</Link>
          </p>
        ) : (
          <table>
            <tbody>
              {d.recent.map((t) => (
                <tr key={t.id}>
                  <td className="hide-sm">{formatDate(t.date)}</td>
                  <td>
                    {t.description} {!t.paid && <span className="tag pendente">pendente</span>}
                  </td>
                  <td className="num"><Money cents={signedAmount(t)} signed={t.type !== "transfer"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p><Link href={`/lancamentos?mes=${month}`}>Ver todos</Link></p>
      </section>
    </>
  );
}
