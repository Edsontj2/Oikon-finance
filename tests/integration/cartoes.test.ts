import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { listCategoryOptions, listCategories } from "@/data/categories";
import { monthSummary } from "@/data/dashboard";
import { createTransaction, updateTransaction } from "@/data/transactions";
import {
  addCharge,
  addRefund,
  getCard,
  installInvoice,
  limitHistory,
  listCards,
  moveToInvoice,
  payInvoice,
  updateCardSettings,
} from "@/data/cards";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

const R = (reais: number) => Math.round(reais * 100);
// Hoje = 04/11/2026. Cartão fecha dia 3 e vence dia 10: a fatura de novembro já fechou.
const NOW = new Date("2026-11-04T15:00:00Z");

async function setup() {
  const userId = await newUser(db);
  const bank = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(5000) }))!;
  const card = (await createAccount(db, userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
  await updateCardSettings(db, userId, card, {
    creditLimit: R(3000), closingDay: 3, dueDay: 10, payerAccountId: bank, brand: "Visa", last4: "1234",
  });
  const buy = (date: string, amount: number, extra = {}) =>
    createTransaction(db, userId, { type: "expense", description: "Compra", amount, date, paid: true, accountId: card, ...extra });
  const invoice = async (month: string) => (await getCard(db, userId, card, NOW))!.invoices.find((i) => i.month === month)!;
  const balance = async (id: string) => (await listAccounts(db, userId, NOW)).find((a) => a.id === id)!.balance;
  return { userId, bank, card, buy, invoice, balance };
}

describe("configurações do cartão", () => {
  it("salva limite, dias, conta pagadora; mudança de limite vai para o histórico", async () => {
    const s = await setup();
    const [card] = await listCards(db, s.userId, NOW);
    expect(card).toMatchObject({ creditLimit: R(3000), closingDay: 3, dueDay: 10, payerAccountName: "Banco", brand: "Visa", last4: "1234", configured: true });
    await updateCardSettings(db, s.userId, s.card, { creditLimit: R(4000), closingDay: 3, dueDay: 10, payerAccountId: s.bank, brand: "Visa", last4: "1234" });
    await updateCardSettings(db, s.userId, s.card, { creditLimit: R(4000), closingDay: 3, dueDay: 10, payerAccountId: s.bank, brand: "Visa", last4: "1234" });
    expect((await limitHistory(db, s.userId, s.card)).map((h) => h.limit)).toEqual([R(4000), R(3000)]);
  });

  it("recusa dados inválidos e cartão de outra pessoa", async () => {
    const s = await setup();
    const ok = { creditLimit: R(1), closingDay: 3, dueDay: 10, payerAccountId: null, brand: null, last4: null };
    await expect(updateCardSettings(db, s.userId, s.card, { ...ok, closingDay: 32 })).rejects.toThrow("entre 1 e 31");
    await expect(updateCardSettings(db, s.userId, s.card, { ...ok, dueDay: null })).rejects.toThrow("fechamento e o de vencimento");
    await expect(updateCardSettings(db, s.userId, s.card, { ...ok, last4: "12a4" })).rejects.toThrow("4 últimos");
    await expect(updateCardSettings(db, s.userId, s.card, { ...ok, payerAccountId: s.card })).rejects.toThrow("pagadora");
    await expect(updateCardSettings(db, s.userId, s.bank, ok)).rejects.toThrow("Cartão não encontrado");
    const other = await newUser(db);
    await expect(updateCardSettings(db, other, s.card, ok)).rejects.toThrow("Cartão não encontrado");
    expect(await getCard(db, other, s.card, NOW)).toBeNull();
  });
});

describe("faturas pelo fechamento", () => {
  it("compra no dia do fechamento vai para a próxima fatura; parcelas caem uma por fatura", async () => {
    const s = await setup();
    await s.buy("2026-11-02", R(100));
    await s.buy("2026-11-03", R(50));
    await s.buy("2026-11-04", R(600), { installments: 3, amountIsTotal: true });
    expect((await s.invoice("2026-11")).total).toBe(R(100));
    expect((await s.invoice("2026-12")).total).toBe(R(50) + R(200));
    expect((await s.invoice("2027-01")).total).toBe(R(200));
    expect((await s.invoice("2027-02")).total).toBe(R(200));
    const [card] = await listCards(db, s.userId, NOW);
    expect(card.toPay?.month).toBe("2026-11");
    expect(card.current?.month).toBe("2026-12");
    expect(card.limit).toMatchObject({ committed: R(750), available: R(3000) - R(750) });
  });

  it("pagamento parcial: o resto vai para a próxima e o saldo do banco cai só o que foi pago", async () => {
    const s = await setup();
    await s.buy("2026-10-20", R(1000));
    await payInvoice(db, s.userId, s.card, { amount: R(400), fromAccountId: s.bank, date: "2026-11-04" }, NOW);
    expect(await s.balance(s.bank)).toBe(R(4600));
    // Depois do vencimento (dia 10) o resto passa para a fatura de dezembro.
    const later = new Date("2026-11-12T15:00:00Z");
    const card = (await getCard(db, s.userId, s.card, later))!;
    expect(card.invoices.find((i) => i.month === "2026-11")).toMatchObject({ status: "partial", remaining: R(600) });
    expect(card.invoices.find((i) => i.month === "2026-12")).toMatchObject({ previousBalance: R(600) });
    // Pagar a fatura é transferência: não aparece como saída no resumo do mês.
    expect((await monthSummary(db, s.userId, "2026-11", NOW)).expense).toBe(0);
  });

  it("pagamento total quita e reenvio do mesmo formulário não paga duas vezes", async () => {
    const s = await setup();
    await s.buy("2026-10-20", R(300));
    const key = randomUUID();
    await payInvoice(db, s.userId, s.card, { amount: R(300), fromAccountId: s.bank, submissionKey: key }, NOW);
    await payInvoice(db, s.userId, s.card, { amount: R(300), fromAccountId: s.bank, submissionKey: key }, NOW);
    expect(await s.balance(s.bank)).toBe(R(4700));
    expect((await s.invoice("2026-11")).status).toBe("paid");
  });
});

describe("estorno, encargos e parcelamento da fatura", () => {
  it("estorno abate a fatura e o gasto da categoria, sem virar receita", async () => {
    const s = await setup();
    const mercado = (await listCategoryOptions(db, s.userId)).find((c) => c.name === "Mercado")!;
    await s.buy("2026-11-04", R(200), { categoryId: mercado.id });
    await addRefund(db, s.userId, s.card, { amount: R(50), description: "Estorno mercado", categoryId: mercado.id }, NOW);
    expect((await s.invoice("2026-12")).total).toBe(R(150));
    const summary = await monthSummary(db, s.userId, "2026-11", NOW);
    expect(summary).toMatchObject({ income: 0, expense: R(150) });
    const cat = (await listCategories(db, s.userId, "2026-11", NOW)).find((c) => c.id === mercado.id)!;
    expect(cat.paidTotal).toBe(R(150));
  });

  it("juros, IOF e tarifa entram na fatura e contam como gasto; categoria de estorno precisa ser de saída", async () => {
    const s = await setup();
    await addCharge(db, s.userId, s.card, { kind: "iof", amount: R(6.38), description: "IOF compra internacional" }, NOW);
    await addCharge(db, s.userId, s.card, { kind: "fee", amount: R(30), invoiceMonth: "2026-11" }, NOW);
    expect((await s.invoice("2026-12")).total).toBe(R(6.38));
    expect((await s.invoice("2026-11")).total).toBe(R(30));
    expect((await monthSummary(db, s.userId, "2026-11", NOW)).expense).toBe(R(36.38));
    const salario = (await listCategoryOptions(db, s.userId)).find((c) => c.name === "Salário")!;
    await expect(addRefund(db, s.userId, s.card, { amount: R(1), description: "x", categoryId: salario.id }, NOW)).rejects.toThrow("categoria de saída");
    await expect(addCharge(db, s.userId, s.bank, { kind: "iof", amount: R(1) }, NOW)).rejects.toThrow("Cartão não encontrado");
  });

  it("parcelar a fatura: quita a fechada, cria as parcelas e conta só os juros como gasto novo", async () => {
    const s = await setup();
    await s.buy("2026-10-20", R(1000));
    const key = randomUUID();
    await installInvoice(db, s.userId, s.card, { month: "2026-11", count: 4, installmentAmount: R(275), submissionKey: key }, NOW);
    await installInvoice(db, s.userId, s.card, { month: "2026-11", count: 4, installmentAmount: R(275), submissionKey: key }, NOW);
    const nov = await s.invoice("2026-11");
    expect(nov).toMatchObject({ remaining: 0, status: "installed" });
    expect((await s.invoice("2026-12")).total).toBe(R(275));
    expect((await s.invoice("2027-03")).total).toBe(R(275));
    expect(await s.balance(s.card)).toBe(-R(275));
    const [card] = await listCards(db, s.userId, NOW);
    expect(card.projectedBalance).toBe(-R(1100));
    // Outubro: a compra (1000). Novembro: só os juros (100); crédito e parcelas não contam.
    expect((await monthSummary(db, s.userId, "2026-10", NOW)).expense).toBe(R(1000));
    expect((await monthSummary(db, s.userId, "2026-11", NOW))).toMatchObject({ income: 0, expense: R(100) });
    expect((await monthSummary(db, s.userId, "2026-12", NOW)).expense).toBe(0);
  });

  it("não parcela fatura aberta nem com parcelas que somam menos que o saldo", async () => {
    const s = await setup();
    await s.buy("2026-10-20", R(1000));
    await expect(installInvoice(db, s.userId, s.card, { month: "2026-12", count: 3, installmentAmount: R(400) }, NOW)).rejects.toThrow("fechada");
    await expect(installInvoice(db, s.userId, s.card, { month: "2026-11", count: 3, installmentAmount: R(300) }, NOW)).rejects.toThrow("menos que o saldo");
  });

  it("mover compra para outra fatura; editar estorno mantém a regra", async () => {
    const s = await setup();
    const [id] = await s.buy("2026-11-03", R(80));
    expect((await s.invoice("2026-12")).total).toBe(R(80));
    await moveToInvoice(db, s.userId, id, "2026-11");
    expect((await s.invoice("2026-11")).total).toBe(R(80));
    await moveToInvoice(db, s.userId, id, null);
    expect((await s.invoice("2026-12")).total).toBe(R(80));
    const [bankTx] = await createTransaction(db, s.userId, { type: "expense", description: "x", amount: 1, date: "2026-11-04", paid: true, accountId: s.bank });
    await expect(moveToInvoice(db, s.userId, bankTx, "2026-11")).rejects.toThrow("cartão");

    const mercado = (await listCategoryOptions(db, s.userId)).find((c) => c.name === "Mercado")!;
    const [refund] = await addRefund(db, s.userId, s.card, { amount: R(10), description: "Estorno", categoryId: mercado.id }, NOW);
    await updateTransaction(db, s.userId, refund, { type: "income", description: "Estorno editado", amount: R(12), date: "2026-11-04", paid: true, accountId: s.card, categoryId: mercado.id });
    await expect(
      updateTransaction(db, s.userId, refund, { type: "income", description: "x", amount: R(12), date: "2026-11-04", paid: true, accountId: s.bank, categoryId: mercado.id }),
    ).rejects.toThrow("cartão");
  });
});
