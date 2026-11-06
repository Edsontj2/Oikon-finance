"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckSquare, ChevronRight, Plus, Repeat, Trash2, X } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import type { CategoryOption } from "@/domain/categories";
import { signedAmount, transactionTypes, type Transaction } from "@/domain/transactions";
import { formatDate, formatMonth, today } from "@/lib/dates";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { payProjected, removeTransaction, removeTransactions, setTransactionPaid, stopProjected } from "../actions";
import { TransactionForm } from "./transaction-form";

type Props = {
  transactions: Transaction[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  emptyMessage: string;
  /** Filtros e resumo, logo abaixo do título. */
  toolbar?: React.ReactNode;
  /** Contagem e "mostrar mais", depois da lista. */
  footer?: React.ReactNode;
};

/** Lista de lançamentos agrupada por mês + janelas de criar, editar e excluir. */
export function TransactionsView({ transactions, accounts, categories, emptyMessage, toolbar, footer }: Props) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [projected, setProjected] = useState<Transaction | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const bulk = useServerAction(removeTransactions, () => {
    setConfirmBulk(false);
    setSelected(new Set());
    setSelecting(false);
  });
  const todayStr = today();
  const selectable = transactions.filter((t) => !t.projected);
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), t]);
  }

  return (
    <>
      <div className="page-head">
        <h1>Lançamentos</h1>
        <div className="page-head-actions">
          {selectable.length > 0 && (selecting ? (
            <button type="button" className="btn btn-secondary" onClick={stopSelecting}>
              <X size={18} aria-hidden /> Cancelar seleção
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setSelecting(true)}>
              <CheckSquare size={18} aria-hidden /> Selecionar
            </button>
          ))}
          {accounts.length > 0 && !selecting && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden /> Novo lançamento
            </button>
          )}
        </div>
      </div>
      {toolbar}

      {accounts.length === 0 ? (
        <div className="card empty">
          <p>Você precisa de pelo menos uma conta para lançar.</p>
          <Link href="/contas" className="btn btn-primary">Criar uma conta</Link>
        </div>
      ) : transactions.length === 0 ? (
        <div className="card empty">
          <p>{emptyMessage}</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden /> Novo lançamento
          </button>
        </div>
      ) : (
        [...groups].map(([month, items]) => {
          const ids = items.filter((t) => !t.projected).map((t) => t.id);
          const all = ids.length > 0 && ids.every((id) => selected.has(id));
          return (
            <section key={month} className="list-group">
              <h2 className="list-group-title">
                {selecting && ids.length > 0 ? (
                  <label className="select-all">
                    <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} aria-label={`Selecionar todos de ${formatMonth(month)}`} />
                    {formatMonth(month)}
                  </label>
                ) : formatMonth(month)}
              </h2>
              <ul className="list card">
                {items.map((t) => (
                  t.projected ? (
                    selecting ? null : <ProjectedRow key={t.id} t={t} onOpen={() => setProjected(t)} />
                  ) : selecting ? (
                    <SelectableRow key={t.id} t={t} checked={selected.has(t.id)} onToggle={(on) => toggle([t.id], on)} />
                  ) : (
                    <TransactionRow key={t.id} t={t} todayStr={todayStr} onOpen={() => setEditing(t)} />
                  )
                ))}
              </ul>
            </section>
          );
        })
      )}
      {selecting && (
        <div className="bulk-bar" role="region" aria-label="Seleção">
          <span data-testid="selecionados">{selected.size === 1 ? "1 selecionado" : `${selected.size} selecionados`}</span>
          <button type="button" className="btn btn-danger" disabled={selected.size === 0} onClick={() => setConfirmBulk(true)}>
            <Trash2 size={16} aria-hidden /> Excluir
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        title={selected.size === 1 ? "Excluir 1 lançamento?" : `Excluir ${selected.size} lançamentos?`}
        message="Os saldos voltam a ser como se eles não existissem. Só os selecionados são excluídos: outras parcelas e os próximos meses de um lançamento de todo mês continuam."
        error={bulk.error}
      >
        <button type="button" className="btn btn-danger" disabled={bulk.pending} onClick={() => bulk.run([...selected])}>
          {bulk.pending ? "Excluindo…" : "Excluir"}
        </button>
      </ConfirmDialog>
      {footer}

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo lançamento">
        <TransactionForm
          accounts={accounts}
          categories={categories}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar lançamento">
        {editing && (
          <>
            <TransactionForm
              accounts={accounts}
              categories={categories}
              transaction={editing}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
            <div className="danger-zone">
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => {
                  setDeleting(editing);
                  setEditing(null);
                }}
              >
                Excluir lançamento
              </button>
            </div>
          </>
        )}
      </Modal>

      <DeleteTransaction transaction={deleting} onClose={() => setDeleting(null)} />
      <ProjectedDialog transaction={projected} onClose={() => setProjected(null)} />
    </>
  );
}

/** Mês futuro de um "Todo mês": ainda não foi lançado; aparece para saber o que vem. */
function ProjectedRow({ t, onOpen }: { t: Transaction; onOpen: () => void }) {
  const details = [formatDate(t.date), t.toAccountName ? `${t.accountName} → ${t.toAccountName}` : t.accountName, t.categoryName].filter(Boolean);
  return (
    <li className="row row-projected" data-testid="lancamento-previsto">
      <button type="button" className="row-main" onClick={onOpen} aria-label={`Previsto: ${t.description}`}>
        <span className="row-text">
          <span className="row-title">
            {t.description} <Repeat size={13} className="row-icon" aria-label="mensal" />
          </span>
          <span className="row-sub">{details.join(" · ")}</span>
        </span>
        <span className="row-value">
          <Money cents={signedAmount(t)} signed={t.type !== "transfer"} />
          <ChevronRight size={16} className="row-chevron" aria-hidden />
        </span>
      </button>
      <span className="status status-scheduled" title="Lançado automaticamente quando o mês chegar">previsto</span>
    </li>
  );
}

