import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { getDashboard } from "@/data/dashboard";
import { createTransaction, deleteTransaction, searchTransactions, type NewTransaction } from "@/data/transactions";
import { UserError } from "@/data/errors";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

const R = (reais: number) => Math.round(reais * 100);
const HOJE = new Date("2026-10-28T15:00:00Z");

async function setup() {
  const userId = await newUser(db);
  const banco = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(5000) }))!;
  const cartao = (await createAccount(db, userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
  const tx = (data: Partial<NewTransaction>) =>
    createTransaction(db, userId, { type: "expense", description: "Celular", amount: R(1200), date: "2026-10-28", paid: true, accountId: banco, ...data });
  const saldo = async (id: string) => (await listAccounts(db, userId, HOJE)).find((a) => a.id === id)!;
  return { userId, banco, cartao, tx, saldo };
}

describe("compras parceladas", () => {
  it("no cartão: 10x do total, cada parcela entra na fatura no mês dela; termina em jul/2027", async () => {
    const { userId, cartao, tx, saldo } = await setup();
    const ids = await tx({ accountId: cartao, installments: 10, amountIsTotal: true, amount: R(1200.05), paid: false });
    expect(ids).toHaveLength(10);
    const { items } = await searchTransactions(db, userId, { accountId: cartao });
    const sorted = items.sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted.map((t) => [t.installmentNumber, t.installmentCount, t.date, t.amount, t.paid])).toEqual(
      sorted.map((_, i) => [i + 1, 10, `${["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07"][i]}-28`, i === 0 ? R(120.05) : R(120), true]),
    );
    // Hoje só a 1ª entrou; no fim, a fatura soma o total exato.
    expect(await saldo(cartao)).toMatchObject({ balance: -R(120.05), projectedBalance: -R(1200.05) });
  });

  it("na conta corrente: valor por parcela, 1ª paga e as outras pendentes", async () => {
    const { userId, banco, tx, saldo } = await setup();
    await tx({ installments: 3, amountIsTotal: false, amount: R(100), description: "Curso" });
    const { items } = await searchTransactions(db, userId, { accountId: banco });
    expect(items.map((t) => t.paid).sort()).toEqual([false, false, true]);
    expect(await saldo(banco)).toMatchObject({ balance: R(4900), projectedBalance: R(4700) });
  });

  it("painel mostra quanto falta, a próxima parcela e quando termina; quitar some da lista", async () => {
    const { userId, cartao, tx } = await setup();
    const ids = await tx({ accountId: cartao, installments: 4, amountIsTotal: true, amount: R(400), description: "Tênis" });
    let d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.installments).toEqual([
      expect.objectContaining({ description: "Tênis", count: 4, settledCount: 1, nextAmount: R(100), remaining: R(300), nextDate: "2026-11-28", lastDate: "2027-01-28" }),
    ]);
    // Em janeiro aparece o aviso de última parcela.
    const jan = await getDashboard(db, userId, "2027-01", HOJE);
    expect(jan.insights.map((i) => i.title)).toContain("Última parcela de Tênis em janeiro");
    // Cancelar o resto ("este e os próximos" a partir da 2ª).
    await deleteTransaction(db, userId, ids[1], "future");
    d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.installments).toEqual([]);
  });

  it("recusa parcelar transferência, parcelas fora de 2..60 e total pequeno demais", async () => {
    const { banco, cartao, tx } = await setup();
    await expect(tx({ type: "transfer", toAccountId: cartao, accountId: banco, installments: 3 })).rejects.toThrow("Transferência não pode ser parcelada.");
    await expect(tx({ installments: 1 })).rejects.toThrow("Parcelas devem ser entre 2 e 60.");
    await expect(tx({ installments: 61 })).rejects.toThrow(UserError);
    await expect(tx({ installments: Number.NaN })).rejects.toThrow(UserError);
    await expect(tx({ installments: 5, amountIsTotal: true, amount: 3 })).rejects.toThrow("pequeno demais");
  });

  it("fluxo de 6 meses soma entradas e saídas por mês, sem transferências", async () => {
    const { userId, banco, cartao, tx } = await setup();
    await tx({ type: "income", description: "Salário", amount: R(3000), date: "2026-09-05" });
    await tx({ amount: R(200), date: "2026-09-10" });
    await tx({ type: "transfer", toAccountId: cartao, accountId: banco, amount: R(999), date: "2026-09-12" });
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.flow.map((f) => f.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(d.flow[4]).toEqual({ month: "2026-09", income: R(3000), expense: R(200) });
  });
});
