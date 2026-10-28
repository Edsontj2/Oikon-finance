import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { createCategory, listCategories } from "@/data/categories";
import { getDashboard, monthSummary } from "@/data/dashboard";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  searchTransactions,
  setPaid,
  updateTransaction,
  type NewTransaction,
  type TransactionInput,
} from "@/data/transactions";
import { UserError } from "@/data/errors";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.end();
});

const R = (reais: number) => Math.round(reais * 100);
/** 27/10/2026 12h em São Paulo. */
const HOJE = new Date("2026-10-27T15:00:00Z");

async function saldos(userId: string, now = HOJE) {
  const contas = await listAccounts(db, userId, now);
  const by = Object.fromEntries(contas.map((c) => [c.name, { atual: c.balance, previsto: c.projectedBalance }]));
  return by as Record<string, { atual: number; previsto: number }>;
}

async function cenario() {
  const userId = await newUser(db);
  const banco = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(1000) }))!;
  const poup = (await createAccount(db, userId, { name: "Poupança", type: "savings", initialBalance: 0 }))!;
  const cartao = (await createAccount(db, userId, { name: "Cartão", type: "credit_card", initialBalance: 0 }))!;
  const tx = async (data: Partial<NewTransaction> & Pick<NewTransaction, "type" | "amount">) =>
    (await createTransaction(db, userId, { description: "x", date: "2026-10-10", paid: true, accountId: banco, ...data }))[0];
  return { userId, banco, poup, cartao, tx };
}

async function getTx(userId: string, id: string) {
  const all = (await searchTransactions(db, userId, { limit: 500 })).items;
  return all.find((t) => t.id === id);
}

function inputOf(t: NonNullable<Awaited<ReturnType<typeof getTx>>>): TransactionInput {
  return {
    type: t.type, description: t.description, amount: t.amount, date: t.date, paid: t.paid,
    accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId,
  };
}

describe("banca2 · todas as combinações num mesmo usuário", () => {
  it("entrada, saída, pendente, pago no futuro, transferência e cartão: saldo atual, previsto, painel e resumo", async () => {
    const { userId, banco, poup, cartao, tx } = await cenario();
    await tx({ type: "income", amount: R(500) });
    await tx({ type: "expense", amount: R(200) });
    await tx({ type: "expense", amount: R(50), paid: false });
    await tx({ type: "income", amount: R(300), date: "2026-11-05" }); // pago, mas no futuro
    await tx({ type: "transfer", amount: R(100), toAccountId: poup });
    await tx({ type: "expense", amount: R(80), accountId: cartao });
    await tx({ type: "transfer", amount: R(80), toAccountId: cartao, paid: false, date: "2026-11-10" });

    const s = await saldos(userId);
    expect(s.Banco).toEqual({ atual: R(1200), previsto: R(1370) });
    expect(s["Poupança"]).toEqual({ atual: R(100), previsto: R(100) });
    expect(s["Cartão"]).toEqual({ atual: R(-80), previsto: 0 });

    const d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.totalBalance).toBe(R(1220));
    expect(d.month).toEqual({ income: R(500), expense: R(280), pendingIncome: 0, pendingExpense: R(50) });
    // Marcado como recebido mas com data futura: até o dia chegar, conta como "a receber" (igual ao saldo).
    expect(await monthSummary(db, userId, "2026-11", HOJE)).toEqual({ income: 0, expense: 0, pendingIncome: R(300), pendingExpense: 0 });
    // cartão negativo não é alerta de "no negativo"
    expect(d.insights.some((i) => i.title.includes("Cartão"))).toBe(false);
    // previsão = 1220 - 50 pendente
    expect(d.insights.find((i) => i.title.startsWith("Previsão"))?.title).toContain("1.170,00");
  });

  it("previsão do fim do mês inclui saída JÁ PAGA com data futura dentro do mês", async () => {
    const { userId, tx } = await cenario();
    await tx({ type: "expense", amount: R(10), paid: false, date: "2026-10-28" }); // gatilho da previsão
    await tx({ type: "expense", amount: R(400), paid: true, date: "2026-10-30" }); // débito agendado
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    // saldo hoje = 1000 (a de 30/10 ainda não aconteceu); fim do mês = 1000 - 10 - 400 = 590
    expect(d.totalBalance).toBe(R(1000));
    const previsao = d.insights.find((i) => i.title.includes("Previsão"));
    expect(previsao?.title).toContain("590,00");
  });

  it("previsão é coerente com o 'com pendentes' das contas quando tudo é do mês", async () => {
    const { userId, tx } = await cenario();
    await tx({ type: "income", amount: R(30), paid: false, date: "2026-10-29" });
    await tx({ type: "expense", amount: R(70), paid: false, date: "2026-10-31" });
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    const projetado = d.accounts.reduce((s, a) => s + a.projectedBalance, 0);
    expect(projetado).toBe(R(960));
    expect(d.insights.find((i) => i.title.includes("Previsão"))?.title).toContain("960,00");
  });
});

