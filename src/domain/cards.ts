/**
 * Regras de cartão de crédito sem acesso ao banco: em qual fatura cai cada compra, quanto
 * cada fatura soma e em que situação está. Usado pelo servidor, pela tela e pelo WhatsApp.
 *
 * Convenções (as dos bancos brasileiros):
 * - A fatura é identificada pelo mês do vencimento ("AAAA-MM").
 * - Compra feita ANTES do dia de fechamento entra na fatura que fecha naquele mês; no dia do
 *   fechamento ou depois, vai para a próxima (por isso o "melhor dia de compra" é o fechamento).
 * - Vencimento depois do fechamento no mesmo mês (fecha 3, vence 10) ou no mês seguinte
 *   (fecha 25, vence 5).
 * - Dia 31 em mês curto vira o último dia do mês.
 * - Cartão sem fechamento cadastrado: cada mês do calendário é uma fatura, que vence no dia 1º
 *   do mês seguinte, só para organizar (a tela pede para cadastrar os dias certos).
 */
import { addMonths, shiftMonth } from "@/lib/dates";

export type CardCycle = { closingDay: number | null; dueDay: number | null };

export const cardKinds = {
  refund: "Estorno",
  interest: "Juros",
  fee: "Multa, tarifa ou anuidade",
  iof: "IOF",
  invoice_credit: "Crédito do parcelamento da fatura",
  invoice_installment: "Parcela da fatura",
} as const;
export type CardKind = keyof typeof cardKinds;
/** Encargos que a pessoa pode lançar numa fatura. */
export const chargeKinds = ["interest", "fee", "iof"] as const;
export type ChargeKind = (typeof chargeKinds)[number];

export function isChargeKind(value: unknown): value is ChargeKind {
  return typeof value === "string" && (chargeKinds as readonly string[]).includes(value);
}

function lastDay(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Dia `day` do mês, ou o último dia se o mês for mais curto. */
export function dayOf(month: string, day: number): string {
  return `${month}-${String(Math.min(day, lastDay(month))).padStart(2, "0")}`;
}

export type InvoiceDates = {
  /** Mês do vencimento: identifica a fatura. */
  month: string;
  /** Data em que a fatura fecha (compras a partir dela vão para a próxima). */
  closingDate: string;
  dueDate: string;
};

/** Datas da fatura que vence em `month`. */
export function invoiceDates(month: string, cycle: CardCycle): InvoiceDates {
  if (!cycle.closingDay || !cycle.dueDay) {
    return { month, closingDate: `${month}-01`, dueDate: `${month}-01` };
  }
  const closesBeforeDueSameMonth = cycle.dueDay > cycle.closingDay;
  const closingMonth = closesBeforeDueSameMonth ? month : shiftMonth(month, -1);
  return { month, closingDate: dayOf(closingMonth, cycle.closingDay), dueDate: dayOf(month, cycle.dueDay) };
}

/** Em qual fatura (mês do vencimento) cai uma compra feita em `date`. */
export function invoiceMonthFor(date: string, cycle: CardCycle): string {
  const month = date.slice(0, 7);
  if (!cycle.closingDay || !cycle.dueDay) return shiftMonth(month, 1);
  const closingMonth = date < dayOf(month, cycle.closingDay) ? month : shiftMonth(month, 1);
  return cycle.dueDay > cycle.closingDay ? closingMonth : shiftMonth(closingMonth, 1);
}

/** Período de compras da fatura: do fechamento anterior (incluso) ao fechamento dela (exclusivo). */
export function invoicePeriod(month: string, cycle: CardCycle): { from: string; to: string } {
  const to = invoiceDates(month, cycle).closingDate;
  const from = cycle.closingDay && cycle.dueDay ? invoiceDates(shiftMonth(month, -1), cycle).closingDate : addMonths(to, -1);
  return { from, to };
}

/** Lançamento do cartão, do jeito que o cálculo da fatura precisa. */
export type CardEntry = {
  id: string;
  date: string;
  /** Centavos, positivo. */
  amount: number;
  description: string;
  /** charge: compra/encargo (aumenta a fatura); credit: estorno/crédito; payment: pagamento recebido. */
  kind: "charge" | "credit" | "payment";
  cardKind: CardKind | null;
  /** Pagamento: só conta quando já foi pago (pago e com data até hoje). */
  settled: boolean;
  /** Fatura escolhida à mão; vazio = pela data. */
  invoiceMonth: string | null;
  installmentNumber?: number | null;
  installmentCount?: number | null;
  categoryName?: string | null;
};

export type InvoiceStatus = "open" | "closed" | "paid" | "paid_late" | "installed" | "partial" | "overdue" | "future" | "empty";

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  open: "Aberta",
  closed: "Fechada",
  paid: "Paga",
  paid_late: "Paga depois do vencimento",
  installed: "Parcelada",
  partial: "Paga em parte",
  overdue: "Vencida",
  future: "Próxima",
  empty: "Sem lançamentos",
};

