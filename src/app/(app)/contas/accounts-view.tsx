"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { accountTypes, type AccountWithBalance } from "@/domain/accounts";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { removeAccount } from "../actions";
import { AccountForm } from "./account-form";

export function AccountsView({ accounts }: { accounts: AccountWithBalance[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountWithBalance | null>(null);
  const [deleting, setDeleting] = useState<AccountWithBalance | null>(null);
  const remove = useServerAction(removeAccount, () => setDeleting(null));
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const projected = accounts.reduce((s, a) => s + a.projectedBalance, 0);

  return (
    <>
      <div className="page-head">
        <h1>Contas</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden /> Nova conta
        </button>
      </div>

      <div className="summary card">
        <div><span className="label">Saldo total</span><Money cents={total} testId="contas-total" /></div>
        <div><span className="label">Com pendentes</span><Money cents={projected} /></div>
      </div>

      {accounts.length === 0 ? (
        <div className="card empty"><p>Nenhuma conta ainda.</p></div>
      ) : (
        <ul className="list card">
          {accounts.map((a) => (
            <li key={a.id} className="row" data-testid="conta">
              <button type="button" className="row-main" onClick={() => setEditing(a)} aria-label={`Editar conta ${a.name}`}>
                <span className="row-text">
                  <span className="row-title">{a.name}</span>
                  <span className="row-sub">
                    {accountTypes[a.type]}
                    {a.projectedBalance !== a.balance && <> · com pendentes: <Money cents={a.projectedBalance} /></>}
                  </span>
                </span>
                <span className="row-value">
                  <Money cents={a.balance} testId={`conta-saldo-${a.name}`} />
                  <ChevronRight size={16} className="row-chevron" aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint page-hint">
        Saldo atual = saldo inicial + entradas recebidas − saídas pagas ± transferências, até hoje. No cartão de crédito,
        saldo negativo é o que você deve.
      </p>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nova conta">
        <AccountForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar conta">
        {editing && (
          <>
            <AccountForm account={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
            <div className="danger-zone">
              <Link className="btn btn-secondary" href={`/lancamentos?conta=${editing.id}`}>
                Ver lançamentos ({editing.transactionCount})
              </Link>
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => {
                  remove.setError(null);
                  setDeleting(editing);
                  setEditing(null);
                }}
              >
                Excluir conta
              </button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Excluir conta?"
        error={remove.error}
        message={
          deleting &&
          (deleting.transactionCount > 0 ? (
            <>
              <strong>{deleting.name}</strong> tem {deleting.transactionCount} lançamento(s). Para excluir a conta, exclua
              esses lançamentos ou mude-os para outra conta antes.
            </>
          ) : (
            <>
              A conta <strong>{deleting.name}</strong> será apagada. Isso não pode ser desfeito.
            </>
          ))
        }
      >
        {deleting && deleting.transactionCount === 0 && (
          <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => remove.run(deleting.id)}>
            Excluir
          </button>
        )}
        {deleting && deleting.transactionCount > 0 && (
          <Link className="btn btn-primary" href={`/lancamentos?conta=${deleting.id}`} onClick={() => setDeleting(null)}>
            Ver lançamentos
          </Link>
        )}
      </ConfirmDialog>
    </>
  );
}
