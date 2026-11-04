export const accountTypes = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  investment: "Investimento",
  loan: "Empréstimo ou dívida",
} as const;
export type AccountType = keyof typeof accountTypes;

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && Object.hasOwn(accountTypes, value);
}

/** Ícones que a pessoa pode escolher (o desenho de cada um está na tela). */
export const accountIcons = ["wallet", "bank", "piggy", "cash", "card", "chart", "phone", "building"] as const;
export type AccountIcon = (typeof accountIcons)[number];
export function isAccountIcon(value: unknown): value is AccountIcon {
  return typeof value === "string" && (accountIcons as readonly string[]).includes(value);
}

/** Cores sugeridas (legíveis sobre o fundo escuro). */
export const accountColors = ["#e8b04b", "#3987e5", "#2fb67c", "#d9534f", "#9b6bd6", "#e07b39", "#4bb7c9", "#a3a3a3"] as const;
export function isAccountColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

/** Ícone padrão de cada tipo, quando a pessoa não escolheu. */
export const defaultIcon: Record<AccountType, AccountIcon> = {
  checking: "bank",
  savings: "piggy",
  cash: "cash",
  credit_card: "card",
  investment: "chart",
  loan: "building",
};

/** Tipos que a pessoa cria em Contas (empréstimo é criado pela tela de Dívidas). */
export const userAccountTypes = (Object.keys(accountTypes) as AccountType[]).filter((t) => t !== "loan");

/** Contas onde está o dinheiro do dia a dia (sem cartão e sem empréstimo). */
export function isMoneyAccount(type: AccountType): boolean {
  return type !== "credit_card" && type !== "loan";
}

export type AccountOption = { id: string; name: string; type: AccountType; archived?: boolean };

export type AccountWithBalance = AccountOption & {
  initialBalance: number;
  /** Saldo atual: saldo inicial + o que já foi pago/recebido até hoje. */
  balance: number;
  /** Saldo depois que os pendentes (e os lançamentos futuros) acontecerem. */
  projectedBalance: number;
  transactionCount: number;
  institution?: string | null;
  color?: string | null;
  icon?: AccountIcon | null;
  archived?: boolean;
  /** Cheque especial (só conta corrente), em centavos. */
  overdraftLimit?: number | null;
};

/** Quanto ainda dá para gastar na conta contando o cheque especial. */
export function availableWithOverdraft(a: Pick<AccountWithBalance, "balance" | "overdraftLimit">): number {
  return a.balance + (a.overdraftLimit ?? 0);
}
