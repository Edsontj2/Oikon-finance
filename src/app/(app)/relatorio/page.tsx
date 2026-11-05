import { Download } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMonth, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { monthParam, type SearchParams } from "@/lib/search-params";
import { getDashboard } from "@/data/dashboard";
import { monthBudget } from "@/data/budget";
import { listCards } from "@/data/cards";
import { listLoans } from "@/data/loans";
import { listTransactions } from "@/data/transactions";
import { accountTypes, isMoneyAccount } from "@/domain/accounts";
import { signedAmount, transactionTypes } from "@/domain/transactions";
import { MonthNav } from "@/components/month-nav";
import { PrintButton } from "./print-button";

/** Relatório do mês, pensado para imprimir ou salvar em PDF (o menu e as cores somem na impressão). */
export default async function RelatorioPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const month = monthParam(await searchParams);
  const db = getDb();
  const [d, budget, cards, loans, transactions] = await Promise.all([
    getDashboard(db, user.id, month),
    monthBudget(db, user.id, month),
    listCards(db, user.id),
    listLoans(db, user.id),
    listTransactions(db, user.id, { month, limit: 500 }),
  ]);
  const money = d.accounts.filter((a) => isMoneyAccount(a.type) && !a.archived);
  const debts = loans.filter((l) => !l.settledAt);
  const result = d.month.income - d.month.expense;
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <article className="report">
      <div className="page-head no-print">
        <h1>Relatório</h1>
        <div className="stack-actions">
          <a className="btn btn-secondary" href={`/api/exportar?mes=${month}`} download><Download size={18} aria-hidden /> Exportar CSV</a>
          <PrintButton />
        </div>
      </div>
      <div className="no-print"><MonthNav month={month} path="/relatorio" /></div>
      <p className="hint no-print">No celular: Salvar em PDF → Compartilhar ou &quot;Salvar em Arquivos&quot;. No computador: escolha &quot;Salvar como PDF&quot; como impressora.</p>

      <header className="report-head">
        <h2>Relatório financeiro · {formatMonth(month)}</h2>
        <p>{user.name} · gerado em {formatDate(today())} · OIKON Finance</p>
      </header>

      <section className="report-section">
        <h3>Resumo do mês</h3>
        <table className="report-table">
          <tbody>
            <tr><th scope="row">Entradas recebidas</th><td>{formatMoney(d.month.income)}</td></tr>
            <tr><th scope="row">Saídas pagas</th><td>{formatMoney(-d.month.expense)}</td></tr>
            <tr><th scope="row">Resultado</th><td><strong>{formatMoney(result)}</strong></td></tr>
            {d.month.pendingIncome > 0 && <tr><th scope="row">A receber no mês</th><td>{formatMoney(d.month.pendingIncome)}</td></tr>}
            {d.month.pendingExpense > 0 && <tr><th scope="row">A pagar no mês</th><td>{formatMoney(-d.month.pendingExpense)}</td></tr>}
            <tr><th scope="row">Saldo total hoje (patrimônio)</th><td>{formatMoney(d.totalBalance)}</td></tr>
          </tbody>
        </table>
        <p className="hint">Transferências entre contas não contam como entrada nem saída.</p>
      </section>

      <section className="report-section">
        <h3>Gastos por categoria</h3>
        {budget.lines.length === 0 && budget.uncategorized.paid + budget.uncategorized.pending === 0 ? (
          <p>Nenhuma saída neste mês.</p>
        ) : (
          <table className="report-table">
            <thead><tr><th scope="col">Categoria</th><th scope="col">Gasto</th><th scope="col">Limite</th><th scope="col">Uso</th></tr></thead>
            <tbody>
              {budget.lines.flatMap((l) => [
                <tr key={l.id}><th scope="row">{l.name}</th><td>{formatMoney(l.total)}</td><td>{l.limit ? formatMoney(l.limit) : "—"}</td><td>{l.percent !== null ? `${l.percent}%` : "—"}</td></tr>,
                ...l.children.map((c) => (
                  <tr key={c.id} className="report-child"><th scope="row">↳ {c.name}</th><td>{formatMoney(c.total)}</td><td>{c.limit ? formatMoney(c.limit) : "—"}</td><td>{c.percent !== null ? `${c.percent}%` : "—"}</td></tr>
                )),
              ])}
              {budget.uncategorized.paid + budget.uncategorized.pending > 0 && (
                <tr><th scope="row">Sem categoria</th><td>{formatMoney(budget.uncategorized.paid + budget.uncategorized.pending)}</td><td>—</td><td>—</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-section">
        <h3>Contas</h3>
        <table className="report-table">
          <thead><tr><th scope="col">Conta</th><th scope="col">Tipo</th><th scope="col">Saldo hoje</th></tr></thead>
          <tbody>
            {money.map((a) => <tr key={a.id}><th scope="row">{a.name}</th><td>{accountTypes[a.type]}</td><td>{formatMoney(a.balance)}</td></tr>)}
          </tbody>
        </table>
      </section>

      {cards.length > 0 && (
        <section className="report-section">
          <h3>Cartões de crédito</h3>
          <table className="report-table">
            <thead><tr><th scope="col">Cartão</th><th scope="col">Fatura a pagar</th><th scope="col">Vencimento</th><th scope="col">Limite livre</th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td>{c.toPay ? formatMoney(Math.max(0, c.toPay.remaining)) : "—"}</td>
                  <td>{c.toPay ? formatDate(c.toPay.dueDate) : "—"}</td>
                  <td>{c.limit.available !== null ? formatMoney(c.limit.available) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {debts.length > 0 && (
        <section className="report-section">
          <h3>Dívidas e empréstimos</h3>
          <table className="report-table">
            <thead><tr><th scope="col">Contrato</th><th scope="col">Saldo</th><th scope="col">Parcelas</th><th scope="col">Próxima</th></tr></thead>
            <tbody>
              {debts.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.name}{l.kind === "lent" ? " (emprestei)" : ""}</th>
                  <td>{formatMoney(l.balance)}</td>
                  <td>{l.paidCount}/{l.installments}</td>
                  <td>{l.next ? `${formatDate(l.next.date)} · ${formatMoney(l.next.amount)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="report-section">
        <h3>Lançamentos de {formatMonth(month)} ({sorted.length})</h3>
        {sorted.length === 0 ? (
          <p>Nada lançado neste mês.</p>
        ) : (
          <table className="report-table report-small">
            <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Conta</th><th scope="col">Categoria</th><th scope="col">Valor</th></tr></thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.date)}</td>
                  <th scope="row">{t.description}{!t.paid && " (pendente)"}</th>
                  <td>{t.toAccountName ? `${t.accountName} → ${t.toAccountName}` : t.accountName}</td>
                  <td>{t.categoryName ?? (t.type === "transfer" ? transactionTypes.transfer : "—")}</td>
                  <td>{formatMoney(signedAmount(t))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sorted.length === 500 && <p className="hint">Mostrando os 500 primeiros. Use &quot;Exportar CSV&quot; para a lista completa.</p>}
      </section>
    </article>
  );
}
