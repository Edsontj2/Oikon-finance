import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, deleteAccount, listAccounts } from "@/data/accounts";
import { createCategory, deleteCategory, listCategories } from "@/data/categories";
import { getDashboard, monthSummary } from "@/data/dashboard";
import { createTransaction, deleteTransaction, listTransactions, setPaid, type NewTransaction } from "@/data/transactions";
import { authenticate, createUser } from "@/data/users";
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

async function balance(userId: string, accountId: string) {
  const a = (await listAccounts(db, userId)).find((x) => x.id === accountId);
  if (!a) throw new Error("conta não encontrada");
  return { atual: a.balance, previsto: a.projectedBalance };
}

async function total(userId: string) {
  return (await listAccounts(db, userId)).reduce((s, a) => s + a.balance, 0);
}

async function setup(initial = 1000) {
  const userId = await newUser(db);
  const contaId = await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(initial) });
  const tx = (data: Partial<NewTransaction> & Pick<NewTransaction, "type" | "amount">) =>
    createTransaction(db, userId, {
      description: "teste",
      date: "2026-10-10",
      paid: true,
      accountId: contaId,
      ...data,
    });
  return { userId, contaId, tx };
}

describe("cadastro", () => {
  it("novo usuário começa com a conta Carteira zerada e categorias básicas", async () => {
    const userId = await newUser(db);
    const accounts = await listAccounts(db, userId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ name: "Carteira", type: "cash", balance: 0 });
    const cats = await listCategories(db, userId, "2026-10");
    expect(cats.filter((c) => c.kind === "income").length).toBeGreaterThan(0);
    expect(cats.filter((c) => c.kind === "expense").length).toBeGreaterThan(0);
  });

  it("login confere a senha e o e-mail não diferencia maiúsculas", async () => {
    const id = await createUser(db, { name: "Ana", email: "Ana@Exemplo.com", password: "senha-da-ana" });
    expect(await authenticate(db, "ana@exemplo.com", "senha-da-ana")).toBe(id);
    expect(await authenticate(db, "  ANA@EXEMPLO.COM ", "senha-da-ana")).toBe(id);
    expect(await authenticate(db, "ana@exemplo.com", "errada")).toBeNull();
    expect(await authenticate(db, "ninguem@exemplo.com", "senha-da-ana")).toBeNull();
    await expect(createUser(db, { name: "Outra", email: "ana@exemplo.com", password: "12345678" })).rejects.toThrow(
      "Já existe uma conta com esse e-mail.",
    );
  });
});

describe("entrada soma, saída subtrai", () => {
  it("saldo inicial + entrada − saída", async () => {
    const { userId, contaId, tx } = await setup(1000);
    expect((await balance(userId, contaId)).atual).toBe(R(1000));

    await tx({ type: "income", amount: R(500) });
    expect((await balance(userId, contaId)).atual).toBe(R(1500));

    await tx({ type: "expense", amount: R(200.35) });
    expect((await balance(userId, contaId)).atual).toBe(R(1299.65));

    await tx({ type: "expense", amount: R(0.01) });
    expect((await balance(userId, contaId)).atual).toBe(R(1299.64));
  });

  it("saída maior que o saldo deixa a conta negativa", async () => {
    const { userId, contaId, tx } = await setup(100);
    await tx({ type: "expense", amount: R(250) });
    expect((await balance(userId, contaId)).atual).toBe(R(-150));
  });

  it("valores grandes não perdem centavos", async () => {
    const { userId, contaId, tx } = await setup(0);
    for (let i = 0; i < 10; i++) await tx({ type: "income", amount: R(0.1) });
    expect((await balance(userId, contaId)).atual).toBe(R(1));
    await tx({ type: "income", amount: R(9_999_999.99) });
    expect((await balance(userId, contaId)).atual).toBe(R(10_000_000.99));
  });

  it("excluir um lançamento desfaz o efeito no saldo", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const [gasto] = await tx({ type: "expense", amount: R(300) });
    const [ganho] = await tx({ type: "income", amount: R(50) });
    expect((await balance(userId, contaId)).atual).toBe(R(750));
    await deleteTransaction(db, userId, gasto);
    expect((await balance(userId, contaId)).atual).toBe(R(1050));
    await deleteTransaction(db, userId, ganho);
    expect((await balance(userId, contaId)).atual).toBe(R(1000));
  });
});

