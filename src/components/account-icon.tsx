import { Banknote, Building2, CreditCard, Landmark, PiggyBank, Smartphone, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { defaultIcon, type AccountIcon as IconName, type AccountType } from "@/domain/accounts";

export const accountIconComponents: Record<IconName, LucideIcon> = {
  wallet: Wallet,
  bank: Landmark,
  piggy: PiggyBank,
  cash: Banknote,
  card: CreditCard,
  chart: TrendingUp,
  phone: Smartphone,
  building: Building2,
};

export const accountIconLabels: Record<IconName, string> = {
  wallet: "Carteira",
  bank: "Banco",
  piggy: "Cofrinho",
  cash: "Dinheiro",
  card: "Cartão",
  chart: "Investimento",
  phone: "Banco digital",
  building: "Empresa",
};

/** Ícone da conta na cor escolhida (ou o padrão do tipo). */
export function AccountIcon({ icon, color, type, size = 18 }: { icon?: IconName | null; color?: string | null; type: AccountType; size?: number }) {
  const Icon = accountIconComponents[icon ?? defaultIcon[type]];
  return (
    <span className="account-icon" style={color ? { color, background: `${color}22`, borderColor: `${color}55` } : undefined} aria-hidden>
      <Icon size={size} strokeWidth={1.75} />
    </span>
  );
}
