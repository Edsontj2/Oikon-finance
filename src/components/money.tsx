import { formatMoney } from "@/lib/money";

/** Valor em reais; com `signed`, mostra + verde ou − vermelho. */
export function Money({ cents, signed = false, testId }: { cents: number; signed?: boolean; testId?: string }) {
  const value = cents === 0 ? 0 : cents; // evita "-R$ 0,00" (zero negativo)
  const tone = value < 0 ? "neg" : value > 0 && signed ? "pos" : "";
  const text = signed && value > 0 ? `+ ${formatMoney(value)}` : formatMoney(value);
  return (
    <span className={`money ${tone}`} data-testid={testId} data-cents={value}>
      {text}
    </span>
  );
}
