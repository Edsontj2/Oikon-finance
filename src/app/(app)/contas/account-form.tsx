"use client";

import { useState } from "react";
import { accountTypes, type AccountType, type AccountWithBalance } from "@/domain/accounts";
import { LIMITS } from "@/domain/limits";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { saveAccount } from "../actions";

export function AccountForm({
  account,
  onDone,
  onCancel,
}: {
  account?: AccountWithBalance;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const { run, pending, error } = useServerAction(saveAccount, onDone);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget));
      }}
    >
      {account ? <input type="hidden" name="id" value={account.id} /> : <input type="hidden" name="submissionKey" value={submissionKey} />}
      <label>
        Nome
        <input name="name" required maxLength={LIMITS.accountName} defaultValue={account?.name} placeholder="Ex.: Nubank" autoComplete="off" />
      </label>
      <label>
        Tipo
        <select name="type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {Object.entries(accountTypes).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <MoneyInput
        name="initialBalance"
        label="Saldo inicial (R$)"
        defaultCents={account?.initialBalance}
        allowNegative
        hint={type === "credit_card" ? "Fatura em aberto? Use negativo, ex.: -350,00" : "Quanto tinha na conta ao começar a usar o OIKON."}
      />
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando…" : account ? "Salvar alterações" : "Criar conta"}
        </button>
      </div>
    </form>
  );
}
