"use client";

import { useState } from "react";
import Link from "next/link";
import { accountTypes, availableWithOverdraft, type AccountWithBalance } from "@/domain/accounts";
import type { Reconciliation } from "@/data/reconciliation";
import type { AuditEntry } from "@/data/audit";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { AccountIcon } from "@/components/account-icon";
import { useServerAction } from "@/components/use-server-action";
import { archiveAccount, reconcile } from "../../actions";

export function AccountDetail({
  account,
  reconciliations,
  audit,
  today,
}: {
  account: AccountWithBalance;
  reconciliations: Reconciliation[];
  audit: AuditEntry[];
  today: string;
}) {
  const [formKey, setFormKey] = useState(() => crypto.randomUUID());
  const save = useServerAction(reconcile, () => setFormKey(crypto.randomUUID()));
  const archive = useServerAction(archiveAccount);

  return (
    <>
      <div className="page-head">
        <h1>
          <Link href="/contas" className="muted">Contas /</Link> {account.name}
        </h1>
        <AccountIcon icon={account.icon} color={account.color} type={account.type} size={20} />
      </div>

      <div className="summary card">
        <div><span className="label">Saldo hoje</span><Money cents={account.balance} testId="conta-saldo" /></div>
        <div><span className="label">Com pendentes e futuros</span><Money cents={account.projectedBalance} /></div>
        {account.overdraftLimit ? (
          <div><span className="label">Disponível com cheque especial</span><Money cents={availableWithOverdraft(account)} /></div>
        ) : null}
      </div>
      <p className="muted page-hint">
        {accountTypes[account.type]}
        {account.institution && <> · {account.institution}</>}
        {account.archived && <> · <span className="tag tag-installment">Arquivada</span></>}
      </p>

      <section className="card" aria-labelledby="conciliar-title">
        <h2 id="conciliar-title" className="card-title">Conciliar com o extrato</h2>
        <p className="muted">
          Informe o saldo que o banco mostra. Se for diferente do app, é lançado um ajuste que corrige o saldo (não conta como
          receita nem despesa). Antes, confira se não faltou lançar algo:{" "}
          <Link href={`/importar?conta=${account.id}`}>importe o extrato (OFX ou CSV)</Link> e o app mostra o que falta.
        </p>
        <form
          key={formKey}
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(new FormData(e.currentTarget));
          }}
        >
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="submissionKey" value={formKey} />
          <div className="fields">
            <MoneyInput name="statementBalance" label="Saldo no extrato (R$)" required allowNegative />
            <label>Data do saldo<input type="date" name="date" defaultValue={today} max={today} required /></label>
          </div>
          <FormError message={save.error} />
          <div className="stack-actions">
            <button type="submit" className="btn btn-primary" disabled={save.pending}>{save.pending ? "Conferindo…" : "Conciliar"}</button>
          </div>
        </form>
        {reconciliations.length > 0 && (
          <ul className="mini-list" data-testid="conciliacoes">
            {reconciliations.map((r) => (
              <li key={r.id} className="mini-list-line">
                <span>{formatDate(r.date)} · extrato {formatMoney(r.statement)}</span>
                <span>{r.difference === 0 ? <span className="tag tag-ok">bateu</span> : <>ajuste <Money cents={r.difference} signed /></>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="historico-title">
        <h2 id="historico-title" className="card-title">Histórico de alterações</h2>
        {audit.length === 0 ? (
          <p className="muted">Nada registrado ainda.</p>
        ) : (
          <ul className="mini-list">
            {audit.map((a) => (
              <li key={a.id} className="mini-list-line">
                <span>{a.summary}</span>
                <span className="muted">{new Date(a.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="stack-actions">
        <Link className="btn btn-secondary" href={`/lancamentos?conta=${account.id}`}>Ver lançamentos</Link>
        <button type="button" className="btn btn-secondary" disabled={archive.pending} onClick={() => archive.run(account.id, !account.archived)}>
          {account.archived ? "Reativar conta" : "Arquivar conta"}
        </button>
      </div>
      <FormError message={archive.error} />
      {!account.archived && <p className="hint page-hint">Arquivar esconde a conta das listas de escolha e mantém o histórico. Só com saldo zerado.</p>}
    </>
  );

  function run(form: FormData) {
    save.run(form);
  }
}
