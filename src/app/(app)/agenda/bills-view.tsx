"use client";

import Link from "next/link";
import type { BillGroup } from "@/data/bills";
import { formatDate } from "@/lib/dates";
import { Money } from "@/components/money";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { setTransactionPaid } from "../actions";

export function BillsView({ groups, next30 }: { groups: BillGroup[]; next30: { pay: number; receive: number } }) {
  const pay = useServerAction(setTransactionPaid);
  return (
    <>
      <div className="page-head">
        <h1>Agenda</h1>
        <Link className="btn btn-secondary" href="/dividas">Dívidas</Link>
      </div>
      <div className="summary card">
        <div><span className="label">A pagar em 30 dias</span><Money cents={next30.pay} testId="agenda-pagar" /></div>
        <div><span className="label">A receber em 30 dias</span><Money cents={next30.receive} testId="agenda-receber" /></div>
      </div>
      <FormError message={pay.error} />
      {groups.length === 0 ? (
        <div className="card empty"><p>Nada pendente nos próximos 90 dias. 👍</p></div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="card bill-group" aria-labelledby={`agenda-${g.key}`} data-testid={`agenda-${g.key}`}>
            <h2 id={`agenda-${g.key}`} className="card-title">
              <span>{g.label}</span>
              <span className="hint">
                {g.pay > 0 && <>pagar <Money cents={g.pay} /></>}
                {g.pay > 0 && g.receive > 0 && " · "}
                {g.receive > 0 && <>receber <Money cents={g.receive} /></>}
              </span>
            </h2>
            <ul className="list">
              {g.items.map((b) => (
                <li key={b.id} className="row">
                  <div className="row-main">
                    <span className="row-text">
                      <span className="row-title">
                        {b.href ? <Link href={b.href}>{b.description}</Link> : b.description}{" "}
                        {g.key === "overdue" && <span className="tag tag-late">atrasada</span>}
                      </span>
                      <span className="row-sub">
                        {formatDate(b.date)} · {b.accountName}
                        {b.toAccountName && <> → {b.toAccountName}</>}
                        {b.categoryName && <> · {b.categoryName}</>}
                      </span>
                    </span>
                    <span className="row-value">
                      <Money cents={b.kind === "receive" ? b.amount : -b.amount} signed={b.kind === "receive"} />
                      {b.transactionId ? (
                        <button type="button" className="btn btn-sm btn-secondary" disabled={pay.pending} onClick={() => pay.run(b.transactionId!, true)}>
                          {b.kind === "receive" ? "Recebido" : "Pago"}
                        </button>
                      ) : (
                        b.href && <Link className="btn btn-sm btn-secondary" href={b.href}>Pagar</Link>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="hint page-hint">
        Marcar como pago antes do vencimento registra o pagamento com a data de hoje. Para mudar valor ou data, edite em Lançamentos.
      </p>
    </>
  );
}