describe("banca2 · repetir 60 meses", () => {
  it("60 parcelas a partir de 31/10, último dia em meses curtos, só a 1ª paga", async () => {
    const { userId, banco, tx } = await cenario();
    await createTransaction(db, userId, {
      type: "expense", description: "aluguel", amount: R(100), date: "2026-10-31", paid: true, accountId: banco, repeat: 60,
    });
    const all = (await searchTransactions(db, userId, { search: "aluguel", limit: 500 })).items;
    expect(all).toHaveLength(60);
    const dates = all.map((t) => t.date).sort();
    expect(dates[0]).toBe("2026-10-31");
    expect(dates).toContain("2027-02-28");
    expect(dates).toContain("2028-02-29");
    expect(dates).toContain("2026-11-30");
    expect(dates[59]).toBe("2031-09-30");
    expect(new Set(dates.map((d) => d.slice(0, 7))).size).toBe(60);
    expect(all.filter((t) => t.paid)).toHaveLength(1);
    const s = await saldos(userId);
    // 31/10 é depois de "hoje" (27/10): mesmo paga, ainda não mexe no saldo atual
    expect(s.Banco).toEqual({ atual: R(1000), previsto: R(1000 - 6000) });
    void tx;
  });

  it("repetir 61 é recusado e nada é lançado", async () => {
    const { userId, banco } = await cenario();
    await expect(
      createTransaction(db, userId, { type: "expense", description: "x", amount: 1, date: "2026-10-01", paid: true, accountId: banco, repeat: 61 }),
    ).rejects.toBeInstanceOf(UserError);
    expect((await searchTransactions(db, userId, {})).total).toBe(0);
  });
});