describe("pendentes (contas a pagar / a receber)", () => {
  it("pendente não mexe no saldo atual, só no previsto", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const [aluguel] = await tx({ type: "expense", amount: R(800), paid: false });
    const [freela] = await tx({ type: "income", amount: R(300), paid: false });
    expect(await balance(userId, contaId)).toEqual({ atual: R(1000), previsto: R(500) });

    await setPaid(db, userId, aluguel, true);
    expect(await balance(userId, contaId)).toEqual({ atual: R(200), previsto: R(500) });

    await setPaid(db, userId, freela, true);
    expect(await balance(userId, contaId)).toEqual({ atual: R(500), previsto: R(500) });

    // Voltar para pendente devolve o dinheiro ao saldo atual.
    await setPaid(db, userId, aluguel, false);
    expect(await balance(userId, contaId)).toEqual({ atual: R(1300), previsto: R(500) });
  });
});

describe("transferências", () => {
  it("tira de uma conta, põe na outra e não muda o total", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const poupanca = await createAccount(db, userId, { name: "Poupança", type: "savings", initialBalance: 0 });
    const antes = await total(userId);

    await tx({ type: "transfer", amount: R(300), toAccountId: poupanca });
    expect((await balance(userId, contaId)).atual).toBe(R(700));
    expect((await balance(userId, poupanca)).atual).toBe(R(300));
    expect(await total(userId)).toBe(antes);

    // Transferência não é ganho nem gasto.
    expect(await monthSummary(db, userId, "2026-10")).toEqual({
      income: 0, expense: 0, pendingIncome: 0, pendingExpense: 0,
    });
  });

  it("transferência pendente só vale quando marcada como paga", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const outra = await createAccount(db, userId, { name: "Outra", type: "checking", initialBalance: 0 });
    const [id] = await tx({ type: "transfer", amount: R(100), toAccountId: outra, paid: false });
    expect((await balance(userId, contaId)).atual).toBe(R(1000));
    expect((await balance(userId, outra)).atual).toBe(0);
    await setPaid(db, userId, id, true);
    expect((await balance(userId, contaId)).atual).toBe(R(900));
    expect((await balance(userId, outra)).atual).toBe(R(100));
  });

  it("cartão de crédito: gasto deixa negativo e o pagamento da fatura zera", async () => {
    const { userId, contaId, tx } = await setup(2000);
    const cartao = await createAccount(db, userId, { name: "Cartão", type: "credit_card", initialBalance: 0 });
    await tx({ type: "expense", amount: R(120), accountId: cartao });
    await tx({ type: "expense", amount: R(80), accountId: cartao });
    expect((await balance(userId, cartao)).atual).toBe(R(-200));

    await tx({ type: "transfer", amount: R(200), toAccountId: cartao, description: "Pagamento da fatura" });
    expect((await balance(userId, cartao)).atual).toBe(0);
    expect((await balance(userId, contaId)).atual).toBe(R(1800));
    // O gasto real (200) aparece uma vez só no mês; o pagamento da fatura não conta de novo.
    expect((await monthSummary(db, userId, "2026-10")).expense).toBe(R(200));
  });

  it("conta com saldo inicial negativo (fatura em aberto)", async () => {
    const { userId } = await setup(0);
    const cartao = await createAccount(db, userId, { name: "Cartão", type: "credit_card", initialBalance: R(-350) });
    expect((await balance(userId, cartao)).atual).toBe(R(-350));
  });
});

