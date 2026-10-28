/** Tipos e regras de lançamento que valem no servidor e na tela (sem acesso ao banco). */
import { addMonths } from "@/lib/dates";

export type TransactionType = "income" | "expense" | "transfer";

export const transactionTypes: Record<TransactionType, string> = {
  income: "Entrada",
  expense: "Saída",
  transfer: "Transferência",
};

export function isTransactionType(value: unknown): value is TransactionType {
  return typeof value === "string" && Object.hasOwn(transactionTypes, value);
}

export const MAX_REPEAT = 60;

export type Transaction = {
  id: string;
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  paid: boolean;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  seriesId: string | null;
  /** Compra parcelada: esta é a parcela `installmentNumber` de `installmentCount`. */
  installmentNumber: number | null;
  installmentCount: number | null;
};

export type InstallmentPlan = {
  /** Valor de cada parcela, em centavos (a primeira leva os centavos que sobram da divisão). */
  amounts: number[];
  /** Data de cada parcela: todo mês, no mesmo dia (31 vira o último dia em meses curtos). */
  dates: string[];
  lastDate: string;
};

/**
 * Divide uma compra em parcelas. `amount` é o total (`amountIsTotal`) ou o valor de cada parcela.
 * Usado na tela (para mostrar quando termina) e no servidor (para gravar), então os dois batem.
 */
export function installmentPlan(firstDate: string, count: number, amount: number, amountIsTotal: boolean): InstallmentPlan {
  const base = amountIsTotal ? Math.floor(amount / count) : amount;
  const remainder = amountIsTotal ? amount - base * count : 0;
  const amounts = Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
  const dates = Array.from({ length: count }, (_, i) => addMonths(firstDate, i));
  return { amounts, dates, lastDate: dates[dates.length - 1] };
}

/** Valor com sinal para exibir: entrada +, saída −. Transferência fica sem sinal. */
export function signedAmount(t: Pick<Transaction, "type" | "amount">): number {
  return t.type === "expense" ? -t.amount : t.amount;
}
