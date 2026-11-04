import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { monthSummary } from "@/data/dashboard";
import { createTransaction, setPaid } from "@/data/transactions";
import { createLoan, deleteLoan, getLoan, listLoans, settleLoan } from "@/data/loans";
import { listBills } from "@/data/bills";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

const R = (reais: number) => Math.round(reais * 100);
const NOW = new Date("2026-11-04T15:00:00Z");

async function setup() {
  const userId = await newUser(db);
  const bank = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(1000) }))!;
  const balance = async (id: string) => (await listAccounts(db, userId, NOW)).find((a) => a.id === id)!.balance;
  return { userId, bank, balance };
}

const base = { name: "Consignado", kind: "borrowed" as const, principal: R(10000), monthlyRate: 2, installments: 12, system: "price" as const, firstDue: "2026-12-10" };

describe("empréstimo que peguei", () => {
  it("liberação entra no banco como transferência; dívida fica na conta do empréstimo; nada vira receita", async () => {
    const s = await setup();
    const id = (await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, disbursementAccountId: s.bank, startDate: "2026-11-04" }, NOW))!;
    const loan = (await getLoan(db, s.userId, id, NOW))!;
    expect(await s.balance(s.bank)).toBe(R(11000));
    expect(loan.balance).toBe(-R(10000));
    expect(loan).toMatchObject({ paidCount: 0, installments: 12, overdueCount: 0 });
    expect(loan.next).toMatchObject({ number: 1, date: "2026-12-10", amount: R(945.6) });
    expect(loan.remainingInstallments).toBe(loan.schedule.totalPaid);
    expect(await monthSummary(db, s.userId, "2026-11", NOW)).toMatchObject({ income: 0, expense: 0 });
  });

  it("pagar a parcela: sai do banco, abate a dívida; só os juros contam como gasto", async () => {
    const s = await setup();
    const id = (await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, firstDue: "2026-11-04", startDate: "2026-10-04" }, NOW))!;
    let loan = (await getLoan(db, s.userId, id, NOW))!;
    expect(loan.balance).toBe(-R(10000) - R(200)); // juros da 1ª parcela já correram (vence hoje)
    await setPaid(db, s.userId, loan.next!.id, true, NOW);
    loan = (await getLoan(db, s.userId, id, NOW))!;
    expect(loan.paidCount).toBe(1);
    expect(await s.balance(s.bank)).toBe(R(1000) - R(945.6));
    expect(loan.balance).toBe(-R(10000) - R(200) + R(945.6));
    expect((await monthSummary(db, s.userId, "2026-11", NOW)).expense).toBe(R(200));
  });

  it("parcelas aparecem na agenda; atrasada vai para 'Atrasadas'", async () => {
    const s = await setup();
    await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, firstDue: "2026-11-01", startDate: "2026-10-01" }, NOW);
    await createTransaction(db, s.userId, { type: "expense", description: "Luz", amount: R(150), date: "2026-11-10", paid: false, accountId: s.bank });
    await createTransaction(db, s.userId, { type: "income", description: "Aluguel recebido", amount: R(900), date: "2026-11-05", paid: false, accountId: s.bank });
    const { groups, next30 } = await listBills(db, s.userId, NOW);
    expect(groups[0]).toMatchObject({ key: "overdue", pay: R(945.6) });
    expect(groups[0].items[0].description).toContain("Parcela 1/12");
    expect(groups.find((g) => g.key === "week")!.items.map((b) => b.description)).toEqual(["Aluguel recebido", "Luz"]);
    expect(next30).toEqual({ pay: R(945.6) + R(150) + R(945.6), receive: R(900) });
  });

  it("quitação antecipada pelo valor do banco: apaga o futuro, zera a dívida e registra a diferença", async () => {
    const s = await setup();
    const id = (await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, disbursementAccountId: s.bank, startDate: "2026-11-04" }, NOW))!;
    const key = randomUUID();
    await settleLoan(db, s.userId, id, { amount: R(10050), submissionKey: key }, NOW);
    await settleLoan(db, s.userId, id, { amount: R(10050), submissionKey: key }, NOW);
    const loan = (await getLoan(db, s.userId, id, NOW))!;
    expect(loan.settledAt).toBe("2026-11-04");
    expect(loan.balance).toBe(0);
    expect(loan.next).toBeNull();
    expect(await s.balance(s.bank)).toBe(R(11000) - R(10050));
    // Pagou R$ 50 acima do saldo devedor: encargo da quitação conta como gasto.
    expect((await monthSummary(db, s.userId, "2026-11", NOW)).expense).toBe(R(50));
    await expect(settleLoan(db, s.userId, id, { amount: R(1) }, NOW)).rejects.toThrow("já foi quitado");
  });

  it("desconto na quitação não vira receita", async () => {
    const s = await setup();
    const id = (await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, startDate: "2026-11-04" }, NOW))!;
    await settleLoan(db, s.userId, id, { amount: R(9800) }, NOW);
    expect((await getLoan(db, s.userId, id, NOW))!.balance).toBe(0);
    expect(await monthSummary(db, s.userId, "2026-11", NOW)).toMatchObject({ income: 0, expense: 0 });
  });
});