describe("repetir todo mês", () => {
  it("cria um lançamento por mês, só o primeiro pago, e o saldo só desconta o primeiro", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const ids = await tx({ type: "expense", amount: R(100), repeat: 3, date: "2026-01-31", description: "Academia" });
    expect(ids).toHaveLength(3);

    const jan = await listTransactions(db, userId, { month: "2026-01" });
    const fev = await listTransactions(db, userId, { month: "2026-02" });
    const mar = await listTransactions(db, userId, { month: "2026-03" });
    expect(jan.map((t) => [t.date, t.paid])).toEqual([["2026-01-31", true]]);
    expect(fev.map((t) => [t.date, t.paid])).toEqual([["2026-02-28", false]]);
    expect(mar.map((t) => [t.date, t.paid])).toEqual([["2026-03-31", false]]);
    expect(jan[0].seriesId).toBe(fev[0].seriesId);

    expect(await balance(userId, contaId)).toEqual({ atual: R(900), previsto: R(700) });
  });

  it("'excluir este e próximos' apaga daquele mês em diante e mantém os anteriores", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const ids = await tx({ type: "expense", amount: R(50), repeat: 4, date: "2026-10-05" });
    const removidos = await deleteTransaction(db, userId, ids[1], "future");
    expect(removidos).toBe(3);
    expect((await listTransactions(db, userId, { month: "2026-10" })).length).toBe(1);
    expect((await listTransactions(db, userId, { month: "2026-11" })).length).toBe(0);
    expect(await balance(userId, contaId)).toEqual({ atual: R(950), previsto: R(950) });
  });

  it("'excluir este e próximos' num lançamento avulso apaga só ele", async () => {
    const { userId, tx } = await setup(1000);
    const [a] = await tx({ type: "expense", amount: R(10) });
    await tx({ type: "expense", amount: R(10) });
    expect(await deleteTransaction(db, userId, a, "future")).toBe(1);
    expect((await listTransactions(db, userId, { month: "2026-10" })).length).toBe(1);
  });
});

describe("resumo do mês e painel", () => {
  it("separa pago e pendente e ignora outros meses", async () => {
    const { userId, tx } = await setup(0);
    await tx({ type: "income", amount: R(5000), date: "2026-10-05" });
    await tx({ type: "income", amount: R(700), date: "2026-10-20", paid: false });
    await tx({ type: "expense", amount: R(1200), date: "2026-10-10" });
    await tx({ type: "expense", amount: R(300), date: "2026-10-31", paid: false });
    await tx({ type: "expense", amount: R(999), date: "2026-09-30" });
    await tx({ type: "income", amount: R(999), date: "2026-11-01" });

    expect(await monthSummary(db, userId, "2026-10")).toEqual({
      income: R(5000), expense: R(1200), pendingIncome: R(700), pendingExpense: R(300),
    });
  });

  it("painel: saldo total, atrasados e gastos por categoria com limite", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const mercado = await createCategory(db, userId, { name: "Feira", kind: "expense", monthlyLimit: R(100) });
    await tx({ type: "expense", amount: R(80), categoryId: mercado });
    await tx({ type: "expense", amount: R(50), categoryId: mercado, paid: false });
    await tx({ type: "expense", amount: R(40), date: "2026-10-01", paid: false });

    const d = await getDashboard(db, userId, "2026-10", new Date("2026-10-15T15:00:00Z"));
    expect(d.totalBalance).toBe(R(920));
    expect(d.accounts.find((a) => a.id === contaId)?.balance).toBe(R(920));
    // 10/10 e 01/10 pendentes, ambos antes de 15/10.
    expect(d.overdue).toEqual({ count: 2, expense: R(90), income: 0 });
    const feira = d.expenseCategories.find((c) => c.id === mercado);
    expect(feira).toMatchObject({ monthTotal: R(130), monthlyLimit: R(100) });
  });
});

describe("validações", () => {
  it("recusa valores e dados inválidos", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const salario = (await listCategories(db, userId, "2026-10")).find((c) => c.kind === "income")!;
    const casos: Array<[Partial<NewTransaction> & Pick<NewTransaction, "type" | "amount">, string]> = [
      [{ type: "expense", amount: 0 }, "O valor precisa ser maior que zero."],
      [{ type: "expense", amount: -100 }, "O valor precisa ser maior que zero."],
      [{ type: "expense", amount: 1.5 }, "O valor precisa ser maior que zero."],
      [{ type: "expense", amount: 100, date: "2026-02-30" }, "Data inválida."],
      [{ type: "expense", amount: 100, description: "   " }, "Informe a descrição."],
      [{ type: "expense", amount: 100, repeat: 61 }, "Repetir deve ser entre 1 e 60 meses."],
      [{ type: "expense", amount: 100, repeat: 0 }, "Repetir deve ser entre 1 e 60 meses."],
      [{ type: "expense", amount: 100, categoryId: salario.id }, "Escolha uma categoria de saída."],
      [{ type: "transfer", amount: 100 }, "Escolha a conta de destino da transferência."],
      [{ type: "transfer", amount: 100, toAccountId: contaId }, "A conta de destino precisa ser diferente da origem."],
      [{ type: "expense", amount: 100, accountId: "nao-e-um-id" }, "Conta não encontrada."],
      [{ type: "bonus" as never, amount: 100 }, "Tipo de lançamento inválido."],
    ];
    for (const [data, msg] of casos) {
      await expect(tx(data), msg).rejects.toThrow(msg);
    }
    expect(await balance(userId, contaId)).toEqual({ atual: R(1000), previsto: R(1000) });
  });

  it("transferência ignora categoria", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const outra = await createAccount(db, userId, { name: "Outra", type: "cash", initialBalance: 0 });
    const cat = (await listCategories(db, userId, "2026-10"))[0];
    await tx({ type: "transfer", amount: R(10), toAccountId: outra, categoryId: cat.id });
    const [t] = await listTransactions(db, userId, { month: "2026-10", accountId: contaId });
    expect(t.categoryId).toBeNull();
  });
});

