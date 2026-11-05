import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount } from "@/data/accounts";
import { createTransaction, deleteTransaction, listTransactions, searchTransactions, updateTransaction } from "@/data/transactions";
import { ensureRecurring, payProjectedNow, projectedRecurring, stopRecurring } from "@/data/recurring";
import { getDashboard } from "@/data/dashboard";
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
const at = (d: string) => new Date(`${d}T15:00:00Z`);

async function setup() {
  const userId = await newUser(db);
  const bank = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(1000) }))!;
  const all = async () => (await searchTransactions(db, userId, { limit: 500 })).items.sort((a, b) => a.date.localeCompare(b.date));
  return { userId, bank, all };
}

const aluguel = (bank: string, extra: object = {}) => ({
  type: "expense" as const, description: "Aluguel", amount: R(1200), date: "2026-11-05", paid: false, accountId: bank, recurring: true, ...extra,
});

describe("todo mês, sem fim", () => {
  it("lança só o mês atual; cada mês que chega ganha um, sem duplicar", async () => {
    const s = await setup();
    const ids = await createTransaction(db, s.userId, aluguel(s.bank));
    expect(ids).toHaveLength(1);
    expect(await ensureRecurring(db, s.userId, at("2026-11-20"))).toBe(0);
    let rows = await s.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recurringId: rows[0].seriesId, paid: false });

    // Pendente total = só o mês atual (os próximos ainda não existem).
    const { next30 } = await listBills(db, s.userId, at("2026-11-01"));
    expect(next30.pay).toBe(R(1200));

    // Pulou dois meses sem abrir o app: lança dezembro e janeiro, pendentes.
    await Promise.all([ensureRecurring(db, s.userId, at("2027-01-02")), ensureRecurring(db, s.userId, at("2027-01-02"))]);
    rows = await s.all();
    expect(rows.map((r) => r.date)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
    expect(rows.every((r) => !r.paid && r.amount === R(1200) && r.recurringId === rows[0].recurringId)).toBe(true);
    expect(await ensureRecurring(db, s.userId, at("2027-01-30"))).toBe(0);
  });

  it("dia 31 vira o último dia em meses curtos e volta a 31", async () => {
    const s = await setup();
    await createTransaction(db, s.userId, aluguel(s.bank, { date: "2027-01-31" }));
    await ensureRecurring(db, s.userId, at("2027-03-10"));
    expect((await s.all()).map((r) => r.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("'só este mês' não volta; 'parar de repetir' apaga este e os próximos e para", async () => {
    const s = await setup();
    await createTransaction(db, s.userId, aluguel(s.bank));
    await ensureRecurring(db, s.userId, at("2027-01-02"));
    let rows = await s.all();
    await deleteTransaction(db, s.userId, rows[1].id, "one");
    await ensureRecurring(db, s.userId, at("2027-01-03"));
    expect((await s.all()).map((r) => r.date)).toEqual(["2026-11-05", "2027-01-05"]);

    rows = await s.all();
    expect(await deleteTransaction(db, s.userId, rows[1].id, "future")).toBe(1);
    await ensureRecurring(db, s.userId, at("2027-06-01"));
    expect((await s.all()).map((r) => r.date)).toEqual(["2026-11-05"]);
  });

  it("editar o mês mais recente muda os próximos; editar um antigo muda só ele", async () => {
    const s = await setup();
    await createTransaction(db, s.userId, aluguel(s.bank));
    await ensureRecurring(db, s.userId, at("2026-12-01"));
    let rows = await s.all();
    const edit = (t: (typeof rows)[number], amount: number) =>
      updateTransaction(db, s.userId, t.id, { type: t.type, description: t.description, amount, date: t.date, paid: t.paid, accountId: t.accountId, categoryId: t.categoryId });
    await edit(rows[0], R(1100)); // antigo
    await edit(rows[1], R(1300)); // mais recente
    await ensureRecurring(db, s.userId, at("2027-01-01"));
    rows = await s.all();
    expect(rows.map((r) => r.amount)).toEqual([R(1100), R(1300), R(1300)]);
  });

  it("no cartão o mês já entra na fatura (pago); mesma chave não cria duas regras", async () => {
    const s = await setup();
    const card = (await createAccount(db, s.userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
    const key = randomUUID();
    const input = { ...aluguel(card), description: "Streaming", amount: R(40), paid: true, submissionKey: key };
    await createTransaction(db, s.userId, input);
    expect(await createTransaction(db, s.userId, input)).toEqual([]);
    await ensureRecurring(db, s.userId, at("2026-12-10"));
    const dez = await listTransactions(db, s.userId, { month: "2026-12" });
    expect(dez).toHaveLength(1);
    expect(dez[0]).toMatchObject({ paid: true, description: "Streaming" });
    const { rows } = await db.query("SELECT count(*)::int AS n FROM recurring_rules WHERE user_id = $1", [s.userId]);
    expect(rows[0].n).toBe(1);
  });

  it("recusa recorrente junto com parcelas ou repetir N", async () => {
    const s = await setup();
    await expect(createTransaction(db, s.userId, aluguel(s.bank, { installments: 3 }))).rejects.toThrow("só uma forma");
    await expect(createTransaction(db, s.userId, aluguel(s.bank, { repeat: 3 }))).rejects.toThrow("só uma forma");
  });

  it("meses futuros aparecem como previstos (um por mês); pagar adiantado não lança de novo", async () => {
    const s = await setup();
    await createTransaction(db, s.userId, aluguel(s.bank));
    const NOW = at("2026-11-04");
    expect(await projectedRecurring(db, s.userId, "2026-11")).toEqual([]);
    const dez = await projectedRecurring(db, s.userId, "2026-12");
    expect(dez).toHaveLength(1);
    expect(dez[0]).toMatchObject({ description: "Aluguel", date: "2026-12-05", amount: R(1200), paid: false });
    expect(await projectedRecurring(db, s.userId, "2027-03", { type: "income" })).toEqual([]);
    expect(await projectedRecurring(db, s.userId, "2027-03", { search: "alug" })).toHaveLength(1);
    expect((await getDashboard(db, s.userId, "2026-12", NOW)).month.pendingExpense).toBe(R(1200));

    const ruleId = dez[0].projected!.ruleId;
    await payProjectedNow(db, s.userId, ruleId, "2026-12", NOW);
    await expect(payProjectedNow(db, s.userId, ruleId, "2026-12", NOW)).rejects.toThrow("já foi lançado");
    await expect(payProjectedNow(db, s.userId, ruleId, "2026-11", NOW)).rejects.toThrow("pague pela lista");
    expect(await projectedRecurring(db, s.userId, "2026-12")).toEqual([]);
    let rows = await s.all();
    expect(rows.map((r) => [r.date, r.paid])).toEqual([["2026-11-04", true], ["2026-11-05", false]]);

    await ensureRecurring(db, s.userId, at("2027-01-10"));
    rows = await s.all();
    expect(rows.map((r) => r.date)).toEqual(["2026-11-04", "2026-11-05", "2027-01-05"]); // dezembro não volta

    const agenda = await listBills(db, s.userId, at("2027-01-10"));
    const previstos = agenda.groups.flatMap((g) => g.items).filter((b) => b.projected);
    expect(previstos.map((b) => b.date)).toEqual(["2027-02-05", "2027-03-05", "2027-04-05"]);
    await stopRecurring(db, s.userId, ruleId);
    expect(await projectedRecurring(db, s.userId, "2027-02")).toEqual([]);
  });
});
