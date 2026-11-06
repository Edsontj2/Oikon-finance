import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount } from "@/data/accounts";
import { createTransaction } from "@/data/transactions";
import {
  compareMonthlyExpenses, getAccountBalances, getDailySpendingAllowance, getExpensesByCategory, getFinancialSummary, getMonthlyExpenses,
  getMonthlyIncome, getTransactions, planSavings, simulateInstallmentPurchase, spendingBaseline,
} from "@/data/analysis";
import { runTool, TOOLS } from "@/ai/tools";
import { ALL_FEATURES, PLAN_FEATURES } from "@/domain/plans";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

const R = (v: number) => Math.round(v * 100);
const NOW = new Date("2026-11-15T15:00:00Z");

async function setup() {
  const userId = await newUser(db);
  const bank = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(2000) }))!;
  const { rows } = await db.query("SELECT id, name FROM categories WHERE user_id = $1", [userId]);
  const cat = (name: string) => rows.find((r) => r.name === name)?.id ?? null;
  const add = (input: Record<string, unknown>) =>
    createTransaction(db, userId, { paid: true, accountId: bank, ...input } as never);
  for (const m of ["2026-08", "2026-09", "2026-10"]) {
    await add({ type: "income", description: "Salário", amount: R(5000), date: `${m}-05` });
    await add({ type: "expense", description: "Mercado", amount: R(1000), date: `${m}-10`, categoryId: cat("Mercado") });
    await add({ type: "expense", description: "Aluguel", amount: R(2000), date: `${m}-08` });
  }
  await add({ type: "income", description: "Salário", amount: R(5000), date: "2026-11-05" });
  await add({ type: "expense", description: "Mercado", amount: R(1300), date: "2026-11-10", categoryId: cat("Mercado") });
  await add({ type: "expense", description: "Internet", amount: R(120), date: "2026-11-20", paid: false });
  await add({ type: "income", description: "Salário", amount: R(5000), date: "2026-12-05", paid: false });
  // Compra parcelada antiga: 4 x R$ 300 a partir de outubro.
  await add({ type: "expense", description: "Geladeira", amount: R(300), date: "2026-10-12", installments: 4, paid: false });
  return { userId, bank };
}

describe("motor de análise com dados reais do usuário", () => {
  it("resumo, entradas, saídas e categorias batem com os lançamentos", async () => {
    const s = await setup();
    expect(await getMonthlyIncome(db, s.userId, "2026-11", NOW)).toMatchObject({ received: R(5000), expected: 0 });
    const exp = await getMonthlyExpenses(db, s.userId, "2026-11", NOW);
    expect(exp.paid).toBe(R(1300));
    expect(exp.toPay).toBe(R(120) + R(300)); // internet + parcela de novembro
    const cats = await getExpensesByCategory(db, s.userId, "2026-11", NOW);
    expect(cats.categories[0]).toMatchObject({ name: "Mercado", total: R(1300), average3Months: R(1000) });
    const sum = await getFinancialSummary(db, s.userId, NOW);
    expect(sum.month).toBe("2026-11");
    expect(sum.available).toBe((await getAccountBalances(db, s.userId, NOW)).availableInAccounts);
    const cmp = await compareMonthlyExpenses(db, s.userId, undefined, undefined, NOW);
    expect(cmp).toMatchObject({ monthA: "2026-10", monthB: "2026-11" });
    expect(cmp.categories.find((c) => c.name === "Mercado")).toMatchObject({ a: R(1000), b: R(1300), diff: R(300), percent: 30 });
    expect((await getTransactions(db, s.userId, { search: "mercado" }, NOW)).totalCount).toBe(4);
  });

  it("média sem parcelas e simulação de compra considerando parcelas existentes", async () => {
    const s = await setup();
    const base = await spendingBaseline(db, s.userId, NOW);
    expect(base).toMatchObject({ monthsUsed: 3, averageIncome: R(5000), averageExpenseNoInstallments: R(3000) });
    // Celular de R$ 2.000 em 10x: R$ 200/mês; folga 5000 − 3000 − 200 = 1800 (dez e jan têm geladeira).
    const sim = await simulateInstallmentPurchase(db, s.userId, { total: R(2000), installments: 10 }, NOW);
    expect(sim.verdict).toBe("fits");
    expect(sim.months[0]).toMatchObject({ month: "2026-12", installment: R(200), existingInstallments: R(300), free: R(1500) });
    expect(sim.months[2]).toMatchObject({ month: "2027-02", existingInstallments: 0, free: R(1800) });
    expect(sim.maxInstallment).toBe(R(1200)); // 5000 − 3000 − 300 − 500 de margem
    expect(sim.disclaimer).toContain("não uma garantia");
    const big = await simulateInstallmentPurchase(db, s.userId, { total: R(30000), installments: 10 }, NOW);
    expect(big.verdict).toBe("does_not_fit");
    await expect(simulateInstallmentPurchase(db, s.userId, { total: -1, installments: 2 }, NOW)).rejects.toThrow("inválido");
  });

  it("gasto por dia até o próximo salário e plano para juntar R$ 5.000", async () => {
    const s = await setup();
    const d = await getDailySpendingAllowance(db, s.userId, NOW);
    expect(d.nextIncome?.date).toBe("2026-12-05");
    expect(d.days).toBe(20);
    expect(d.dueBefore).toBe(R(120) + R(300) + R(300)); // inclui a parcela atrasada
    expect(d.perDay).toBe(Math.trunc((d.available - d.dueBefore) / 20));
    const p = await planSavings(db, s.userId, { target: R(5000), months: 10 }, NOW);
    expect(p).toMatchObject({ monthlyNeeded: R(500), averageSurplus: R(1700), monthsAtCurrentPace: 3 });
  });

  it("sem histórico: informa a limitação em vez de inventar", async () => {
    const userId = await newUser(db);
    await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: 0 });
    const sim = await simulateInstallmentPurchase(db, userId, { total: R(2000), installments: 10 }, NOW);
    expect(sim.verdict).toBe("insufficient_data");
    expect(sim.limitations.join(" ")).toContain("histórico");
  });
});

