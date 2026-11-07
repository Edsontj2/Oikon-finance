import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, deleteAccount, listAccounts } from "@/data/accounts";
import { createTransaction } from "@/data/transactions";
import { addCardToAccount, getAccountCard, getCard, linkCardToAccount, listUnlinkedCards, payInvoice, unlinkCard, updateCardSettings } from "@/data/cards";
import { updateAccount } from "@/data/accounts";
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
  const bank = (await createAccount(db, userId, { name: "Banco Azul", type: "checking", initialBalance: R(2000), color: "#0f766e" }))!;
  const balance = async (id: string) => (await listAccounts(db, userId, NOW)).find((a) => a.id === id)!.balance;
  return { userId, bank, balance };
}

describe("conta corrente com cartão de crédito", () => {
  it("cria o cartão ligado à conta, com a conta pagando a fatura", async () => {
    const s = await setup();
    const cardId = await addCardToAccount(db, s.userId, s.bank, { creditLimit: R(3000), closingDay: 3, dueDay: 10, last4: "4321" });
    const card = (await getAccountCard(db, s.userId, s.bank, NOW))!;
    expect(card).toMatchObject({ id: cardId, name: "Cartão Banco Azul", creditLimit: R(3000), closingDay: 3, dueDay: 10, last4: "4321", payerAccountId: s.bank, configured: true });
    const accounts = await listAccounts(db, s.userId, NOW);
    expect(accounts.find((a) => a.id === cardId)).toMatchObject({ type: "credit_card", cardOfAccountId: s.bank, color: "#0f766e" });
    await expect(addCardToAccount(db, s.userId, s.bank, { creditLimit: null, closingDay: 3, dueDay: 10 })).rejects.toThrow("já tem um cartão");
  });

  it("pagar com a própria conta tira do saldo e abate na fatura", async () => {
    const s = await setup();
    const cardId = await addCardToAccount(db, s.userId, s.bank, { creditLimit: R(3000), closingDay: 3, dueDay: 10 });
    await createTransaction(db, s.userId, { type: "expense", description: "Mercado", amount: R(500), date: "2026-10-20", paid: true, accountId: cardId });
    const before = (await getCard(db, s.userId, cardId, NOW))!.toPay!;
    expect(before.remaining).toBe(R(500));
    await payInvoice(db, s.userId, cardId, { amount: R(500), fromAccountId: s.bank, date: "2026-11-04" }, NOW);
    expect(await s.balance(s.bank)).toBe(R(1500));
    expect(await s.balance(cardId)).toBe(0);
    const after = (await getCard(db, s.userId, cardId, NOW))!.invoices.find((i) => i.month === before.month)!;
    expect(after.remaining).toBe(0);
  });

  it("só conta corrente ativa; nome repetido ganha alternativa; nada fica pela metade", async () => {
    const s = await setup();
    const savings = (await createAccount(db, s.userId, { name: "Poupança", type: "savings", initialBalance: 0 }))!;
    await expect(addCardToAccount(db, s.userId, savings, { creditLimit: null, closingDay: 3, dueDay: 10 })).rejects.toThrow("Só conta corrente");
    const same = (await createAccount(db, s.userId, { name: "Cartão Banco Azul", type: "credit_card", initialBalance: 0 }))!;
    expect((await getAccountCard(db, s.userId, s.bank, NOW))?.id).toBe(same); // ligou sozinho pelo nome
    await unlinkCard(db, s.userId, same);
    const id = await addCardToAccount(db, s.userId, s.bank, { creditLimit: null, closingDay: 3, dueDay: 10 });
    expect((await getAccountCard(db, s.userId, s.bank, NOW))!.name).toBe("Banco Azul crédito");
    // dia inválido: o cartão não deve ser criado
    await unlinkCard(db, s.userId, id);
    const before = (await listAccounts(db, s.userId, NOW)).length;
    await expect(addCardToAccount(db, s.userId, s.bank, { creditLimit: null, closingDay: 40, dueDay: 10 })).rejects.toThrow();
    expect((await listAccounts(db, s.userId, NOW)).length).toBe(before);
  });

  it("liga e desliga um cartão já cadastrado; outra pessoa não consegue", async () => {
    const s = await setup();
    const card = (await createAccount(db, s.userId, { name: "Roxinho", type: "credit_card", initialBalance: 0 }))!;
    expect(await getAccountCard(db, s.userId, s.bank, NOW)).toBeNull(); // nome e instituição não combinam
    expect((await listUnlinkedCards(db, s.userId)).map((c) => c.name)).toEqual(["Roxinho"]);
    const other = await newUser(db);
    await expect(linkCardToAccount(db, other, s.bank, card)).rejects.toThrow("Conta não encontrada");
    await linkCardToAccount(db, s.userId, s.bank, card);
    expect((await getAccountCard(db, s.userId, s.bank, NOW))!).toMatchObject({ id: card, payerAccountId: s.bank });
    expect(await listUnlinkedCards(db, s.userId)).toEqual([]);
    await expect(unlinkCard(db, other, card)).rejects.toThrow("não encontrado");
    await unlinkCard(db, s.userId, card);
    expect(await getAccountCard(db, s.userId, s.bank, NOW)).toBeNull();
    expect((await listAccounts(db, s.userId, NOW)).find((a) => a.id === card)).toBeDefined();
  });

  it("excluir a conta sem lançamentos solta o cartão em vez de apagá-lo", async () => {
    const s = await setup();
    const empty = (await createAccount(db, s.userId, { name: "Vazia", type: "checking", initialBalance: 0 }))!;
    const card = await addCardToAccount(db, s.userId, empty, { creditLimit: null, closingDay: 3, dueDay: 10 });
    await deleteAccount(db, s.userId, empty);
    expect((await listAccounts(db, s.userId, NOW)).find((a) => a.id === card)).toMatchObject({ cardOfAccountId: null });
  });

  it("liga sozinho: cartão da mesma instituição, com nome da conta, ou pago pela conta (e o contrário)", async () => {
    const userId = await newUser(db);
    // cartão criado depois da conta, mesma instituição
    const nu = (await createAccount(db, userId, { name: "Nu conta", type: "checking", initialBalance: 0, institution: "Nubank" }))!;
    const nuCard = (await createAccount(db, userId, { name: "Roxinho", type: "credit_card", initialBalance: 0, institution: "nubank " }))!;
    expect((await getAccountCard(db, userId, nu, NOW))?.id).toBe(nuCard);
    // conta criada depois do cartão, pelo nome
    const itauCard = (await createAccount(db, userId, { name: "Cartão Itaú", type: "credit_card", initialBalance: 0 }))!;
    const itau = (await createAccount(db, userId, { name: "Itaú", type: "checking", initialBalance: 0 }))!;
    expect((await getAccountCard(db, userId, itau, NOW))?.id).toBe(itauCard);
    // pela conta que paga a fatura
    const inter = (await createAccount(db, userId, { name: "Inter", type: "checking", initialBalance: 0 }))!;
    const visa = (await createAccount(db, userId, { name: "Visa", type: "credit_card", initialBalance: 0 }))!;
    expect(await getAccountCard(db, userId, inter, NOW)).toBeNull();
    await updateCardSettings(db, userId, visa, { creditLimit: null, closingDay: 3, dueDay: 10, payerAccountId: inter, brand: null, last4: null });
    expect((await getAccountCard(db, userId, inter, NOW))?.id).toBe(visa);
    // trocar a conta que paga leva o cartão junto (se a nova não tiver cartão)
    const c6 = (await createAccount(db, userId, { name: "C6", type: "checking", initialBalance: 0 }))!;
    await updateCardSettings(db, userId, visa, { creditLimit: null, closingDay: 3, dueDay: 10, payerAccountId: c6, brand: null, last4: null });
    expect(await getAccountCard(db, userId, inter, NOW)).toBeNull();
    expect((await getAccountCard(db, userId, c6, NOW))?.id).toBe(visa);
  });

  it("instituição ambígua não liga; desligado à mão não religa; mudar o tipo solta", async () => {
    const userId = await newUser(db);
    const a = (await createAccount(db, userId, { name: "BB 1", type: "checking", initialBalance: 0, institution: "BB" }))!;
    const b = (await createAccount(db, userId, { name: "BB 2", type: "checking", initialBalance: 0, institution: "BB" }))!;
    const card = (await createAccount(db, userId, { name: "Ourocard", type: "credit_card", initialBalance: 0, institution: "BB" }))!;
    expect(await getAccountCard(db, userId, a, NOW)).toBeNull();
    expect(await getAccountCard(db, userId, b, NOW)).toBeNull();
    await linkCardToAccount(db, userId, a, card);
    await unlinkCard(db, userId, card);
    await updateAccount(db, userId, b, { name: "BB 2", type: "checking", initialBalance: 0, institution: "BB" });
    expect(await getAccountCard(db, userId, a, NOW)).toBeNull();
    await linkCardToAccount(db, userId, a, card);
    await updateAccount(db, userId, a, { name: "BB 1", type: "savings", initialBalance: 0, institution: "BB" });
    expect((await listAccounts(db, userId, NOW)).find((x) => x.id === card)!.cardOfAccountId).not.toBe(a);
  });
});
