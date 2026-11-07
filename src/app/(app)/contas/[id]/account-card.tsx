"use client";

import { useState } from "react";
import Link from "next/link";
import type { CardDetail } from "@/data/cards";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { addAccountCard, linkAccountCard, payCardInvoice, unlinkAccountCard } from "../../cartoes/actions";
import { AccountCardFields } from "../account-form";

/** Cartão de crédito da conta corrente: resumo, pagar a fatura com o saldo da conta, ligar/desligar. */
export function AccountCard({
  accountId,
  accountBalance,
  card,
  unlinked,
  today,
}: {
  accountId: string;
  accountBalance: number;
  card: CardDetail | null;
  unlinked: { id: string; name: string }[];
  today: string;
}) {
  return (
    <section className="card" aria-labelledby="cartao-conta-title">
      <h2 id="cartao-conta-title" className="card-title">Cartão de crédito</h2>
      {card ? <LinkedCard accountId={accountId} accountBalance={accountBalance} card={card} today={today} /> : <NoCard accountId={accountId} unlinked={unlinked} />}
    </section>
  );
}

function LinkedCard({ accountId, accountBalance, card, today }: { accountId: string; accountBalance: number; card: CardDetail; today: string }) {
  const [formKey, setFormKey] = useState(() => crypto.randomUUID());
  const pay = useServerAction(payCardInvoice, () => setFormKey(crypto.randomUUID()));
  const unlink = useServerAction(unlinkAccountCard);
  const invoice = card.toPay && card.toPay.remaining > 0 ? card.toPay : card.current;
  const due = invoice ? Math.max(0, invoice.remaining) : 0;
  return (
    <div className="stack" data-testid="cartao-da-conta">
      <p>
        <Link href={`/cartoes/${card.id}`}><strong>{card.name}</strong></Link>
        {card.last4 && <span className="muted"> •••• {card.last4}</span>}
      </p>
      <div className="summary">
        {invoice && (
          <div>
            <span className="label">Fatura de {formatMonth(invoice.month)}{invoice === card.toPay ? " (fechada)" : " (aberta)"}</span>
            <Money cents={due} testId="cartao-conta-fatura" />
            <span className="hint">vence em {formatDate(invoice.dueDate)}</span>
          </div>
        )}
        {card.limit.limit !== null && (
          <div><span className="label">Limite disponível</span><Money cents={card.limit.available ?? 0} /></div>
        )}
      </div>
      {!card.configured && <p className="hint">Informe fechamento e vencimento em <Link href={`/cartoes/${card.id}`}>Cartões</Link> para o app separar as faturas.</p>}

      {invoice && (
        <form
          key={formKey}
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            pay.run(new FormData(e.currentTarget));
          }}
        >
          <input type="hidden" name="cardId" value={card.id} />
          <input type="hidden" name="fromAccountId" value={accountId} />
          <input type="hidden" name="submissionKey" value={formKey} />
          <input type="hidden" name="when" value="paid" />
          <div className="fields">
            <MoneyInput name="amount" label="Valor a pagar (R$)" required defaultCents={due || null}
              hint={`Saldo da conta hoje: ${formatMoney(accountBalance)}. Pode pagar menos: o resto vai para a próxima fatura.`} />
            <label>Data<input type="date" name="date" defaultValue={today} required /></label>
          </div>
          <FormError message={pay.error} />
          <div className="stack-actions">
            <button type="submit" className="btn btn-primary" disabled={pay.pending}>
              {pay.pending ? "Pagando…" : "Pagar com o saldo desta conta"}
            </button>
          </div>
          <p className="hint">Tira o valor do saldo desta conta e abate na fatura. Nenhum pagamento real é feito pelo app.</p>
        </form>
      )}

      <div className="stack-actions">
        <Link className="btn btn-secondary" href={`/cartoes/${card.id}`}>Ver faturas</Link>
        <button type="button" className="btn btn-secondary" disabled={unlink.pending} onClick={() => unlink.run(card.id)}>Desligar cartão da conta</button>
      </div>
      <FormError message={unlink.error} />
    </div>
  );
}

function NoCard({ accountId, unlinked }: { accountId: string; unlinked: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const add = useServerAction(addAccountCard, () => setOpen(false));
  const link = useServerAction(linkAccountCard);
  const [pick, setPick] = useState(unlinked[0]?.id ?? "");
  return (
    <div className="stack">
      <p className="muted">Se esta conta tem cartão de crédito, adicione aqui: a fatura pode ser paga com o saldo da conta.</p>
      {open ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add.run(new FormData(e.currentTarget));
          }}
        >
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="submissionKey" value={submissionKey} />
          <AccountCardFields />
          <FormError message={add.error} />
          <div className="stack-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={add.pending}>{add.pending ? "Salvando…" : "Adicionar cartão"}</button>
          </div>
        </form>
      ) : (
        <div className="stack-actions">
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Adicionar cartão de crédito</button>
        </div>
      )}
      {!open && unlinked.length > 0 && (
        <div className="fields">
          <label>
            Ou ligar um cartão já cadastrado
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {unlinked.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="stack-actions">
            <button type="button" className="btn btn-secondary" disabled={link.pending || !pick} onClick={() => link.run(accountId, pick)}>Ligar à conta</button>
          </div>
        </div>
      )}
      <FormError message={link.error} />
    </div>
  );
}