function ProjectedDialog({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  const pay = useServerAction(payProjected, onClose);
  const stop = useServerAction(stopProjected, onClose);
  const t = transaction;
  return (
    <ConfirmDialog
      open={t !== null}
      onClose={onClose}
      title="Lançamento previsto"
      error={pay.error ?? stop.error}
      message={
        t && (
          <>
            <strong>{t.description}</strong> repete todo mês. O de {formatMonth(t.date.slice(0, 7))} ({formatDate(t.date)}) é lançado
            sozinho quando o mês chegar, como pendente. Se já pagou, pague agora: sai do saldo hoje e esse mês não é lançado de novo.
          </>
        )
      }
    >
      <button type="button" className="btn btn-danger" disabled={stop.pending || pay.pending} onClick={() => t?.projected && stop.run(t.projected.ruleId)}>
        Parar de repetir
      </button>
      <button type="button" className="btn btn-primary" disabled={stop.pending || pay.pending} onClick={() => t?.projected && pay.run(t.projected.ruleId, t.projected.month)}>
        Pagar agora
      </button>
    </ConfirmDialog>
  );
}

/** Linha no modo de seleção: tocar marca ou desmarca. */
function SelectableRow({ t, checked, onToggle }: { t: Transaction; checked: boolean; onToggle: (on: boolean) => void }) {
  return (
    <li className={`row row-selectable${checked ? " row-checked" : ""}`} data-testid="lancamento">
      <label className="row-main">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} aria-label={`Selecionar ${t.description}`} />
        <span className="row-text">
          <span className="row-title">{t.description}{t.installmentCount ? <span className="tag tag-installment">{t.installmentNumber}/{t.installmentCount}</span> : null}</span>
          <span className="row-sub">{formatDate(t.date)} · {t.accountName}</span>
        </span>
        <span className="row-value"><Money cents={signedAmount(t)} signed={t.type !== "transfer"} /></span>
      </label>
    </li>
  );
}

function TransactionRow({ t, todayStr, onOpen }: { t: Transaction; todayStr: string; onOpen: () => void }) {
  const late = !t.paid && t.date < todayStr;
  // Marcado como pago com data futura (débito agendado): só sai do saldo no dia, igual ao painel.
  const scheduled = t.paid && t.date > todayStr;
  const toggle = useServerAction(setTransactionPaid);
  const details = [
    formatDate(t.date),
    t.toAccountName ? `${t.accountName} → ${t.toAccountName}` : t.accountName,
    t.categoryName ?? (t.type === "transfer" ? transactionTypes.transfer : null),
  ].filter(Boolean);

  return (
    <li className="row" data-testid="lancamento">
      <button type="button" className="row-main" onClick={onOpen} aria-label={`Editar ${t.description}`}>
        <span className="row-text">
          <span className="row-title">
            {t.description}
            {t.installmentCount ? (
              <span className="tag tag-installment" title={`Parcela ${t.installmentNumber} de ${t.installmentCount}`}>
                {t.installmentNumber}/{t.installmentCount}
              </span>
            ) : (
              t.seriesId && <Repeat size={13} className="row-icon" aria-label="mensal" />
            )}
          </span>
          <span className="row-sub">{details.join(" · ")}</span>
        </span>
        <span className="row-value">
          <Money cents={signedAmount(t)} signed={t.type !== "transfer"} />
          <ChevronRight size={16} className="row-chevron" aria-hidden />
        </span>
      </button>
      <button
        type="button"
        className={`status ${scheduled ? "status-scheduled" : t.paid ? "status-paid" : late ? "status-late" : "status-pending"}`}
        disabled={toggle.pending}
        // No agendado, tocar quer dizer "já paguei hoje": a data vira hoje e sai do saldo.
        onClick={() => toggle.run(t.id, scheduled || !t.paid)}
        title={scheduled ? `Agendado para ${formatDate(t.date)}. Tocar marca como pago hoje.` : t.paid ? "Voltar para pendente" : "Marcar como pago"}
      >
        {scheduled ? (
          "agendado · pagar hoje"
        ) : t.paid ? (
          <>
            <Check size={14} aria-hidden /> pago
          </>
        ) : late ? (
          "atrasado · pagar"
        ) : (
          "pendente · pagar"
        )}
      </button>
      {toggle.error && <span className="row-error" role="alert">{toggle.error}</span>}
    </li>
  );
}

function DeleteTransaction({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  const remove = useServerAction(removeTransaction, onClose);
  return (
    <ConfirmDialog
      open={transaction !== null}
      onClose={onClose}
      title="Excluir lançamento?"
      error={remove.error}
      message={
        transaction && (
          <>
            <strong>{transaction.description}</strong> de {formatDate(transaction.date)} será apagado. Isso não pode ser
            desfeito.
            {transaction.recurringId
              ? " Ele repete todo mês: apague só este mês ou pare de repetir (apaga este e os próximos)."
              : transaction.seriesId && " Ele faz parte de uma série mensal."}
          </>
        )
      }
    >
      {transaction?.seriesId && (
        <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => remove.run(transaction.id, "future")}>
          {transaction.recurringId ? "Parar de repetir" : "Este e os próximos"}
        </button>
      )}
      <button
        type="button"
        className="btn btn-danger"
        disabled={remove.pending}
        onClick={() => transaction && remove.run(transaction.id, "one")}
      >
        {transaction?.recurringId ? "Só este mês" : transaction?.seriesId ? "Só este" : "Excluir"}
      </button>
    </ConfirmDialog>
  );
}