describe("ferramentas da IA", () => {
  it("cada pessoa só vê os próprios dados (o usuário vem do contexto, nunca do modelo)", async () => {
    const a = await setup();
    const b = await newUser(db);
    const res = await runTool({ db, userId: b, now: NOW, features: ALL_FEATURES }, "getTransactions", { search: "Salário" });
    expect(res).toEqual({ ok: true, result: { totalCount: 0, shown: 0, items: [] } });
    const own = await runTool({ db, userId: a.userId, now: NOW, features: ALL_FEATURES }, "getAccountBalances", {});
    expect(own.ok && JSON.stringify(own.result)).toContain("R$");
    // Tentar passar outro usuário como argumento é recusado.
    expect(await runTool({ db, userId: b, now: NOW, features: ALL_FEATURES }, "getAccountBalances", { userId: a.userId })).toEqual({ ok: false, error: "Argumento não aceito." });
  });

  it("valida argumentos, respeita o plano e não grava nada", async () => {
    const s = await setup();
    const ctx = { db, userId: s.userId, now: NOW, features: PLAN_FEATURES.inteligente };
    expect(await runTool(ctx, "simulateInstallmentPurchase", { total: 2000, installments: 10 })).toEqual({ ok: false, error: "Este recurso não está incluído no plano da pessoa." });
    const premium = { ...ctx, features: PLAN_FEATURES.premium };
    expect(await runTool(premium, "simulateInstallmentPurchase", { total: 2000.123, installments: 10 })).toMatchObject({ ok: false });
    expect(await runTool(premium, "getMonthlyExpenses", { month: "nov" })).toMatchObject({ ok: false, error: "month: use AAAA-MM." });
    expect(await runTool(premium, "apagarTudo", {})).toEqual({ ok: false, error: "Ferramenta desconhecida." });
    const ok = await runTool(premium, "simulateInstallmentPurchase", { total: 2000, installments: 10 });
    expect(ok.ok && (ok.result as { installment: string }).installment).toMatch(/^R\$\s200,00$/);
    const before = (await db.query("SELECT count(*)::int AS n FROM transactions WHERE user_id = $1", [s.userId])).rows[0].n;
    for (const t of TOOLS) await runTool(premium, t.name, t.name === "planSavings" ? { target: 100 } : t.name === "simulateInstallmentPurchase" ? { total: 100, installments: 2 } : {});
    expect((await db.query("SELECT count(*)::int AS n FROM transactions WHERE user_id = $1", [s.userId])).rows[0].n).toBe(before);
    expect(TOOLS.every((t) => t.parameters.additionalProperties === false)).toBe(true);
  });
});
