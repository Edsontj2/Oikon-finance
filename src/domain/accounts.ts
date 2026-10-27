export const accountTypes = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
} as const;
export type AccountType = keyof typeof accountTypes;

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && Object.hasOwn(accountTypes, value);
}

export type AccountOption = { id: string; name: string; type: AccountType };

export type AccountWithBalance = AccountOption & {
  initialBalance: number;
  /** Saldo atual: saldo inicial + o que já foi pago/recebido até hoje. */
  balance: number;
  /** Saldo depois que os pendentes (e os lançamentos futuros) acontecerem. */
  projectedBalance: number;
  transactionCount: number;
};
