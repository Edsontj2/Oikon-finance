import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, deleteAccount, listAccounts } from "@/data/accounts";
import { createCategory, deleteCategory, listCategories } from "@/data/categories";
import { getDashboard, monthSummary } from "@/data/dashboard";
import { createTransaction, deleteTransaction, listTransactions, setPaid, type NewTransaction } from "@/data/transactions";
import { authenticate, createUser, getUserName } from "@/data/users";
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
/** Data fixa: os testes não podem depender do dia em que rodam. */
const HOJE = new Date("2026-10-27T15:00:00Z");

async function balance(userId: string, accountId: string) {
  const a = (await listAccounts(db, userId, HOJE)).find((x) => x.id === accountId);
  if (!a) throw new Error("conta não encontrada");
  return { atual: a.balance, previsto: a.projectedBalance };
}

async function setup(initial = 1000) {
  const userId = await newUser(db);
  const contaId = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(initial) }))!;
  const tx = (data: Partial<NewTransaction> & Pick<NewTransaction, "type" | "amount">) =>
    createTransaction(db, userId, { description: "teste", date: "2026-10-10", paid: true, accountId: contaId, ...data });
  return { userId, contaId, tx };
}

describe("virada de mês/ano", () => {
  it("lançamento em 31/12 aparece em dezembro e não em janeiro; 01/01 o contrário", async () => {
    const { userId, tx } = await setup(0);
    await tx({ type: "expense", amount: R(10), date: "2026-12-31", description: "reveillon" });
    await tx({ type: "income", amount: R(20), date: "2027-01-01", description: "ano novo" });
    const dez = await listTransactions(db, userId, { month: "2026-12" });
    const jan = await listTransactions(db, userId, { month: "2027-01" });
    expect(dez.map((t) => [t.description, t.date])).toEqual([["reveillon", "2026-12-31"]]);
    expect(jan.map((t) => [t.description, t.date])).toEqual([["ano novo", "2027-01-01"]]);
    expect(await monthSummary(db, userId, "2026-12")).toMatchObject({ income: 0, expense: R(10) });
    expect(await monthSummary(db, userId, "2027-01")).toMatchObject({ income: R(20), expense: 0 });
  });

  it("repetir a partir de 30/11 atravessa o ano (30/11, 30/12, 30/01)", async () => {
    const { userId, tx } = await setup(0);
    await tx({ type: "expense", amount: R(5), date: "2026-11-30", repeat: 3 });
    expect((await listTransactions(db, userId, { month: "2027-01" })).map((t) => t.date)).toEqual(["2027-01-30"]);
    expect((await listTransactions(db, userId, { month: "2026-12" })).map((t) => t.date)).toEqual(["2026-12-30"]);
  });
});

describe("fuso de São Paulo nos atrasados", () => {
  it("às 23h de 31/10 em SP (02h UTC de 01/11) um pendente de 31/10 ainda NÃO está atrasado", async () => {
    const { userId, tx } = await setup(0);
    await tx({ type: "expense", amount: R(1), date: "2026-10-31", paid: false });
    await tx({ type: "expense", amount: R(2), date: "2026-10-30", paid: false });
    const antes = await getDashboard(db, userId, "2026-10", new Date("2026-11-01T02:00:00Z"));
    expect(antes.overdue).toEqual({ count: 1, expense: R(2), income: 0, transfer: 0 });
    const depois = await getDashboard(db, userId, "2026-11", new Date("2026-11-01T04:00:00Z"));
    expect(depois.overdue).toEqual({ count: 2, expense: R(3), income: 0, transfer: 0 });
  });

  it("pagamento de fatura (transferência) pendente e vencido aparece nos atrasados do painel (a página de lançamentos marca como 'atrasado')", async () => {
    const { userId, tx } = await setup(1000);
    const cartao = (await createAccount(db, userId, { name: "Cartão", type: "credit_card", initialBalance: R(-500) }))!;
    await tx({ type: "transfer", amount: R(500), toAccountId: cartao, date: "2026-10-05", paid: false, description: "Fatura" });
    const d = await getDashboard(db, userId, "2026-10", new Date("2026-10-20T15:00:00Z"));
    expect(d.overdue.count).toBe(1);
  });
});

describe("lançamento futuro marcado como pago", () => {
  it("saldo ATUAL não deveria incluir saída paga com data no futuro (só o previsto)", async () => {
    const { userId, contaId, tx } = await setup(1000);
    // Hoje (fixo) é 2026-10-27; lança uma saída 'paga' para 2027-06-01.
    await tx({ type: "expense", amount: R(400), date: "2027-06-01", paid: true });
    expect(await balance(userId, contaId)).toEqual({ atual: R(1000), previsto: R(600) });
  });
});

