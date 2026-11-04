import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { currentMonth, isValidMonth, shiftMonth } from "@/lib/dates";
import { param, withParams, type SearchParams } from "@/lib/search-params";
import { listAccountOptions } from "@/data/accounts";
import { listCategoryOptions } from "@/data/categories";
import { monthSummary } from "@/data/dashboard";
import { isTransactionType, searchTransactions } from "@/data/transactions";
import { projectedRecurring, projectedTotals } from "@/data/recurring";
import { Money } from "@/components/money";
import { FilterBar, type Filters } from "./filter-bar";
import { TransactionsView } from "./transactions-view";

const PAGE_SIZE = 50;
const MAX_SHOWN = 500;

export default async function LancamentosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const db = getDb();
  const [accounts, categories] = await Promise.all([listAccountOptions(db, userId, { includeArchived: true }), listCategoryOptions(db, userId)]);

  // Filtros inválidos na URL são ignorados (voltam para "todos").
  const mes = param(params, "mes");
  const conta = param(params, "conta");
  const tipo = param(params, "tipo");
  const filters: Filters = {
    mes: mes && isValidMonth(mes) ? mes : undefined,
    conta: accounts.some((a) => a.id === conta) ? conta : undefined,
    tipo: isTransactionType(tipo) ? tipo : undefined,
    busca: param(params, "busca")?.slice(0, 120) || undefined,
  };
  const shown = Math.min(Math.max(Number(param(params, "mostrar")) || PAGE_SIZE, PAGE_SIZE), MAX_SHOWN);

  // Mês futuro: os "Todo mês" aparecem como previstos, um por mês (ainda não existem no banco).
  const projectedPromise = filters.mes
    ? projectedRecurring(db, userId, filters.mes, { accountId: filters.conta, type: isTransactionType(filters.tipo) ? filters.tipo : undefined, search: filters.busca })
    : Promise.resolve([]);
  const [{ items: found, total: foundTotal }, summary, projected] = await Promise.all([
    searchTransactions(db, userId, {
      month: filters.mes,
      accountId: filters.conta,
      type: isTransactionType(filters.tipo) ? filters.tipo : undefined,
      search: filters.busca,
      limit: shown,
    }),
    // Com conta, tipo ou busca o resumo do mês inteiro não bateria com a lista: só aparece com o filtro de mês sozinho.
    filters.mes && !filters.conta && !filters.tipo && !filters.busca ? monthSummary(db, userId, filters.mes) : null,
    projectedPromise,
  ]);
  const items = [...projected, ...found].sort((a, b) => b.date.localeCompare(a.date));
  const total = foundTotal + projected.length;
  const toPay = summary ? summary.pendingExpense + projectedTotals(projected).expense : 0;
  const toReceive = summary ? summary.pendingIncome + projectedTotals(projected).income : 0;

  const now = currentMonth();
  const months = Array.from({ length: 37 }, (_, i) => shiftMonth(now, 12 - i));
  const filtered = Boolean(filters.mes || filters.conta || filters.tipo || filters.busca);

  return (
    <TransactionsView
      transactions={items}
      accounts={accounts}
      categories={categories}
      emptyMessage={filtered ? "Nenhum lançamento com esses filtros." : "Você ainda não tem lançamentos."}
      toolbar={
        accounts.length > 0 && (
          <>
            <FilterBar filters={filters} accounts={accounts} months={months} />
            {summary && (
              <div className="summary card">
                <div><span className="label">Entradas</span><Money cents={summary.income} /></div>
                <div><span className="label">Saídas</span><Money cents={-summary.expense} /></div>
                <div><span className="label">Resultado</span><Money cents={summary.income - summary.expense} signed /></div>
                {toPay > 0 && <div><span className="label">A pagar no mês</span><Money cents={-toPay} testId="mes-a-pagar" /></div>}
                {toReceive > 0 && <div><span className="label">A receber no mês</span><Money cents={toReceive} testId="mes-a-receber" /></div>}
              </div>
            )}
          </>
        )
      }
      footer={
        total > 0 && (
          <>
            <p className="list-count">{total === 1 ? "1 lançamento" : `${items.length} de ${total} lançamentos`}</p>
            {items.length < total && shown < MAX_SHOWN && (
              <Link
                className="btn btn-secondary btn-block"
                href={withParams("/lancamentos", { ...filters, mostrar: String(shown + PAGE_SIZE) })}
                scroll={false}
              >
                Mostrar mais
              </Link>
            )}
          </>
        )
      }
    />
  );
}
