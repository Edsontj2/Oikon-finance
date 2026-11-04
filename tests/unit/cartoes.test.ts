import { describe, expect, it } from "vitest";
import {
  buildInvoices,
  invoiceDates,
  invoiceMonthFor,
  invoicePeriod,
  invoiceToPay,
  limitUsage,
  paymentInvoiceMonth,
  type CardEntry,
} from "@/domain/cards";

const fecha3vence10 = { closingDay: 3, dueDay: 10 };
const fecha25vence5 = { closingDay: 25, dueDay: 5 };
let seq = 0;
const charge = (date: string, amount: number, extra: Partial<CardEntry> = {}): CardEntry => ({
  id: String(++seq), date, amount, description: "compra", kind: "charge", cardKind: null, settled: true, invoiceMonth: null, ...extra,
});
const payment = (date: string, amount: number, settled = true): CardEntry => ({ ...charge(date, amount), kind: "payment", settled });

describe("em qual fatura cai a compra", () => {
  it("antes do fechamento: fatura do mês; no dia do fechamento ou depois: a seguinte", () => {
    expect(invoiceMonthFor("2026-11-02", fecha3vence10)).toBe("2026-11");
    expect(invoiceMonthFor("2026-11-03", fecha3vence10)).toBe("2026-12");
    expect(invoiceMonthFor("2026-11-30", fecha3vence10)).toBe("2026-12");
  });

  it("vencimento no mês seguinte ao fechamento", () => {
    expect(invoiceMonthFor("2026-11-24", fecha25vence5)).toBe("2026-12");
    expect(invoiceMonthFor("2026-11-25", fecha25vence5)).toBe("2027-01");
    expect(invoiceDates("2026-12", fecha25vence5)).toEqual({ month: "2026-12", closingDate: "2026-11-25", dueDate: "2026-12-05" });
  });

  it("dia 31 em mês curto vira o último dia", () => {
    const c = { closingDay: 31, dueDay: 8 };
    expect(invoiceDates("2027-03", c).closingDate).toBe("2027-02-28");
    expect(invoiceMonthFor("2027-02-27", c)).toBe("2027-03");
    expect(invoiceMonthFor("2027-02-28", c)).toBe("2027-04");
  });

  it("período de compras vai do fechamento anterior ao desta fatura", () => {
    expect(invoicePeriod("2026-12", fecha3vence10)).toEqual({ from: "2026-11-03", to: "2026-12-03" });
  });

  it("pagamento vale para a primeira fatura que vence a partir dele", () => {
    expect(paymentInvoiceMonth("2026-11-10", fecha3vence10)).toBe("2026-11");
    expect(paymentInvoiceMonth("2026-11-11", fecha3vence10)).toBe("2026-12");
  });
});

describe("faturas", () => {
  it("aberta, fechada, paga e próximas (parcelas)", () => {
    const entries = [
      charge("2026-10-20", 30000),
      charge("2026-11-05", 10000),
      charge("2026-12-05", 5000),
    ];
    const inv = buildInvoices(entries, fecha3vence10, "2026-11-06");
    const byMonth = Object.fromEntries(inv.map((i) => [i.month, i]));
    expect(byMonth["2026-11"]).toMatchObject({ status: "closed", total: 30000, remaining: 30000 });
    expect(byMonth["2026-12"]).toMatchObject({ status: "open", total: 10000 });
    expect(byMonth["2027-01"]).toMatchObject({ status: "future", total: 5000 });
    expect(invoiceToPay(inv)?.month).toBe("2026-11");
  });

  it("pagamento total quita; parcial deixa o resto para a próxima (rotativo)", () => {
    const entries = [charge("2026-10-20", 30000), payment("2026-11-08", 30000)];
    expect(buildInvoices(entries, fecha3vence10, "2026-11-09")[0]).toMatchObject({ month: "2026-11", status: "paid", remaining: 0 });

    const partial = [charge("2026-10-20", 30000), payment("2026-11-08", 10000), charge("2026-11-15", 2000)];
    const inv = buildInvoices(partial, fecha3vence10, "2026-11-20");
    expect(inv[0]).toMatchObject({ status: "partial", remaining: 20000 });
    expect(inv[1]).toMatchObject({ month: "2026-12", previousBalance: 20000, charges: 2000, total: 22000 });
    expect(invoiceToPay(inv)?.month).toBe("2026-12");
  });

  it("vencida sem pagamento; paga depois do vencimento vira 'paga depois do vencimento'", () => {
    const entries = [charge("2026-10-20", 30000)];
    const late = buildInvoices(entries, fecha3vence10, "2026-11-12");
    expect(late[0].status).toBe("overdue");
    const paidLate = buildInvoices([...entries, payment("2026-11-12", 30000)], fecha3vence10, "2026-11-12");
    expect(paidLate[0].status).toBe("paid_late");
    expect(paidLate[1].remaining).toBe(0);
  });

  it("pagamento agendado não conta como pago", () => {
    const inv = buildInvoices([charge("2026-10-20", 30000), payment("2026-11-10", 30000, false)], fecha3vence10, "2026-11-05");
    expect(inv[0]).toMatchObject({ paid: 0, scheduled: 30000, remaining: 30000, status: "closed" });
  });

  it("estorno abate a fatura; fatura escolhida à mão vale mais que a data", () => {
    const entries = [
      charge("2026-10-20", 30000),
      { ...charge("2026-10-25", 5000), kind: "credit" as const },
      charge("2026-11-03", 7000, { invoiceMonth: "2026-11" }),
    ];
    const inv = buildInvoices(entries, fecha3vence10, "2026-11-04");
    expect(inv[0]).toMatchObject({ month: "2026-11", charges: 37000, credits: 5000, total: 32000 });
  });

  it("saldo devedor do cadastro entra na fatura em que o cartão foi criado", () => {
    const inv = buildInvoices([], fecha3vence10, "2026-11-04", 35000, "2026-12");
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ month: "2026-12", total: 35000, status: "open" });
  });
});

describe("limite", () => {
  it("disponível = limite − tudo que ainda vai ser cobrado", () => {
    expect(limitUsage(500000, -240000)).toEqual({ limit: 500000, committed: 240000, available: 260000, percent: 48 });
    expect(limitUsage(null, -100)).toMatchObject({ available: null, committed: 100 });
    expect(limitUsage(100000, 5000)).toMatchObject({ committed: 0, available: 100000 });
  });
});
