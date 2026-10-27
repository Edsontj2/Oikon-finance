/** Tipos e regras de lançamento que valem no servidor e na tela (sem acesso ao banco). */
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
};

/** Valor com sinal para exibir: entrada +, saída −. Transferência fica sem sinal. */
export function signedAmount(t: Pick<Transaction, "type" | "amount">): number {
  return t.type === "expense" ? -t.amount : t.amount;
}
