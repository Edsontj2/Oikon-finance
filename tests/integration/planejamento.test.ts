import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount } from "@/data/accounts";
import { createCategory, listCategories, listCategoryOptions, updateCategory } from "@/data/categories";
import { createTransaction } from "@/data/transactions";
import { updateCardSettings } from "@/data/cards";
import { balanceForecast } from "@/data/forecast";
import { monthBudget } from "@/data/budget";
import { averageMonthlyExpense, createGoal, deleteGoal, listGoals, moveGoalSaved, updateGoal } from "@/data/goals";
import { getOverview, netWorthHistory } from "@/data/overview";
import { getDashboard } from "@/data/dashboard";
import { createLoan } from "@/data/loans";
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
  const bank = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(5000) }))!;
  const tx = (input: Record<string, unknown>) =>
    createTransaction(db, userId, { type: "expense", description: "x", amount: R(1), date: "2026-11-04", paid: true, accountId: bank, ...input } as never);
  return { userId, bank, tx };
}

describe("previsão de saldo", () => {
  it("soma pendentes, meses futuros dos recorrentes e faturas no vencimento, sem contar compra no cartão duas vezes", async () => {
    const s = await setup();
    const card = (await createAccount(db, s.userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
    await updateCardSettings(db, s.userId, card, { creditLimit: R(3000), closingDay: 3, dueDay: 10, payerAccountId: s.bank, brand: null, last4: null });
    await s.tx({ description: "TV", amount: R(300), date: "2026-11-05", accountId: card });
    await s.tx({ description: "Luz", amount: R(150), date: "2026-11-20", paid: false });
    await s.tx({ type: "income", description: "Salário", amount: R(2000), date: "2026-11-05", paid: false, recurring: true });
    await s.tx({ description: "Streaming", amount: R(40), date: "2026-11-04", accountId: card, recurring: true });

    const f = await balanceForecast(db, s.userId, NOW);
    expect(f.start).toBe(R(5000));
    const at = (days: number) => f.points.find((p) => p.days === days)!.balance;
    expect(at(7)).toBe(R(7000));
    expect(at(30)).toBe(R(6850));
    expect(at(60)).toBe(R(8510)); // + salário de dezembro − fatura de dezembro (300 + 40)
    expect(at(90)).toBe(R(10470)); // + salário de janeiro − streaming de dezembro (fatura de janeiro)
    expect(f.firstNegative).toBeNull();
  });

  it("pagamento de fatura já agendado não é descontado de novo e atrasado entra hoje", async () => {
    const s = await setup();
    const card = (await createAccount(db, s.userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
    await updateCardSettings(db, s.userId, card, { creditLimit: R(3000), closingDay: 3, dueDay: 10, payerAccountId: s.bank, brand: null, last4: null });
    await s.tx({ description: "Compra", amount: R(500), date: "2026-10-20", accountId: card }); // fatura de novembro (vence 10/11)
    await s.tx({ type: "transfer", description: "Pagamento", amount: R(200), date: "2026-11-10", paid: false, toAccountId: card });
    await s.tx({ description: "Água", amount: R(80), date: "2026-10-25", paid: false });
    const f = await balanceForecast(db, s.userId, NOW);
    expect(f.daily[0].balance).toBe(R(5000 - 80));
    expect(f.points[0].balance).toBe(R(5000 - 80 - 500));
    expect(f.overdue.outflow).toBe(R(80));
  });
});

describe("orçamento do mês", () => {
  it("planejado × realizado com subcategoria, alerta de 80% e recorrente previsto no mês seguinte", async () => {
    const s = await setup();
    const food = (await createCategory(db, s.userId, { name: "Comida", kind: "expense", monthlyLimit: R(500) }))!;
    const rest = (await createCategory(db, s.userId, { name: "Restaurante", kind: "expense", monthlyLimit: null, parentId: food }))!;
    const home = (await createCategory(db, s.userId, { name: "Casa própria", kind: "expense", monthlyLimit: null }))!;
    await s.tx({ description: "Feira", amount: R(100), categoryId: food });
    await s.tx({ description: "Jantar", amount: R(350), categoryId: rest });
    await s.tx({ description: "Aluguel", amount: R(1200), date: "2026-11-05", paid: false, categoryId: home, recurring: true });
    await s.tx({ type: "income", description: "Salário", amount: R(3000), date: "2026-11-05", paid: false, recurring: true });

    const nov = await monthBudget(db, s.userId, "2026-11", NOW);
    const foodLine = nov.lines.find((l) => l.id === food)!;
    expect(foodLine).toMatchObject({ total: R(450), limit: R(500), status: "warn", percent: 90 });
    expect(foodLine.children.map((c) => [c.name, c.total])).toEqual([["Restaurante", R(350)]]);
    expect(nov).toMatchObject({ planned: R(500), plannedSpent: R(450) });
    expect(nov.alerts).toEqual([{ name: "Comida", status: "warn", percent: 90 }]);
    expect(nov.expense.total).toBe(R(1650));

    const dez = await monthBudget(db, s.userId, "2026-12", NOW);
    expect(dez.lines.find((l) => l.id === home)).toMatchObject({ paid: 0, pending: R(1200) });
    expect(dez.income).toEqual({ received: 0, expected: R(3000) });
    expect(dez.expense.total).toBe(R(1200));
  });

  it("subcategoria: mesmo tipo, um nível só, e a principal soma as filhas no painel", async () => {
    const s = await setup();
    const food = (await createCategory(db, s.userId, { name: "Comida", kind: "expense", monthlyLimit: null }))!;
    const rest = (await createCategory(db, s.userId, { name: "Restaurante", kind: "expense", monthlyLimit: null, parentId: food }))!;
    const salary = (await createCategory(db, s.userId, { name: "Pró-labore", kind: "income", monthlyLimit: null }))!;
    await expect(createCategory(db, s.userId, { name: "Bar", kind: "expense", monthlyLimit: null, parentId: rest })).rejects.toThrow("subcategoria não pode ter");
    await expect(createCategory(db, s.userId, { name: "Bico", kind: "income", monthlyLimit: null, parentId: food })).rejects.toThrow("mesmo tipo");
    await expect(updateCategory(db, s.userId, food, { name: "Comida", monthlyLimit: null, parentId: salary })).rejects.toThrow();
    await expect(updateCategory(db, s.userId, food, { name: "Comida", monthlyLimit: null, parentId: rest })).rejects.toThrow("subcategoria não pode ter");
    const extra = (await createCategory(db, s.userId, { name: "Extras", kind: "expense", monthlyLimit: null }))!;
    await expect(updateCategory(db, s.userId, food, { name: "Comida", monthlyLimit: null, parentId: extra })).rejects.toThrow("tem subcategorias");
    await expect(updateCategory(db, s.userId, food, { name: "Comida", monthlyLimit: null, parentId: food })).rejects.toThrow("dentro dela mesma");
    // Editar sem informar a principal mantém a que já tinha.
    await updateCategory(db, s.userId, rest, { name: "Restaurantes", monthlyLimit: R(200) });
    expect((await listCategoryOptions(db, s.userId)).find((c) => c.id === rest)).toMatchObject({ name: "Restaurantes", parentId: food });
    await s.tx({ description: "Pizza", amount: R(70), categoryId: rest });
    const d = await getDashboard(db, s.userId, "2026-11", NOW);
    expect(d.expenseCategories.map((c) => [c.name, c.paidTotal])).toEqual([["Comida", R(70)]]);
    expect((await listCategories(db, s.userId, "2026-11", NOW)).find((c) => c.id === rest)!.paidTotal).toBe(R(70));
  });
});

describe("metas", () => {
  it("reserva de emergência pela média de gastos, meta manual com guardar/retirar e meta ligada a uma conta", async () => {
    const s = await setup();
    await s.tx({ amount: R(2000), date: "2026-09-10" });
    await s.tx({ amount: R(4000), date: "2026-10-10" });
    expect(await averageMonthlyExpense(db, s.userId, NOW)).toBe(R(3000)); // agosto não conta: não havia lançamentos

    const reserve = (await createGoal(db, s.userId, { name: "Reserva", kind: "emergency", target: R(18000), months: 6 }))!;
    await expect(createGoal(db, s.userId, { name: "Outra", kind: "emergency", target: R(1), months: 3 })).rejects.toThrow("já tem uma reserva");
    await expect(createGoal(db, s.userId, { name: "reserva", kind: "goal", target: R(1) })).rejects.toThrow("com esse nome");

    const trip = (await createGoal(db, s.userId, { name: "Viagem", kind: "goal", target: R(6000), targetDate: "2027-10-31" }))!;
    await moveGoalSaved(db, s.userId, trip, R(1500));
    await expect(moveGoalSaved(db, s.userId, trip, -R(2000))).rejects.toThrow("mais do que está guardado");
    await moveGoalSaved(db, s.userId, trip, -R(500));

    const savings = (await createAccount(db, s.userId, { name: "Poupança", type: "savings", initialBalance: R(4500) }))!;
    await updateGoal(db, s.userId, reserve, { name: "Reserva", kind: "emergency", target: R(18000), months: 6, accountId: savings });
    await expect(moveGoalSaved(db, s.userId, reserve, R(10))).rejects.toThrow("saldo da conta");
    const card = (await createAccount(db, s.userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
    await expect(createGoal(db, s.userId, { name: "X", kind: "goal", target: R(1), accountId: card })).rejects.toThrow("onde o dinheiro fica guardado");

    const goals = await listGoals(db, s.userId, NOW);
    expect(goals.map((g) => g.name)).toEqual(["Reserva", "Viagem"]);
    expect(goals[0].progress).toMatchObject({ saved: R(4500), percent: 25, status: "no_date" });
    expect(goals[1].progress).toMatchObject({ saved: R(1000), remaining: R(5000), monthsLeft: 12, monthlyNeeded: Math.ceil(R(5000) / 12) });

    const other = await setup();
    await expect(deleteGoal(db, other.userId, trip)).rejects.toThrow("não encontrada");
    await deleteGoal(db, s.userId, trip);
    expect(await listGoals(db, s.userId, NOW)).toHaveLength(1);
  });
});

describe("panorama do painel", () => {
  it("patrimônio mês a mês, dívidas, cartões e renda comprometida", async () => {
    const s = await setup();
    await s.tx({ type: "income", amount: R(4000), date: "2026-09-05" });
    await s.tx({ amount: R(1000), date: "2026-10-05" });
    await s.tx({ type: "income", amount: R(4000), date: "2026-10-05" });
    await s.tx({ description: "Academia", amount: R(100), date: "2026-11-04", recurring: true });
    await createLoan(db, s.userId, { name: "Consignado", kind: "borrowed", principal: R(10000), monthlyRate: 2, installments: 12, system: "price", firstDue: "2026-12-10", payerAccountId: s.bank, disbursementAccountId: s.bank, startDate: "2026-11-04" }, NOW);

    const history = await netWorthHistory(db, s.userId, NOW, 3);
    expect(history.map((h) => [h.month, h.net])).toEqual([
      ["2026-09", R(9000)],
      ["2026-10", R(12000)],
      ["2026-11", R(11900)], // − academia; o empréstimo entra no dinheiro e na dívida (empata)
    ]);
    expect(history[2]).toMatchObject({ assets: R(21900), debts: -R(10000) });

    const o = await getOverview(db, s.userId, NOW);
    expect(o).toMatchObject({ available: R(21900), netWorth: R(11900), debts: { count: 1, owed: R(10000), lentReceivable: 0 } });
    expect(o.commitment).toEqual({ monthly: R(945.6) + R(100), averageIncome: R(4000), percent: 26 });
  });
});
