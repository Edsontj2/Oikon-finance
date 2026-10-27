import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { currentMonth, isValidMonth, shiftMonth } from "@/lib/dates";
import { param, withParams, type SearchParams } from "@/lib/search-params";
import { listAccountOptions } from "@/data/accounts";
import { listCategoryOptions } from "@/data/categories";
import { monthSummary } from "@/data/dashboard";
import { isTransactionType, searchTransactions } from "@/data/transactions";
import { Money } from "@/components/money";
import { FilterBar, type Filters } from "./filter-bar";
import { TransactionsView } from "./transactions-view";

const PAGE_SIZE = 50;
const MAX_SHOWN = 500;

export default async function LancamentosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const db = getDb();
  const [accounts, categories] = await Promise.all([listAccountOptions(db, userId), listCategoryOptions(db, userId)]);

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

  const [{ items, total }, summary] = await Promise.all([
    searchTransactions(db, userId, {
      month: filters.mes,
      accountId: filters.conta,
      type: isTransactionType(filters.tipo) ? filters.tipo : undefined,
      search: filters.busca,
      limit: shown,
    }),
    filters.mes ? monthSummary(db, userId, filters.mes) : null,
  ]);

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
