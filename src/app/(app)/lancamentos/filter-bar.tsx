"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import { formatMonth } from "@/lib/dates";
import { withParams } from "@/lib/search-params";

export type Filters = { mes?: string; conta?: string; tipo?: string; busca?: string };

/** Filtros da lista: mudam a URL (dá para voltar, recarregar e compartilhar o filtro). */
export function FilterBar({ filters, accounts, months }: { filters: Filters; accounts: AccountOption[]; months: string[] }) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.busca ?? "");

  const apply = (change: Partial<Filters>) => router.replace(withParams("/lancamentos", { ...filters, ...change }));

  // Busca espera a pessoa parar de digitar.
  useEffect(() => {
    if ((filters.busca ?? "") === search) return;
    const timer = setTimeout(() => apply({ busca: search }), 400);
    return () => clearTimeout(timer);
  });

  return (
    <div className="filters card">
      <label className="filter-search">
        <span className="sr-only">Buscar</span>
        <Search size={16} aria-hidden />
        <input type="search" placeholder="Buscar descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <label>
        <span className="sr-only">Período</span>
        <select value={filters.mes ?? ""} onChange={(e) => apply({ mes: e.target.value })} aria-label="Período">
          <option value="">Todos os meses</option>
          {months.map((m) => (
            <option key={m} value={m}>{formatMonth(m)}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Conta</span>
        <select value={filters.conta ?? ""} onChange={(e) => apply({ conta: e.target.value })} aria-label="Conta">
          <option value="">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Tipo</span>
        <select value={filters.tipo ?? ""} onChange={(e) => apply({ tipo: e.target.value })} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          <option value="expense">Saídas</option>
          <option value="income">Entradas</option>
          <option value="transfer">Transferências</option>
        </select>
      </label>
    </div>
  );
}