export type Invoice = InvoiceDates & {
  status: InvoiceStatus;
  /** Saldo que veio da fatura anterior (vencida sem pagar tudo; negativo = crédito). */
  previousBalance: number;
  /** Compras, parcelas e encargos desta fatura. */
  charges: number;
  /** Estornos e créditos. */
  credits: number;
  /** previousBalance + charges − credits. */
  total: number;
  /** Pagamentos feitos entre o vencimento anterior e o desta fatura. */
  paid: number;
  /** total − paid (negativo = pagou a mais e sobrou crédito). */
  remaining: number;
  /** Pagamentos agendados (ainda não pagos) para esta fatura. */
  scheduled: number;
  entries: CardEntry[];
};

/**
 * Monta as faturas do cartão a partir dos lançamentos, em ordem de vencimento.
 *
 * Os pagamentos valem para a fatura cujo vencimento é o primeiro a partir da data do pagamento.
 * Depois do vencimento, o que ficou sem pagar (ou o crédito que sobrou) passa para a próxima
 * fatura como "saldo anterior": é o rotativo. Juros do rotativo não são inventados: a pessoa
 * lança o valor que o banco cobrou.
 *
 * `openingDebt` é o saldo devedor de quando o cartão foi cadastrado (saldo inicial negativo).
 */
export function buildInvoices(
  entries: CardEntry[],
  cycle: CardCycle,
  todayStr: string,
  openingDebt = 0,
  openingMonth?: string,
): Invoice[] {
  const current = invoiceMonthFor(todayStr, cycle);
  const opening = openingDebt !== 0 ? (openingMonth && openingMonth < current ? openingMonth : current) : null;
  const keyOf = (e: CardEntry) => {
    if (e.invoiceMonth) return e.invoiceMonth;
    if (e.kind === "payment") return paymentInvoiceMonth(e.date, cycle);
    return invoiceMonthFor(e.date, cycle);
  };
  const keys = entries.map(keyOf);
  const first = [...keys, opening ?? current].reduce((a, b) => (b < a ? b : a), current);
  const last = keys.reduce((a, b) => (b > a ? b : a), current);

  const invoices: Invoice[] = [];
  let carry = 0;
  for (let month = first; month <= last; month = shiftMonth(month, 1)) {
    const dates = invoiceDates(month, cycle);
    const mine = entries.filter((e, i) => keys[i] === month);
    const charges = sum(mine.filter((e) => e.kind === "charge"));
    const credits = sum(mine.filter((e) => e.kind === "credit"));
    const paid = sum(mine.filter((e) => e.kind === "payment" && e.settled));
    const scheduled = sum(mine.filter((e) => e.kind === "payment" && !e.settled));
    const previousBalance = carry + (month === opening ? openingDebt : 0);
    const total = previousBalance + charges - credits;
    const remaining = total - paid;
    let status = statusOf(dates, todayStr, month === current, charges, remaining, paid, mine.length > 0 || previousBalance !== 0);
    if (remaining <= 0 && mine.some((e) => e.cardKind === "invoice_credit")) status = "installed";
    invoices.push({ ...dates, status, previousBalance, charges, credits, total, paid, remaining, scheduled, entries: mine });
    // Venceu: o que sobrou (dívida ou crédito) vai para a próxima. Ainda não venceu: fica nela.
    carry = todayStr > dates.dueDate ? remaining : 0;
  }
  // Vencida cujo saldo passou para a seguinte e lá foi pago: foi quitada, só que com atraso.
  for (let i = 0; i < invoices.length - 1; i++) {
    const inv = invoices[i];
    const next = invoices[i + 1];
    if ((inv.status === "overdue" || inv.status === "partial") && next.previousBalance > 0 && next.paid >= next.previousBalance) {
      inv.status = "paid_late";
    }
  }
  return invoices;
}