describe("transferência e exclusão de contas", () => {
  it("não deixa excluir a conta DESTINO de uma transferência e mantém os saldos", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const poup = (await createAccount(db, userId, { name: "Poupança", type: "savings", initialBalance: 0 }))!;
    await tx({ type: "transfer", amount: R(300), toAccountId: poup });
    await expect(deleteAccount(db, userId, poup)).rejects.toThrow(UserError);
    expect((await balance(userId, poup)).atual).toBe(R(300));
    expect((await balance(userId, contaId)).atual).toBe(R(700));
  });

  it("monthSummary ignora transferências pagas e pendentes (não viram a pagar/a receber)", async () => {
    const { userId, tx } = await setup(1000);
    const outra = (await createAccount(db, userId, { name: "Outra", type: "cash", initialBalance: 0 }))!;
    await tx({ type: "transfer", amount: R(100), toAccountId: outra, paid: true });
    await tx({ type: "transfer", amount: R(200), toAccountId: outra, paid: false });
    await tx({ type: "expense", amount: R(7), paid: false });
    expect(await monthSummary(db, userId, "2026-10")).toEqual({ income: 0, expense: 0, pendingIncome: 0, pendingExpense: R(7) });
  });

  it("transferência de 60 meses: só a primeira mexe no saldo e o total não muda", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const outra = (await createAccount(db, userId, { name: "Reserva", type: "savings", initialBalance: 0 }))!;
    const ids = await tx({ type: "transfer", amount: R(10), toAccountId: outra, repeat: 60, date: "2026-01-31" });
    expect(ids).toHaveLength(60);
    expect(await balance(userId, contaId)).toEqual({ atual: R(990), previsto: R(400) });
    expect(await balance(userId, outra)).toEqual({ atual: R(10), previsto: R(600) });
    expect((await listTransactions(db, userId, { month: "2030-12" })).map((t) => t.date)).toEqual(["2030-12-31"]);
    expect(await listTransactions(db, userId, { month: "2031-01" })).toHaveLength(0);
  });
});