describe("empréstimo que dei", () => {
  it("dinheiro sai do banco, parcelas a receber e juros como entrada", async () => {
    const s = await setup();
    const id = (await createLoan(db, s.userId, { ...base, kind: "lent", name: "Empréstimo ao João", principal: R(600), installments: 3, monthlyRate: 1, payerAccountId: s.bank, disbursementAccountId: s.bank, firstDue: "2026-11-04", startDate: "2026-10-04" }, NOW))!;
    const loan = (await getLoan(db, s.userId, id, NOW))!;
    expect(await s.balance(s.bank)).toBe(R(400));
    expect(loan.balance).toBe(R(600) + R(6));
    const { groups } = await listBills(db, s.userId, NOW);
    expect(groups.find((g) => g.key === "today")!.items[0]).toMatchObject({ kind: "receive" });
    expect((await monthSummary(db, s.userId, "2026-11", NOW)).income).toBe(R(6));
  });
});

describe("validação e exclusão", () => {
  it("recusa taxa absurda, datas trocadas, conta de outra pessoa e nome repetido", async () => {
    const s = await setup();
    await expect(createLoan(db, s.userId, { ...base, monthlyRate: 45, payerAccountId: s.bank }, NOW)).rejects.toThrow("confira");
    await expect(createLoan(db, s.userId, { ...base, firstDue: "2026-10-01", payerAccountId: s.bank }, NOW)).rejects.toThrow("antes da liberação");
    const other = await setup();
    await expect(createLoan(db, s.userId, { ...base, payerAccountId: other.bank }, NOW)).rejects.toThrow("não encontrada");
    await expect(createLoan(db, s.userId, { ...base, name: "Banco", payerAccountId: s.bank }, NOW)).rejects.toThrow("com esse nome");
    await expect(createAccount(db, s.userId, { name: "X", type: "loan", initialBalance: 0 })).rejects.toThrow("Dívidas");
  });

  it("mesma chave não cria duas vezes; excluir apaga empréstimo, conta e lançamentos", async () => {
    const s = await setup();
    const key = randomUUID();
    const id = (await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, disbursementAccountId: s.bank, submissionKey: key, startDate: "2026-11-04" }, NOW))!;
    expect(await createLoan(db, s.userId, { ...base, payerAccountId: s.bank, submissionKey: key }, NOW)).toBeNull();
    expect(await listLoans(db, s.userId, NOW)).toHaveLength(1);
    await deleteLoan(db, s.userId, id);
    expect(await listLoans(db, s.userId, NOW)).toHaveLength(0);
    expect(await s.balance(s.bank)).toBe(R(1000));
    expect((await listAccounts(db, s.userId, NOW)).some((a) => a.type === "loan")).toBe(false);
  });
});