describe("banca2 · editar lançamento já pago", () => {
  it("mudar valor, conta e tipo refaz os saldos sem sobras", async () => {
    const { userId, banco, poup, cartao, tx } = await cenario();
    const id = await tx({ type: "expense", amount: R(100) });
    let t = (await getTx(userId, id))!;

    await updateTransaction(db, userId, id, { ...inputOf(t), amount: R(250) });
    expect((await saldos(userId)).Banco.atual).toBe(R(750));

    t = (await getTx(userId, id))!;
    await updateTransaction(db, userId, id, { ...inputOf(t), accountId: poup });
    let s = await saldos(userId);
    expect(s.Banco.atual).toBe(R(1000));
    expect(s["Poupança"].atual).toBe(R(-250));

    t = (await getTx(userId, id))!;
    await updateTransaction(db, userId, id, { ...inputOf(t), type: "income", categoryId: null });
    s = await saldos(userId);
    expect(s["Poupança"].atual).toBe(R(250));

    t = (await getTx(userId, id))!;
    await updateTransaction(db, userId, id, { ...inputOf(t), type: "transfer", accountId: banco, toAccountId: cartao });
    s = await saldos(userId);
    expect(s.Banco.atual).toBe(R(750));
    expect(s["Cartão"].atual).toBe(R(250));
    expect(s["Poupança"].atual).toBe(0);
    expect(await monthSummary(db, userId, "2026-10")).toEqual({ income: 0, expense: 0, pendingIncome: 0, pendingExpense: 0 });

    t = (await getTx(userId, id))!;
    await updateTransaction(db, userId, id, { ...inputOf(t), type: "expense", toAccountId: cartao });
    t = (await getTx(userId, id))!;
    expect(t.toAccountId).toBeNull();
    s = await saldos(userId);
    expect(s.Banco.atual).toBe(R(750));
    expect(s["Cartão"].atual).toBe(0);

    // pago -> pendente e data futura
    await updateTransaction(db, userId, id, { ...inputOf(t), paid: false });
    expect((await saldos(userId)).Banco).toEqual({ atual: R(1000), previsto: R(750) });
    await updateTransaction(db, userId, id, { ...inputOf(t), paid: true, date: "2026-12-01" });
    expect((await saldos(userId)).Banco).toEqual({ atual: R(1000), previsto: R(750) });
    expect((await monthSummary(db, userId, "2026-10")).expense).toBe(0);
    expect(await monthSummary(db, userId, "2026-12", HOJE)).toMatchObject({ expense: 0, pendingExpense: R(250) });
  });

  it("editar uma parcela da série não muda as outras; trocar categoria de saída por categoria de entrada é recusado", async () => {
    const { userId, banco } = await cenario();
    const ids = await createTransaction(db, userId, {
      type: "expense", description: "academia", amount: R(90), date: "2026-10-05", paid: true, accountId: banco, repeat: 3,
    });
    const t = (await getTx(userId, ids[1]))!;
    await updateTransaction(db, userId, ids[1], { ...inputOf(t), amount: R(120) });
    const all = (await searchTransactions(db, userId, { search: "academia" })).items;
    expect(all.map((x) => x.amount).sort()).toEqual([R(120), R(90), R(90)].sort());
    const catEntrada = (await createCategory(db, userId, { name: "Bico", kind: "income", monthlyLimit: null }))!;
    await expect(updateTransaction(db, userId, ids[1], { ...inputOf(t), categoryId: catEntrada })).rejects.toBeInstanceOf(UserError);
  });
});

describe("banca2 · excluir 'este e os próximos'", () => {
  it("apaga a partir da parcela, mantém anteriores (inclusive pagas) e acerta o previsto", async () => {
    const { userId, banco } = await cenario();
    const ids = await createTransaction(db, userId, {
      type: "expense", description: "plano", amount: R(10), date: "2026-08-15", paid: true, accountId: banco, repeat: 12,
    });
    await setPaid(db, userId, ids[1], true);
    const removed = await deleteTransaction(db, userId, ids[2], "future");
    expect(removed).toBe(10);
    const left = (await searchTransactions(db, userId, { search: "plano" })).items.map((t) => t.date).sort();
    expect(left).toEqual(["2026-08-15", "2026-09-15"]);
    expect((await saldos(userId)).Banco).toEqual({ atual: R(980), previsto: R(980) });
  });

  it("outro usuário não consegue apagar a série (nem um, nem os próximos)", async () => {
    const { userId, banco } = await cenario();
    const ids = await createTransaction(db, userId, {
      type: "expense", description: "plano", amount: R(10), date: "2026-08-15", paid: true, accountId: banco, repeat: 5,
    });
    const intruso = await newUser(db);
    expect(await deleteTransaction(db, intruso, ids[0], "future")).toBe(0);
    expect(await deleteTransaction(db, intruso, ids[0], "one")).toBe(0);
    expect((await searchTransactions(db, userId, {})).total).toBe(5);
  });
});

