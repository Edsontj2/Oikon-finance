import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { formatDate, formatMonth } from "@/lib/dates";
import { listCards } from "@/data/cards";
import { invoiceStatusLabel } from "@/domain/cards";
import { Money } from "@/components/money";
import { InvoiceStatusTag } from "./invoice-status";

export default async function CartoesPage() {
  const userId = await requireUserId();
  const cards = await listCards(getDb(), userId);
  const toPay = cards.reduce((s, c) => s + Math.max(0, c.toPay?.remaining ?? 0), 0);
  const committed = cards.reduce((s, c) => s + c.limit.committed, 0);

  return (
    <>
      <div className="page-head">
        <h1>Cartões</h1>
      </div>

      {cards.length === 0 ? (
        <div className="card empty">
          <p>Nenhum cartão ainda.</p>
          <p className="muted">
            Crie em <Link href="/contas">Contas</Link> com o tipo &quot;Cartão de crédito&quot; e volte aqui para cadastrar
            limite, fechamento e vencimento.
          </p>
        </div>
      ) : (
        <>
          <div className="summary card">
            <div><span className="label">Faturas fechadas a pagar</span><Money cents={toPay} /></div>
            <div><span className="label">Comprometido (com parcelas)</span><Money cents={committed} /></div>
          </div>
          <ul className="list card">
            {cards.map((c) => (
              <li key={c.id} className="row" data-testid="cartao">
                <Link className="row-main" href={`/cartoes/${c.id}`} aria-label={`Abrir cartão ${c.name}`}>
                  <span className="row-text">
                    <span className="row-title">
                      {c.name}
                      {c.last4 && <span className="muted"> •••• {c.last4}</span>}
                    </span>
                    <span className="row-sub">
                      {!c.configured ? (
                        <span className="tag tag-pending">Cadastre fechamento e vencimento</span>
                      ) : c.toPay ? (
                        <>
                          <InvoiceStatusTag status={c.toPay.status} /> Fatura de {formatMonth(c.toPay.month)} · vence{" "}
                          {formatDate(c.toPay.dueDate)}: <Money cents={c.toPay.remaining} />
                        </>
                      ) : c.current ? (
                        <>
                          {invoiceStatusLabel[c.current.status]} · fecha {formatDate(c.current.closingDate)}:{" "}
                          <Money cents={Math.max(0, c.current.remaining)} />
                        </>
                      ) : null}
                    </span>
                    {c.limit.limit !== null && (
                      <>
                        <span className="progress" aria-hidden>
                          <span style={{ width: `${c.limit.percent}%` }} />
                        </span>
                        <span className="hint">
                          Disponível <Money cents={c.limit.available ?? 0} /> de <Money cents={c.limit.limit} />
                        </span>
                      </>
                    )}
                  </span>
                  <span className="row-value">
                    <Money cents={Math.max(0, -c.balance)} testId={`cartao-deve-${c.name}`} />
                    <ChevronRight size={16} className="row-chevron" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="hint page-hint">
            O valor à direita é o que você deve hoje no cartão. Compras parceladas comprometem o limite até a última parcela.
            Pagar a fatura é uma transferência da conta pagadora: não conta como gasto de novo.
          </p>
        </>
      )}
    </>
  );
}
