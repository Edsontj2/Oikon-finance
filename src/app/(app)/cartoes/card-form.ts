import { field, moneyField } from "../../action-result";

/** Limite, fechamento, vencimento e final do cartão, lidos de um formulário. */
export function cardSettingsFromForm(form: FormData) {
  return {
    creditLimit: moneyField(form, "creditLimit", "Limite", true),
    closingDay: dayOrNull(form, "closingDay"),
    dueDay: dayOrNull(form, "dueDay"),
    last4: field(form, "last4") || null,
  };
}

export function dayOrNull(form: FormData, name: string): number | null {
  const text = field(form, name).trim();
  if (!text) return null;
  return /^\d{1,2}$/.test(text) ? Number(text) : Number.NaN;
}
