"use client";

import { useState } from "react";
import type { AccountOption } from "@/domain/accounts";
import type { CategoryOption } from "@/domain/categories";
import { MAX_REPEAT, installmentPlan, type Transaction, type TransactionType } from "@/domain/transactions";
import { formatMoney } from "@/lib/money";
import { formatDate, formatMonth, today } from "@/lib/dates";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { LIMITS } from "@/domain/limits";
import { saveTransaction } from "../actions";

const typeLabels: Record<TransactionType, string> = { expense: "Saída", income: "Entrada", transfer: "Transferência" };
const paidLabels: Record<TransactionType, string> = {
  expense: "Já foi pago",
  income: "Já foi recebido",
  transfer: "Já foi feita",
};

const LAST_ACCOUNT_KEY = "oikon:ultima-conta";

/** A conta usada no último lançamento (só uma conveniência: se o navegador não guardar, usa a primeira). */
function lastAccount(accounts: AccountOption[]): string | undefined {
  try {
    const id = localStorage.getItem(LAST_ACCOUNT_KEY);
    return accounts.some((a) => a.id === id) ? id ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

function rememberAccount(id: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Sem armazenamento (aba anônima, por exemplo): só não lembra.
  }
}

/** Formulário de lançamento: o mesmo para criar (sem `transaction`) e editar. */
export function TransactionForm({
  accounts,
  categories,
  transaction,
  onDone,
  onCancel,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  transaction?: Transaction;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(transaction);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<TransactionType>(transaction?.type ?? "expense");
  const [accountId, setAccountId] = useState(() => transaction?.accountId ?? lastAccount(accounts) ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(transaction?.date ?? today());
  const [paid, setPaid] = useState(transaction?.paid ?? true);
  const [paidTouched, setPaidTouched] = useState(editing);
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [cents, setCents] = useState<number | null>(transaction?.amount ?? null);
  const { run, pending, error } = useServerAction(saveTransaction, () => {
    rememberAccount(accountId);
    onDone();
  });

  const isTransfer = type === "transfer";
  const onCard = accounts.find((a) => a.id === accountId)?.type === "credit_card";
  // Transferência não parcela: se estava em "parcelado", volta para "uma vez".
  const freq: Frequency = isTransfer && frequency === "installments" ? "once" : frequency;
  const categoryOptions = categories.filter((c) => c.kind === type);
  const destinations = accounts.filter((a) => a.id !== accountId);

  function changeDate(value: string) {
    setDate(value);
    // Data no futuro normalmente ainda não foi paga (a menos que a pessoa tenha escolhido).
    if (!paidTouched) setPaid(value <= today());
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget));
      }}
    >
      {transaction && <input type="hidden" name="id" value={transaction.id} />}
      {!editing && <input type="hidden" name="submissionKey" value={submissionKey} />}
      <input type="hidden" name="type" value={type} />

      <div className="segmented" role="radiogroup" aria-label="Tipo de lançamento">
        {(Object.keys(typeLabels) as TransactionType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className={`segment segment-${t} ${type === t ? "active" : ""}`}
            onClick={() => setType(t)}
          >
            {typeLabels[t]}
          </button>
        ))}
      </div>

      <label>
        Descrição
        <input
          name="description"
          required
          maxLength={LIMITS.description}
          defaultValue={transaction?.description}
          placeholder={isTransfer ? "Ex.: Pagamento da fatura" : type === "income" ? "Ex.: Salário" : "Ex.: Mercado"}
          autoComplete="off"
        />
      </label>

      <div className="fields">
        <MoneyInput
          name="amount"
          label="Valor (R$)"
          required
          defaultCents={transaction?.amount}
          onCentsChange={setCents}
        />
        <label>
          Data
          <input name="date" type="date" required value={date} min="1900-01-01" max="2100-12-31" onChange={(e) => changeDate(e.target.value)} />
        </label>
      </div>

      <div className="fields">
        <label>
          {isTransfer ? "Sai de" : "Conta"}
          <select name="accountId" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {isTransfer ? (
          <label>
            Vai para
            <select name="toAccountId" required defaultValue={transaction?.toAccountId ?? ""}>
              <option value="" disabled>Escolha a conta</option>
              {destinations.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {destinations.length === 0 && <span className="hint">Crie outra conta para transferir.</span>}
          </label>
        ) : (
          <label>
            Categoria
            <select name="categoryId" key={type} defaultValue={transaction?.type === type ? transaction.categoryId ?? "" : ""}>
              <option value="">Sem categoria</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="check">
        <input
          type="checkbox"
          name="paid"
          checked={paid}
          onChange={(e) => {
            setPaid(e.target.checked);
            setPaidTouched(true);
          }}
        />
        {paidLabels[type]}
        {!paid && <span className="hint">(fica como pendente e não mexe no saldo atual)</span>}
        {paid && date > today() && (
          <span className="hint">Data no futuro: só sai do saldo em {formatDate(date)}. Se já pagou, use a data de hoje.</span>
        )}
      </label>

      {!editing && (
        <div className="repeat-box">
          <input type="hidden" name="frequency" value={freq} />
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Quantas vezes">
            {(Object.keys(frequencyLabels) as Frequency[])
              .filter((f) => !(isTransfer && f === "installments"))
              .map((f) => (
                <button key={f} type="button" role="radio" aria-checked={freq === f} className={`segment ${freq === f ? "active" : ""}`} onClick={() => setFrequency(f)}>
                  {frequencyLabels[f]}
                </button>
              ))}
          </div>
          {freq === "installments" && <InstallmentFields date={date} cents={cents} onCard={onCard} />}
          {freq === "monthly" && (
            <label>
              Por quantos meses?
              <input name="repeat" type="number" inputMode="numeric" min={2} max={MAX_REPEAT} step={1} defaultValue={12} required />
              <span className="hint">
                Mesmo valor todo mês, no mesmo dia (assinatura, aluguel). Os dos próximos meses ficam pendentes até você pagar.
              </span>
            </label>
          )}
        </div>
      )}
      {editing && transaction?.installmentCount ? (
        <p className="hint">
          Parcela {transaction.installmentNumber} de {transaction.installmentCount}. A edição muda só esta parcela.
        </p>
      ) : (
        editing && transaction?.seriesId && <p className="hint">Este lançamento faz parte de uma série mensal. A edição muda só este mês.</p>
      )}

      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando…" : editing ? "Salvar alterações" : "Salvar lançamento"}
        </button>
      </div>
    </form>
  );
}

type Frequency = "once" | "installments" | "monthly";
const frequencyLabels: Record<Frequency, string> = { once: "Uma vez", installments: "Parcelado", monthly: "Todo mês" };

/** Parcelas: o usuário diz quantas e se o valor é o total; a tela mostra o valor de cada uma e quando termina. */
function InstallmentFields({ date, cents, onCard }: { date: string; cents: number | null; onCard: boolean }) {
  const [count, setCount] = useState("10");
  const [amountIs, setAmountIs] = useState<"total" | "installment">("total");
  const n = /^\d{1,2}$/.test(count) ? Number(count) : 0;
  const valid = n >= 2 && n <= MAX_REPEAT && cents !== null && cents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const plan = valid ? installmentPlan(date, n, cents, amountIs === "total") : null;
  const total = plan ? plan.amounts.reduce((s, a) => s + a, 0) : 0;

  return (
    <>
      <div className="fields">
        <label>
          Número de parcelas
          <input
            name="installments"
            type="number"
            inputMode="numeric"
            min={2}
            max={MAX_REPEAT}
            step={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            required
          />
        </label>
        <label>
          O valor digitado é
          <select name="amountIs" value={amountIs} onChange={(e) => setAmountIs(e.target.value as "total" | "installment")}>
            <option value="total">O total da compra</option>
            <option value="installment">O valor de cada parcela</option>
          </select>
        </label>
      </div>
      {plan ? (
        <div className="installment-preview" data-testid="previa-parcelas">
          <strong>
            {n}x de {formatMoney(plan.amounts[n - 1])}
            {plan.amounts[0] !== plan.amounts[n - 1] && ` (1ª de ${formatMoney(plan.amounts[0])})`}
          </strong>
          <span>
            Total {formatMoney(total)} · 1ª em {formatDate(plan.dates[0])} · <b>última em {formatDate(plan.lastDate)}</b> (
            {formatMonth(plan.lastDate.slice(0, 7))})
          </span>
          <span className="hint">
            {onCard
              ? "No cartão, cada parcela entra sozinha na fatura do mês dela."
              : "A 1ª parcela segue o \"Já foi pago\" acima; as outras ficam pendentes até você pagar."}
          </span>
        </div>
      ) : (
        <span className="hint">Informe o valor e de 2 a {MAX_REPEAT} parcelas para ver quando termina.</span>
      )}
    </>
  );
}
