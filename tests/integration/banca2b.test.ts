import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { getDashboard, monthSummary } from "@/data/dashboard";
import { createTransaction, deleteTransaction, searchTransactions, setPaid } from "@/data/transactions";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.end(); });
const R = (r: number) => Math.round(r * 100);
const HOJE = new Date("2026-10-27T15:00:00Z");

async function base() {
  const userId = await newUser(db);
  const banco = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(1000) }))!;
  return { userId, banco };
}

describe("banca2b · regressões da 2ª rodada", () => {
  it("pagar adiantado parcela de novembro: saldo e soma dos meses fecham; desmarcar não perde dinheiro", async () => {
    const { userId, banco } = await base();
    const ids = await createTransaction(db, userId, { type: "expense", description: "plano", amount: R(50), date: "2026-10-10", paid: true, accountId: banco, repeat: 3 });
    await setPaid(db, userId, ids[1], true, HOJE);
    const acc = (await listAccounts(db, userId, HOJE)).find((a) => a.name === "Banco")!;
    expect(acc.balance).toBe(R(900));
    expect(acc.projectedBalance).toBe(R(850));
    const out = await monthSummary(db, userId, "2026-10", HOJE);
    const nov = await monthSummary(db, userId, "2026-11", HOJE);
    expect(out.expense + out.pendingExpense + nov.expense + nov.pendingExpense).toBe(R(100));
    await setPaid(db, userId, ids[1], false, HOJE);
    expect((await listAccounts(db, userId, HOJE)).find((a) => a.name === "Banco")!.projectedBalance).toBe(R(850));
    // a parcela continua localizável e a série continua apagável a partir de outubro
    expect(await deleteTransaction(db, userId, ids[0], "future")).toBe(3);
  });

  it("previsão de mês passado/futuro e com atrasado de mês anterior", async () => {
    const { userId, banco } = await base();
    await createTransaction(db, userId, { type: "expense", description: "atrasada", amount: R(40), date: "2026-09-20", paid: false, accountId: banco });
    await createTransaction(db, userId, { type: "expense", description: "nov", amount: R(100), date: "2026-11-15", paid: false, accountId: banco });
    await createTransaction(db, userId, { type: "income", description: "agendada", amount: R(7), date: "2026-10-30", paid: true, accountId: banco });
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.insights.find((i) => i.title.includes("Previsão"))?.title).toContain("967,00");
    // receita paga com data futura conta como pendente no resumo
    expect(d.month).toMatchObject({ income: 0, pendingIncome: R(7) });
    expect(d.totalBalance).toBe(R(1000));
  });

  it("'vencem em 7 dias' x pago com data futura (agora tratado como pendente)", async () => {
    const { userId, banco } = await base();
    await createTransaction(db, userId, { type: "expense", description: "agendada", amount: R(30), date: "2026-10-29", paid: true, accountId: banco });
    const d = await getDashboard(db, userId, "2026-10", HOJE);
    expect(d.month.pendingExpense).toBe(R(30));
    // observação: não vira alerta de "vence" porque já foi paga (agendada) — só registra o comportamento
    expect(d.insights.some((i) => i.title.includes("7 dias"))).toBe(false);
  });

  it("paginação estável com empate de data e created_at (offset)", async () => {
    const { userId, banco } = await base();
    await db.query(`INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id)
      SELECT $1, 'expense', 'igual ' || g, 100, '2026-10-10', true, $2 FROM generate_series(1, 40) g`, [userId, banco]);
    const seen: string[] = [];
    for (let off = 0; off < 40; off += 6) seen.push(...(await searchTransactions(db, userId, { limit: 6, offset: off })).items.map((t) => t.id));
    expect(new Set(seen).size).toBe(40);
  });
});