describe("banca2 · isolamento nas ações de escrita", () => {
  it("B não edita, não marca pago e não usa conta/categoria de A", async () => {
    const a = await cenario();
    const b = await cenario();
    const id = await a.tx({ type: "expense", amount: R(100), paid: false });
    const t = (await getTx(a.userId, id))!;
    await expect(updateTransaction(db, b.userId, id, { ...inputOf(t), accountId: b.banco, amount: 1 })).rejects.toBeInstanceOf(UserError);
    await expect(setPaid(db, b.userId, id, true)).rejects.toBeInstanceOf(UserError);
    const t2 = (await getTx(a.userId, id))!;
    expect(t2).toMatchObject({ amount: R(100), paid: false, accountId: a.banco });

    // B tenta mover o próprio lançamento para a conta de A / transferir para a conta de A
    const idB = await b.tx({ type: "expense", amount: R(5) });
    const tb = (await getTx(b.userId, idB))!;
    await expect(updateTransaction(db, b.userId, idB, { ...inputOf(tb), accountId: a.banco })).rejects.toBeInstanceOf(UserError);
    await expect(
      updateTransaction(db, b.userId, idB, { ...inputOf(tb), type: "transfer", toAccountId: a.poup }),
    ).rejects.toBeInstanceOf(UserError);
    const catA = (await listCategories(db, a.userId, "2026-10")).find((c) => c.kind === "expense")!;
    await expect(updateTransaction(db, b.userId, idB, { ...inputOf(tb), categoryId: catA.id })).rejects.toBeInstanceOf(UserError);
    expect((await saldos(a.userId))["Poupança"].atual).toBe(0);
    expect((await saldos(a.userId)).Banco).toEqual({ atual: R(1000), previsto: R(900) });
  });
});

describe("banca2 · virada de ano no fuso de São Paulo", () => {
  it("31/12 23h em SP (02h UTC de 01/01): mês corrente é dezembro e lançamento pago de 01/01 não conta", async () => {
    const { userId, tx } = await cenario();
    await tx({ type: "income", amount: R(50), date: "2027-01-01" });
    await tx({ type: "expense", amount: R(20), date: "2026-12-31", paid: false });
    const noite = new Date("2027-01-01T02:00:00Z");
    const d = await getDashboard(db, userId, "2026-12", noite);
    expect(d.totalBalance).toBe(R(1000));
    expect(d.overdue.count).toBe(0);
    expect(d.insights.some((i) => i.title.includes("Previsão"))).toBe(true); // dezembro é o mês corrente
    const madrugada = new Date("2027-01-01T03:00:00Z");
    const d2 = await getDashboard(db, userId, "2027-01", madrugada);
    expect(d2.totalBalance).toBe(R(1050));
    expect(d2.overdue).toMatchObject({ count: 1, expense: R(20) });
  });
});