describe("contas e categorias", () => {
  it("não deixa excluir conta com lançamentos; conta vazia pode", async () => {
    const { userId, contaId, tx } = await setup(1000);
    await tx({ type: "expense", amount: R(10) });
    await expect(deleteAccount(db, userId, contaId)).rejects.toThrow(UserError);
    const vazia = await createAccount(db, userId, { name: "Vazia", type: "cash", initialBalance: 0 });
    await deleteAccount(db, userId, vazia);
    expect((await listAccounts(db, userId)).some((a) => a.id === vazia)).toBe(false);
  });

  it("excluir categoria mantém os lançamentos e o saldo", async () => {
    const { userId, contaId, tx } = await setup(1000);
    const cat = await createCategory(db, userId, { name: "Pets", kind: "expense", monthlyLimit: null });
    await tx({ type: "expense", amount: R(60), categoryId: cat });
    await deleteCategory(db, userId, cat);
    const [t] = await listTransactions(db, userId, { month: "2026-10" });
    expect(t.categoryId).toBeNull();
    expect((await balance(userId, contaId)).atual).toBe(R(940));
  });

  it("recusa categoria repetida e limite inválido", async () => {
    const { userId } = await setup();
    await createCategory(db, userId, { name: "Viagem", kind: "expense", monthlyLimit: R(500) });
    await expect(createCategory(db, userId, { name: "Viagem", kind: "expense", monthlyLimit: null })).rejects.toThrow(
      "Já existe uma categoria com esse nome.",
    );
    await expect(createCategory(db, userId, { name: "X", kind: "expense", monthlyLimit: 0 })).rejects.toThrow(
      UserError,
    );
  });
});

describe("cada usuário só vê e mexe no que é seu", () => {
  it("bloqueia acesso a contas, categorias e lançamentos de outra pessoa", async () => {
    const a = await setup(1000);
    const b = await setup(1000);
    const [lancamentoA] = await a.tx({ type: "expense", amount: R(100) });
    const catA = await createCategory(db, a.userId, { name: "Só da A", kind: "expense", monthlyLimit: null });

    // B tenta lançar na conta de A.
    await expect(b.tx({ type: "expense", amount: R(1), accountId: a.contaId })).rejects.toThrow("Conta não encontrada.");
    // B tenta transferir da própria conta para a de A.
    await expect(b.tx({ type: "transfer", amount: R(1), toAccountId: a.contaId })).rejects.toThrow(
      "Conta não encontrada.",
    );
    // B tenta usar a categoria de A.
    await expect(b.tx({ type: "expense", amount: R(1), categoryId: catA })).rejects.toThrow("Categoria não encontrada.");
    // B tenta marcar como pago / excluir lançamento de A.
    await expect(setPaid(db, b.userId, lancamentoA, false)).rejects.toThrow("Lançamento não encontrado.");
    expect(await deleteTransaction(db, b.userId, lancamentoA)).toBe(0);
    expect(await deleteTransaction(db, b.userId, lancamentoA, "future")).toBe(0);
    // B tenta excluir conta e categoria de A.
    await deleteAccount(db, b.userId, a.contaId);
    await deleteCategory(db, b.userId, catA);

    expect((await balance(a.userId, a.contaId)).atual).toBe(R(900));
    expect((await listCategories(db, a.userId, "2026-10")).some((c) => c.id === catA)).toBe(true);
    expect(await listTransactions(db, b.userId, { month: "2026-10" })).toHaveLength(0);
    expect((await listAccounts(db, b.userId)).some((x) => x.id === a.contaId)).toBe(false);
  });
});
