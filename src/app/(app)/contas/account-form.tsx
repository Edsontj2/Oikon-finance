"use client";

import { useState } from "react";
import { accountColors, accountIcons, accountTypes, defaultIcon, type AccountType, type AccountWithBalance } from "@/domain/accounts";
import { LIMITS } from "@/domain/limits";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { accountIconComponents, accountIconLabels } from "@/components/account-icon";
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
  const selectedIcon = account?.icon ?? defaultIcon[type];
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
      <div className="fields">
        <label>
          Tipo
          <select name="type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {Object.entries(accountTypes).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Instituição (opcional)
          <input name="institution" maxLength={40} defaultValue={account?.institution ?? ""} placeholder="Ex.: Nu Pagamentos" autoComplete="off" />
        </label>
      </div>
      <MoneyInput
        name="initialBalance"
        label="Saldo inicial (R$)"
        defaultCents={account?.initialBalance}
        allowNegative
        hint={type === "credit_card" ? "Fatura em aberto? Use negativo, ex.: -350,00" : "Quanto tinha na conta ao começar a usar o OIKON."}
      />
      {type === "checking" && (
        <MoneyInput
          name="overdraftLimit"
          label="Cheque especial (R$, opcional)"
          defaultCents={account?.overdraftLimit}
          hint="Limite que o banco libera além do saldo. Só serve de aviso: o app não usa como dinheiro seu."
        />
      )}
      <fieldset className="choice-grid" key={`icon-${type}`}>
        <legend>Ícone</legend>
        {accountIcons.map((icon) => {
          const Icon = accountIconComponents[icon];
          return (
            <label key={icon} className="choice" title={accountIconLabels[icon]}>
              <input type="radio" name="icon" value={icon} defaultChecked={icon === selectedIcon} aria-label={accountIconLabels[icon]} />
              <span><Icon size={18} strokeWidth={1.75} aria-hidden /></span>
            </label>
          );
        })}
      </fieldset>
      <fieldset className="choice-grid">
        <legend>Cor</legend>
        {accountColors.map((color, i) => (
          <label key={color} className="choice" title={`Cor ${i + 1}`}>
            <input type="radio" name="color" value={color} defaultChecked={(account?.color ?? accountColors[0]) === color} aria-label={`Cor ${i + 1}`} />
            <span><span className="swatch-dot" style={{ background: color }} /></span>
          </label>
        ))}
      </fieldset>
      {type === "credit_card" && <p className="hint">Limite, fechamento, vencimento e conta que paga a fatura ficam em Cartões.</p>}
      {type === "investment" && <p className="hint">Use para aplicações e corretora. Aportes e resgates são transferências; rendimento é uma entrada.</p>}
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
