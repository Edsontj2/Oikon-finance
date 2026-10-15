import type { Transaction } from "@/data/transactions";

/** Valor com sinal para exibir: entrada +, saída −. Transferência fica sem sinal. */
export function signedAmount(t: Pick<Transaction, "type" | "amount">): number {
  return t.type === "expense" ? -t.amount : t.amount;
}
