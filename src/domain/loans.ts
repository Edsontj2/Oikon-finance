/**
 * Simulação de empréstimos e financiamentos, sem acesso ao banco: usada na tela (simulador) e no
 * servidor (para gravar as parcelas), então os dois batem. Valores em centavos; taxa ao mês em %.
 *
 * - Price (tabela Price): parcelas iguais; no começo paga mais juros, no fim mais amortização.
 * - SAC: amortização igual todo mês; parcelas começam maiores e vão caindo.
 * Arredondamento: cada parcela é arredondada para o centavo e a última corrige a diferença,
 * para a soma das amortizações ser exatamente o valor emprestado.
 */
import { addMonths } from "@/lib/dates";

export type AmortizationSystem = "price" | "sac";
export const amortizationSystems: Record<AmortizationSystem, string> = {
  price: "Price (parcelas iguais)",
  sac: "SAC (parcelas decrescentes)",
};
export function isAmortizationSystem(value: unknown): value is AmortizationSystem {
  return value === "price" || value === "sac";
}

export const MAX_LOAN_INSTALLMENTS = 420;
/** Teto de taxa aceita (ao mês), para pegar erro de digitação (ex.: 25 em vez de 2,5). */
export const MAX_MONTHLY_RATE = 30;

export type LoanInstallment = {
  number: number;
  date: string;
  /** Valor da parcela = amortização + juros. */
  amount: number;
  principal: number;
  interest: number;
  /** Saldo devedor depois de pagar esta parcela. */
  balance: number;
};

export type LoanSchedule = {
  installments: LoanInstallment[];
  totalPaid: number;
  totalInterest: number;
  /** Taxa equivalente ao ano, em %. */
  yearlyRate: number;
};

export function loanSchedule(principal: number, monthlyRatePercent: number, count: number, firstDate: string, system: AmortizationSystem): LoanSchedule {
  const i = monthlyRatePercent / 100;
  const installments: LoanInstallment[] = [];
  let balance = principal;
  const pricePmt = i === 0 ? principal / count : (principal * i) / (1 - Math.pow(1 + i, -count));
  const sacPrincipal = principal / count;
  for (let n = 1; n <= count; n++) {
    const interest = Math.round(balance * i);
    let amortization = system === "price" ? Math.round(pricePmt) - interest : Math.round(sacPrincipal);
    if (n === count || amortization > balance) amortization = balance;
    if (amortization < 0) amortization = 0;
    balance -= amortization;
    installments.push({ number: n, date: addMonths(firstDate, n - 1), amount: amortization + interest, principal: amortization, interest, balance });
  }
  const totalPaid = installments.reduce((s, p) => s + p.amount, 0);
  return {
    installments,
    totalPaid,
    totalInterest: totalPaid - principal,
    yearlyRate: Math.round((Math.pow(1 + i, 12) - 1) * 10000) / 100,
  };
}

/**
 * Quitação antecipada: o que falta de amortização depois das parcelas já pagas (os juros futuros
 * deixam de existir). É uma estimativa: o banco pode cobrar tarifas ou usar outra data-base.
 */
export function payoffEstimate(schedule: LoanSchedule, paidCount: number): { remainingPrincipal: number; interestSaved: number } {
  const rest = schedule.installments.slice(paidCount);
  return {
    remainingPrincipal: rest.reduce((s, p) => s + p.principal, 0),
    interestSaved: rest.reduce((s, p) => s + p.interest, 0),
  };
}

/** Validação comum (tela e servidor); devolve a mensagem do problema ou null. */
export function loanInputError(principal: number, monthlyRatePercent: number, count: number): string | null {
  if (!Number.isSafeInteger(principal) || principal <= 0) return "O valor precisa ser maior que zero.";
  if (!Number.isFinite(monthlyRatePercent) || monthlyRatePercent < 0) return "Informe a taxa de juros ao mês (0 se não tem juros).";
  if (monthlyRatePercent > MAX_MONTHLY_RATE) return `Taxa acima de ${MAX_MONTHLY_RATE}% ao mês: confira se digitou certo (ex.: 2,5).`;
  if (!Number.isInteger(count) || count < 1 || count > MAX_LOAN_INSTALLMENTS) return `Parcelas devem ser entre 1 e ${MAX_LOAN_INSTALLMENTS}.`;
  return null;
}