describe("valores extremos / overflow", () => {
  it("valor acima de MAX_SAFE_INTEGER centavos é recusado", async () => {
    const { tx } = await setup(0);
    await expect(tx({ type: "income", amount: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(UserError);
  });

  it("valor acima de R$ 1 bilhão é recusado, então as somas continuam exatas", async () => {
    const { userId, contaId, tx } = await setup(0);
    await expect(tx({ type: "income", amount: R(1_000_000_000) + 1 })).rejects.toThrow("máximo é R$ 1 bilhão");
    await tx({ type: "income", amount: R(1_000_000_000) });
    await tx({ type: "income", amount: R(1_000_000_000) });
    expect((await balance(userId, contaId)).atual).toBe(R(2_000_000_000));
    await expect(createAccount(db, userId, { name: "Gigante", type: "cash", initialBalance: -R(1_000_000_000) - 1 })).rejects.toThrow(UserError);
  });

  it("saldo inicial não inteiro / NaN dá erro amigável (UserError), não erro do banco", async () => {
    const userId = await newUser(db);
    await expect(createAccount(db, userId, { name: "X", type: "cash", initialBalance: 1.5 })).rejects.toThrow(UserError);
    await expect(createAccount(db, userId, { name: "Y", type: "cash", initialBalance: Number.NaN })).rejects.toThrow(UserError);
  });

  it("limite de categoria não inteiro dá UserError, não erro do banco", async () => {
    const userId = await newUser(db);
    await expect(createCategory(db, userId, { name: "Z", kind: "expense", monthlyLimit: 10.5 })).rejects.toThrow(UserError);
  });
});

describe("repetir todo mês - limites", () => {
  it("repetir 60 cria 60, repetir 1.5 é recusado", async () => {
    const { userId, contaId, tx } = await setup(1000);
    expect(await tx({ type: "expense", amount: R(1), repeat: 60 })).toHaveLength(60);
    await expect(tx({ type: "expense", amount: R(1), repeat: 1.5 })).rejects.toThrow("Repetir deve ser entre 1 e 60 meses.");
    await expect(tx({ type: "expense", amount: R(1), repeat: Number.NaN })).rejects.toThrow("Repetir deve ser entre 1 e 60 meses.");
    expect(await balance(userId, contaId)).toEqual({ atual: R(999), previsto: R(940) });
  });

  it("'excluir este e próximos' no primeiro da série apaga todos", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const ids = await tx({ type: "expense", amount: R(10), repeat: 5 });
    expect(await deleteTransaction(db, userId, ids[0], "future")).toBe(5);
    expect(await balance(userId, contaId)).toEqual({ atual: R(1000), previsto: R(1000) });
  });
});

describe("isolamento entre usuários - leitura", () => {
  it("listTransactions com accountId de OUTRO usuário não devolve nada dele", async () => {
    const a = await setup(1000);
    const b = await setup(1000);
    await a.tx({ type: "expense", amount: R(123), description: "segredo da A" });
    const viaB = await listTransactions(db, b.userId, { month: "2026-10", accountId: a.contaId });
    expect(viaB).toHaveLength(0);
  });

  it("listTransactions com accountId malformado não estoura erro do banco", async () => {
    const a = await setup(1000);
    await expect(listTransactions(db, a.userId, { month: "2026-10", accountId: "abc" })).resolves.toEqual([]);
  });

  it("categorias/painel da B não somam nada da A", async () => {
    const a = await setup(1000);
    const b = await setup(1000);
    const catA = (await createCategory(db, a.userId, { name: "Comum", kind: "expense", monthlyLimit: R(50) }))!;
    await createCategory(db, b.userId, { name: "Comum", kind: "expense", monthlyLimit: R(50) });
    await a.tx({ type: "expense", amount: R(80), categoryId: catA });
    const catsB = await listCategories(db, b.userId, "2026-10");
    expect(catsB.find((c) => c.name === "Comum")?.monthTotal).toBe(0);
    const dB = await getDashboard(db, b.userId, "2026-10", new Date("2026-10-20T12:00:00Z"));
    expect(dB.totalBalance).toBe(R(1000));
    expect(dB.recent).toHaveLength(0);
    expect(dB.month).toEqual({ income: 0, expense: 0, pendingIncome: 0, pendingExpense: 0 });
  });
});

describe("categorias com limite", () => {
  it("categoria apagada some do painel e os gastos ficam sem categoria; saldo intacto", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const cat = (await createCategory(db, userId, { name: "Bar", kind: "expense", monthlyLimit: R(100) }))!;
    await tx({ type: "expense", amount: R(150), categoryId: cat });
    let d = await getDashboard(db, userId, "2026-10", new Date("2026-10-20T12:00:00Z"));
    expect(d.expenseCategories.find((c) => c.id === cat)).toMatchObject({ monthTotal: R(150), monthlyLimit: R(100) });
    await deleteCategory(db, userId, cat);
    d = await getDashboard(db, userId, "2026-10", new Date("2026-10-20T12:00:00Z"));
    expect(d.expenseCategories.find((c) => c.id === cat)).toBeUndefined();
    expect(d.month.expense).toBe(R(150));
    expect((await balance(userId, contaId)).atual).toBe(R(850));
  });

  it("limite só conta gastos do próprio mês", async () => {
    const { userId, tx } = await setup(1000);
    const cat = (await createCategory(db, userId, { name: "Lanche", kind: "expense", monthlyLimit: R(100) }))!;
    await tx({ type: "expense", amount: R(90), categoryId: cat, date: "2026-09-30" });
    await tx({ type: "expense", amount: R(30), categoryId: cat, date: "2026-10-01" });
    await tx({ type: "expense", amount: R(40), categoryId: cat, date: "2026-11-01" });
    const c = (await listCategories(db, userId, "2026-10")).find((x) => x.id === cat)!;
    expect(c.monthTotal).toBe(R(30));
  });
});

describe("cadastro atômico", () => {
  it("createUser (camada de dados) recusa nome/senha vazios", async () => {
    await expect(createUser(db, { name: "  ", email: `vazio-${Date.now()}@t.com`, password: "" })).rejects.toThrow(UserError);
  });
});

describe("usuário apagado com sessão ainda válida", () => {
  it("ações devolvem erro amigável (UserError), não erro de FK do banco", async () => {
    const userId = await newUser(db);
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    expect(await getUserName(db, userId)).toBeNull();
    expect(await listAccounts(db, userId)).toEqual([]);
    await expect(createAccount(db, userId, { name: "Fantasma", type: "cash", initialBalance: 0 })).rejects.toThrow(UserError);
    await expect(createCategory(db, userId, { name: "Fantasma", kind: "expense", monthlyLimit: null })).rejects.toThrow(UserError);
  });

  it("login após apagar não funciona", async () => {
    const email = `apagado-${Date.now()}@t.com`;
    const id = await createUser(db, { name: "A", email, password: "senha-segura-123" });
    await db.query("DELETE FROM users WHERE id = $1", [id]);
    expect(await authenticate(db, email, "senha-segura-123")).toBeNull();
  });
});

describe("pendente/pago - consistência", () => {
  it("marcar como pago duas vezes não desconta duas vezes", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const [id] = await tx({ type: "expense", amount: R(100), paid: false });
    await setPaid(db, userId, id, true);
    await setPaid(db, userId, id, true);
    expect((await balance(userId, contaId)).atual).toBe(R(900));
  });

  it("pagar uma parcela futura da série afeta só ela", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const ids = await tx({ type: "expense", amount: R(100), repeat: 3 });
    await setPaid(db, userId, ids[2], true);
    // A parcela de dezembro foi marcada como paga, mas só sai do saldo atual quando a data chegar.
    expect(await balance(userId, contaId)).toEqual({ atual: R(900), previsto: R(700) });
  });
});