/** Pagamento feito em `date` vale para a primeira fatura que vence a partir dessa data. */
export function paymentInvoiceMonth(date: string, cycle: CardCycle): string {
  let month = date.slice(0, 7);
  while (invoiceDates(month, cycle).dueDate < date) month = shiftMonth(month, 1);
  return month;
}

function sum(list: CardEntry[]): number {
  return list.reduce((s, e) => s + e.amount, 0);
}

function statusOf(
  dates: InvoiceDates,
  todayStr: string,
  isCurrent: boolean,
  charges: number,
  remaining: number,
  paid: number,
  hasAnything: boolean,
): InvoiceStatus {
  // Ainda recebendo compras: a de agora é a "aberta"; as seguintes (parcelas) são "próximas".
  if (todayStr < dates.closingDate) return isCurrent ? "open" : "future";
  if (!hasAnything) return "empty";
  if (remaining <= 0) return charges > 0 || paid > 0 ? "paid" : "empty";
  if (todayStr <= dates.dueDate) return "closed";
  return paid > 0 ? "partial" : "overdue";
}

/** A fatura atual (a que está recebendo compras hoje). */
export function currentInvoice(invoices: Invoice[], todayStr: string, cycle: CardCycle): Invoice | undefined {
  const month = invoiceMonthFor(todayStr, cycle);
  return invoices.find((i) => i.month === month);
}

/**
 * A fatura que a pessoa precisa pagar agora: a fechada mais recente ainda não quitada. Como o
 * saldo de uma vencida passa para a seguinte, o valor dela já inclui o que ficou para trás.
 */
export function invoiceToPay(invoices: Invoice[]): Invoice | undefined {
  const unpaid = invoices.filter((i) => ["closed", "overdue", "partial"].includes(i.status) && i.remaining > 0);
  const last = unpaid[unpaid.length - 1];
  if (!last) return undefined;
  // A vencida já passou o saldo para a aberta? Então quem cobra é ela (com o saldo anterior).
  const after = invoices[invoices.indexOf(last) + 1];
  return last.status !== "closed" && after && after.previousBalance > 0 ? after : last;
}

/**
 * Limite: disponível = limite − tudo o que ainda vai ser cobrado (faturas em aberto e parcelas
 * futuras, já descontados os pagamentos). `projectedBalance` é o saldo do cartão com o futuro.
 */
export function limitUsage(limit: number | null, projectedBalance: number) {
  const committed = Math.max(0, -projectedBalance);
  if (!limit) return { limit: null, committed, available: null, percent: null };
  return {
    limit,
    committed,
    available: limit - committed,
    percent: Math.min(100, Math.round((committed / limit) * 100)),
  };
}

/** Parcelas futuras por fatura (o limite que já está comprometido nos próximos meses). */
export function futureCommitment(invoices: Invoice[], todayStr: string, months = 6) {
  return invoices
    .filter((i) => i.closingDate > todayStr)
    .slice(0, months)
    .map((i) => ({ month: i.month, amount: Math.max(0, i.charges - i.credits) }));
}