describe("banca2 · filtros e paginação", () => {
  it("mês + conta + tipo + busca combinam; conta pega transferência de entrada e saída; total e páginas batem", async () => {
    const { userId, banco, poup, tx } = await cenario();
    for (let i = 0; i < 7; i++) await tx({ type: "expense", amount: R(1 + i), description: `Mercado ${i}`, date: `2026-10-0${i + 1}` });
    await tx({ type: "income", amount: R(9), description: "Salário" });
    await tx({ type: "transfer", amount: R(3), toAccountId: poup, description: "Guardar" });
    await tx({ type: "transfer", amount: R(2), accountId: poup, toAccountId: banco, description: "Resgate", date: "2026-09-30" });
    await tx({ type: "expense", amount: R(4), accountId: poup, description: "100% mercado_x" });

    const r = await searchTransactions(db, userId, { month: "2026-10", accountId: poup });
    expect(r.items.map((t) => t.description).sort()).toEqual(["100% mercado_x", "Guardar"]);
    expect((await searchTransactions(db, userId, { accountId: poup })).total).toBe(3);
    expect((await searchTransactions(db, userId, { type: "transfer", month: "2026-10" })).total).toBe(1);
    expect((await searchTransactions(db, userId, { search: "mercado" })).total).toBe(8);
    expect((await searchTransactions(db, userId, { search: "100%" })).items.map((t) => t.description)).toEqual(["100% mercado_x"]);
    expect((await searchTransactions(db, userId, { search: "_" })).total).toBe(1);
    expect((await searchTransactions(db, userId, { search: "%" })).total).toBe(1);

    const p1 = await searchTransactions(db, userId, { search: "Mercado", accountId: banco, limit: 3, offset: 0 });
    const p2 = await searchTransactions(db, userId, { search: "Mercado", accountId: banco, limit: 3, offset: 3 });
    const p3 = await searchTransactions(db, userId, { search: "Mercado", accountId: banco, limit: 3, offset: 6 });
    expect(p1.total).toBe(7);
    const ids = [...p1.items, ...p2.items, ...p3.items].map((t) => t.id);
    expect(new Set(ids).size).toBe(7);
    // ordem: data mais recente primeiro
    expect(p1.items[0].description).toBe("Mercado 6");
    // conta de outra pessoa ou lixo: vazio
    const outro = await cenario();
    expect((await searchTransactions(db, outro.userId, { accountId: banco })).total).toBe(0);
    expect((await searchTransactions(db, userId, { accountId: "lixo" })).total).toBe(0);
  });

  it("vários lançamentos no mesmo dia e mesmo instante não se repetem nem somem entre páginas", async () => {
    const { userId, banco } = await cenario();
    // série de 1 comando: todas têm o mesmo created_at; aqui 30 avulsas no mesmo dia via 1 INSERT
    await db.query(
      `INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id)
       SELECT $1, 'expense', 'igual ' || g, 100, '2026-10-10', true, $2 FROM generate_series(1, 30) g`,
      [userId, banco],
    );
    const seen: string[] = [];
    for (let off = 0; off < 30; off += 7) {
      seen.push(...(await searchTransactions(db, userId, { limit: 7, offset: off })).items.map((t) => t.id));
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });
});

describe("banca2 · análise do painel", () => {
  it("atrasados somam pendentes vencidos de meses anteriores; 'vencem em 7 dias' não conta entradas", async () => {
    const { userId, tx } = await cenario();
    await tx({ type: "expense", amount: R(40), paid: false, date: "2026-09-20" });
    await tx({ type: "income", amount: R(15), paid: false, date: "2026-10-01" });
    await tx({ type: "expense", amount: R(25), paid: false, date: "2026-10-30" });
    await tx({ type: "income", amount: R(99), paid: false, date: "2026-10-29" });
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.overdue).toMatchObject({ count: 2, expense: R(40), income: R(15) });
    const vence = d.insights.find((i) => i.title.includes("próximos 7 dias"));
    expect(vence?.title).toMatch(/^1 conta vence/);
    expect(vence?.detail).toContain("25,00");
  });

  it("gastos por categoria + sem categoria somam a saída do mês; limite estourado vira alerta", async () => {
    const { userId, tx } = await cenario();
    const cat = (await createCategory(db, userId, { name: "Hobbies", kind: "expense", monthlyLimit: R(100) }))!;
    await tx({ type: "expense", amount: R(80), categoryId: cat });
    await tx({ type: "expense", amount: R(30), categoryId: cat, paid: false, date: "2026-10-29" });
    await tx({ type: "expense", amount: R(5) });
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    const soma = d.expenseCategories.reduce((s, c) => s + c.paidTotal, 0) + d.uncategorized.paidTotal;
    expect(soma).toBe(d.month.expense);
    expect(d.insights.find((i) => i.title === "Hobbies passou do limite")?.detail).toContain("10,00 acima");
  });
});
