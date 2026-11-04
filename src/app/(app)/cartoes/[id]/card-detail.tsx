"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import { sortedCategoryOptions, type CategoryOption } from "@/domain/categories";
import { cardKinds, chargeKinds, type Invoice } from "@/domain/cards";
import type { CardDetail } from "@/data/cards";
import { formatDate, formatMonth, shiftMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import type { ActionResult } from "@/app/action-result";
import { InvoiceStatusTag } from "../invoice-status";
import { addCardCharge, addCardRefund, installCardInvoice, moveCardEntry, payCardInvoice, saveCardSettings } from "../actions";

type Dialog = "pay" | "refund" | "charge" | "install" | "settings" | null;

export function CardDetailView({
  card,
  invoice,
  payers,
  categories,
  history,
  today,
}: {
  card: CardDetail;
  invoice: Invoice;
  payers: AccountOption[];
  categories: CategoryOption[];
  history: { limit: number | null; changedAt: string }[];
  today: string;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const index = card.invoices.findIndex((i) => i.month === invoice.month);
  const prev = card.invoices[index - 1];
  const next = card.invoices[index + 1];
  const canInstall = ["closed", "overdue", "partial"].includes(invoice.status) && invoice.remaining > 0;
  const move = useServerAction(moveCardEntry);

  return (
    <>
      <div className="page-head">
        <h1>
          <Link href="/cartoes" className="muted" aria-label="Voltar para cartões">Cartões /</Link> {card.name}
          {card.last4 && <span className="muted"> •••• {card.last4}</span>}
        </h1>
        <button type="button" className="btn btn-secondary" onClick={() => setDialog("settings")}>
          <Settings size={18} aria-hidden /> Configurar
        </button>
      </div>

      {!card.configured && (
        <div className="card insight insight-warn" role="status">
          Cadastre o dia de fechamento e o de vencimento para as compras caírem na fatura certa. Até lá, cada mês do calendário é
          uma fatura.{" "}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog("settings")}>Cadastrar agora</button>
        </div>
      )}

      <div className="summary card">
        <div><span className="label">Deve hoje</span><Money cents={Math.max(0, -card.balance)} testId="cartao-deve" /></div>
        <div><span className="label">Com parcelas futuras</span><Money cents={card.limit.committed} /></div>
        {card.limit.limit !== null && (
          <div>
            <span className="label">Limite disponível</span>
            <Money cents={card.limit.available ?? 0} testId="cartao-disponivel" />
            <span className="progress" aria-hidden><span style={{ width: `${card.limit.percent}%` }} /></span>
            <span className="hint">{card.limit.percent}% de {formatMoney(card.limit.limit)} usado</span>
          </div>
        )}
      </div>

      <section className="card" aria-labelledby="fatura-title">
        <div className="month-nav">
          {prev ? (
            <Link href={`/cartoes/${card.id}?fatura=${prev.month}`} aria-label="Fatura anterior"><ChevronLeft size={18} aria-hidden /></Link>
          ) : <span />}
          <strong id="fatura-title">Fatura de {formatMonth(invoice.month)}</strong>
          {next ? (
            <Link href={`/cartoes/${card.id}?fatura=${next.month}`} aria-label="Próxima fatura"><ChevronRight size={18} aria-hidden /></Link>
          ) : <span />}
          <InvoiceStatusTag status={invoice.status} />
        </div>
        <p className="muted">
          Fecha em {formatDate(invoice.closingDate)} · vence em {formatDate(invoice.dueDate)}
        </p>
        <div className="metrics metrics-3">
          {invoice.previousBalance !== 0 && (
            <div className="metric"><span className="label">Saldo anterior</span><Money cents={invoice.previousBalance} /></div>
          )}
          <div className="metric"><span className="label">Compras e encargos</span><Money cents={invoice.charges} /></div>
          {invoice.credits > 0 && <div className="metric"><span className="label">Estornos e créditos</span><Money cents={-invoice.credits} /></div>}
          <div className="metric"><span className="label">Total</span><Money cents={invoice.total} testId="fatura-total" /></div>
          <div className="metric"><span className="label">Pago</span><Money cents={invoice.paid} /></div>
          <div className="metric"><span className="label">{invoice.remaining < 0 ? "Crédito" : "Falta pagar"}</span><Money cents={Math.abs(invoice.remaining)} testId="fatura-restante" /></div>
        </div>
        {invoice.scheduled > 0 && <p className="hint">Pagamento agendado: {formatMoney(invoice.scheduled)} (ainda não conta como pago).</p>}
        {(invoice.status === "partial" || invoice.status === "overdue") && (
          <p className="form-error" role="alert">
            Venceu sem pagamento total: {formatMoney(invoice.remaining)} passou para a próxima fatura (rotativo). O banco cobra juros
            sobre esse valor; lance o valor cobrado em &quot;Encargo&quot; quando vier na fatura.
          </p>
        )}
        <div className="stack-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDialog("pay")}>Pagar fatura</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog("refund")}>Estorno</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog("charge")}>Encargo / IOF</button>
          {canInstall && <button type="button" className="btn btn-secondary" onClick={() => setDialog("install")}>Parcelar fatura</button>}
        </div>
        <FormError message={move.error} />

        {invoice.entries.length === 0 ? (
          <p className="muted">Nenhum lançamento nesta fatura.</p>
        ) : (
          <ul className="list">
            {invoice.entries.map((e) => (
              <li key={`${e.id}-${e.kind}`} className="row" data-testid="fatura-item">
                <div className="row-main">
                  <span className="row-text">
                    <span className="row-title">
                      {e.description}{" "}
                      {e.installmentCount && <span className="tag tag-installment">{e.installmentNumber}/{e.installmentCount}</span>}{" "}
                      {e.cardKind && e.cardKind !== "invoice_installment" && <span className="tag tag-installment">{cardKinds[e.cardKind]}</span>}
                      {e.kind === "payment" && <span className="tag tag-ok">{e.settled ? "Pagamento" : "Pagamento agendado"}</span>}
                    </span>
                    <span className="row-sub">
                      {formatDate(e.date)}
                      {e.categoryName && <> · {e.categoryName}</>}
                      {e.invoiceMonth && <> · fatura escolhida à mão</>}
                      {e.kind === "charge" && (
                        <>
                          {" · "}
                          {e.invoiceMonth ? (
                            <button type="button" className="inline-action" disabled={move.pending} onClick={() => move.run(e.id, null)}>
                              voltar para a fatura pela data
                            </button>
                          ) : (
                            <>
                              <button type="button" className="inline-action" disabled={move.pending} onClick={() => move.run(e.id, shiftMonth(invoice.month, -1))}>
                                ← fatura anterior
                              </button>{" "}
                              <button type="button" className="inline-action" disabled={move.pending} onClick={() => move.run(e.id, shiftMonth(invoice.month, 1))}>
                                próxima →
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="row-value">
                    <Money cents={e.kind === "charge" ? e.amount : -e.amount} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {card.upcoming.length > 0 && (
        <section className="card" aria-labelledby="proximas-title">
          <h2 id="proximas-title" className="card-title">Próximas faturas (limite comprometido)</h2>
          <ul className="mini-list">
            {card.upcoming.map((u) => (
              <li key={u.month} className="mini-list-line">
                <Link href={`/cartoes/${card.id}?fatura=${u.month}`}>{formatMonth(u.month)}</Link>
                <Money cents={u.amount} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="card" aria-labelledby="limite-title">
          <h2 id="limite-title" className="card-title">Histórico de limite</h2>
          <ul className="mini-list">
            {history.map((h) => (
              <li key={h.changedAt} className="mini-list-line">
                <span>{new Date(h.changedAt).toLocaleDateString("pt-BR")}</span>
                <span>{h.limit === null ? "sem limite" : formatMoney(h.limit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={dialog === "pay"} onClose={close} title={`Pagar fatura de ${formatMonth(invoice.month)}`}>
        <CardForm action={payCardInvoice} cardId={card.id} onDone={close} submit="Registrar pagamento">
          <MoneyInput name="amount" label="Valor (R$)" required defaultCents={Math.max(0, invoice.remaining) || null}
            hint="Pode pagar menos: o resto vai para a próxima fatura (rotativo)." />
          <label>
            Pagar com
            <select name="fromAccountId" defaultValue={card.payerAccountId ?? payers[0]?.id} required>
              {payers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Data<input type="date" name="date" defaultValue={today} required /></label>
          <label>
            Situação
            <select name="when" defaultValue="paid">
              <option value="paid">Já paguei</option>
              <option value="schedule">Só agendar (fica pendente)</option>
            </select>
          </label>
          <p className="hint">Registra a transferência da conta para o cartão. Nenhum pagamento real é feito pelo app.</p>
        </CardForm>
      </Modal>

      <Modal open={dialog === "refund"} onClose={close} title="Registrar estorno">
        <CardForm action={addCardRefund} cardId={card.id} onDone={close} submit="Registrar estorno">
          <label>Descrição<input name="description" required maxLength={120} placeholder="Ex.: Estorno loja X" /></label>
          <MoneyInput name="amount" label="Valor (R$)" required />
          <label>Data<input type="date" name="date" defaultValue={today} required /></label>
          <label>
            Categoria da compra estornada
            <select name="categoryId" defaultValue="">
              <option value="">Sem categoria</option>
              {sortedCategoryOptions(categories).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <p className="hint">O estorno abate a fatura e o gasto da categoria; não é contado como receita.</p>
        </CardForm>
      </Modal>

      <Modal open={dialog === "charge"} onClose={close} title="Lançar encargo">
        <CardForm action={addCardCharge} cardId={card.id} onDone={close} submit="Lançar">
          <label>
            Tipo
            <select name="kind" defaultValue="interest">
              {chargeKinds.map((k) => <option key={k} value={k}>{cardKinds[k]}</option>)}
            </select>
          </label>
          <label>Descrição (opcional)<input name="description" maxLength={120} placeholder="Ex.: IOF compra internacional" /></label>
          <MoneyInput name="amount" label="Valor cobrado (R$)" required />
          <label>Data<input type="date" name="date" defaultValue={today} required /></label>
          <label>
            Fatura
            <select name="invoiceMonth" defaultValue="">
              <option value="">Pela data</option>
              {card.invoices.map((i) => <option key={i.month} value={i.month}>{formatMonth(i.month)}</option>)}
            </select>
          </label>
          <p className="hint">Use o valor que veio na fatura. O app não calcula juros por conta própria.</p>
        </CardForm>
      </Modal>

      <Modal open={dialog === "install"} onClose={close} title={`Parcelar fatura de ${formatMonth(invoice.month)}`}>
        <InstallForm invoice={invoice} cardId={card.id} onDone={close} />
      </Modal>

      <Modal open={dialog === "settings"} onClose={close} title="Configurar cartão">
        <CardForm action={saveCardSettings} cardId={card.id} onDone={close} submit="Salvar" keyed={false}>
          <MoneyInput name="creditLimit" label="Limite total (R$)" defaultCents={card.creditLimit} hint="Deixe vazio se não quiser controlar." />
          <div className="fields">
            <label>Dia de fechamento<input name="closingDay" inputMode="numeric" defaultValue={card.closingDay ?? ""} placeholder="Ex.: 3" /></label>
            <label>Dia de vencimento<input name="dueDay" inputMode="numeric" defaultValue={card.dueDay ?? ""} placeholder="Ex.: 10" /></label>
          </div>
          <label>
            Conta que paga a fatura
            <select name="payerAccountId" defaultValue={card.payerAccountId ?? ""}>
              <option value="">Escolher na hora</option>
              {payers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div className="fields">
            <label>Bandeira<input name="brand" maxLength={30} defaultValue={card.brand ?? ""} placeholder="Ex.: Visa" /></label>
            <label>Final<input name="last4" inputMode="numeric" maxLength={4} defaultValue={card.last4 ?? ""} placeholder="1234" /></label>
          </div>
          <p className="hint">Compra no dia do fechamento ou depois vai para a fatura seguinte.</p>
        </CardForm>
      </Modal>
    </>
  );
}

function InstallForm({ invoice, cardId, onDone }: { invoice: Invoice; cardId: string; onDone: () => void }) {
  const [count, setCount] = useState(3);
  const [each, setEach] = useState<number | null>(null);
  const total = each ? each * count : null;
  const interest = total !== null ? total - invoice.remaining : null;
  return (
    <CardForm action={installCardInvoice} cardId={cardId} onDone={onDone} submit="Parcelar">
      <input type="hidden" name="month" value={invoice.month} />
      <p className="muted">Saldo da fatura: {formatMoney(invoice.remaining)}. Informe as condições que o banco ofereceu.</p>
      <label>
        Parcelas
        <input name="count" inputMode="numeric" value={count} onChange={(e) => setCount(Number(e.target.value) || 0)} required />
      </label>
      <MoneyInput name="installmentAmount" label="Valor de cada parcela (R$)" required onCentsChange={setEach} />
      {total !== null && interest !== null && count > 1 && (
        <p className="hint">
          Total {formatMoney(total)}
          {interest > 0 ? ` · juros de ${formatMoney(interest)}` : interest < 0 ? " · menor que o saldo da fatura" : " · sem juros"}
        </p>
      )}
      <p className="hint">A fatura fica quitada e as parcelas entram nas próximas faturas. Só os juros contam como gasto novo.</p>
    </CardForm>
  );
}

function CardForm({
  action,
  cardId,
  onDone,
  submit,
  keyed = true,
  children,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  cardId: string;
  onDone: () => void;
  submit: string;
  keyed?: boolean;
  children: React.ReactNode;
}) {
  const [submissionKey] = useState(() => crypto.randomUUID());
  const { run, pending, error } = useServerAction(action, onDone);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget));
      }}
    >
      <input type="hidden" name="cardId" value={cardId} />
      {keyed && <input type="hidden" name="submissionKey" value={submissionKey} />}
      {children}
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : submit}</button>
      </div>
    </form>
  );
}
