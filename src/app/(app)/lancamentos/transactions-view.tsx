"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Plus, Repeat } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import type { CategoryOption } from "@/domain/categories";
import { signedAmount, transactionTypes, type Transaction } from "@/domain/transactions";
import { formatDate, formatMonth, today } from "@/lib/dates";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { removeTransaction, setTransactionPaid } from "../actions";
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
  const todayStr = today();

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), t]);
  }

  return (
    <>
      <div className="page-head">
        <h1>Lançamentos</h1>
        {accounts.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden /> Novo lançamento
          </button>
        )}
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
        [...groups].map(([month, items]) => (
          <section key={month} className="list-group">
            <h2 className="list-group-title">{formatMonth(month)}</h2>
            <ul className="list card">
              {items.map((t) => (
                <TransactionRow key={t.id} t={t} todayStr={todayStr} onOpen={() => setEditing(t)} />
              ))}
            </ul>
          </section>
        ))
      )}
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
    </>
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
            {t.seriesId && <Repeat size={13} className="row-icon" aria-label="mensal" />}
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
            {transaction.seriesId && " Ele faz parte de uma série mensal."}
          </>
        )
      }
    >
      {transaction?.seriesId && (
        <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => remove.run(transaction.id, "future")}>
          Este e os próximos
        </button>
      )}
      <button
        type="button"
        className="btn btn-danger"
        disabled={remove.pending}
        onClick={() => transaction && remove.run(transaction.id, "one")}
      >
        {transaction?.seriesId ? "Só este" : "Excluir"}
      </button>
    </ConfirmDialog>
  );
}
