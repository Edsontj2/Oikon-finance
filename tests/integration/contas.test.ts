import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccountOptions, listAccounts, setAccountArchived, updateAccount } from "@/data/accounts";
import { monthSummary } from "@/data/dashboard";
import { createTransaction, deleteTransaction, updateTransaction } from "@/data/transactions";
import { listReconciliations, reconcileAccount } from "@/data/reconciliation";
import { listAudit } from "@/data/audit";
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

describe("dados da conta", () => {
  it("instituição, cor, ícone, cheque especial e tipo investimento", async () => {
    const userId = await newUser(db);
    const id = (await createAccount(db, userId, {
      name: "Conta salário", type: "checking", initialBalance: R(-100), institution: "Banco X", color: "#3987e5", icon: "bank", overdraftLimit: R(500),
    }))!;
    const inv = (await createAccount(db, userId, { name: "Tesouro", type: "investment", initialBalance: R(2000) }))!;
    const accounts = await listAccounts(db, userId, NOW);
    expect(accounts.find((a) => a.id === id)).toMatchObject({ institution: "Banco X", color: "#3987e5", icon: "bank", overdraftLimit: R(500), balance: R(-100) });
    expect(accounts.find((a) => a.id === inv)).toMatchObject({ type: "investment", balance: R(2000) });
  });

  it("recusa cheque especial fora da conta corrente, cor e ícone inválidos", async () => {
    const userId = await newUser(db);
    const base = { name: "X", initialBalance: 0 };
    await expect(createAccount(db, userId, { ...base, type: "savings", overdraftLimit: R(10) })).rejects.toThrow("conta corrente");
    await expect(createAccount(db, userId, { ...base, type: "checking", color: "red" })).rejects.toThrow("Cor");
    await expect(createAccount(db, userId, { ...base, type: "checking", icon: "foguete" as never })).rejects.toThrow("Ícone");
  });
});

describe("arquivar", () => {
  it("só com saldo zerado; arquivada some das escolhas mas continua nos dados", async () => {
    const userId = await newUser(db);
    const id = (await createAccount(db, userId, { name: "Antiga", type: "checking", initialBalance: R(50) }))!;
    await expect(setAccountArchived(db, userId, id, true, NOW)).rejects.toThrow("saldo zerado");
    await createTransaction(db, userId, { type: "expense", description: "Saque", amount: R(50), date: "2026-11-01", paid: true, accountId: id });
    await setAccountArchived(db, userId, id, true, NOW);
    expect((await listAccountOptions(db, userId)).some((a) => a.id === id)).toBe(false);
    expect((await listAccountOptions(db, userId, { includeArchived: true })).find((a) => a.id === id)?.archived).toBe(true);
    expect((await listAccounts(db, userId, NOW)).find((a) => a.id === id)?.archived).toBe(true);
    await setAccountArchived(db, userId, id, false, NOW);
    expect((await listAccountOptions(db, userId)).some((a) => a.id === id)).toBe(true);
    const other = await newUser(db);
    await expect(setAccountArchived(db, other, id, false, NOW)).rejects.toThrow("não encontrada");
  });
});

describe("conciliação", () => {
  it("diferença vira ajuste que corrige o saldo sem virar receita ou despesa", async () => {
    const userId = await newUser(db);
    const id = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(1000) }))!;
    await createTransaction(db, userId, { type: "expense", description: "Mercado", amount: R(200), date: "2026-11-02", paid: true, accountId: id });
    const r = (await reconcileAccount(db, userId, id, { statementBalance: R(785.5) }, NOW))!;
    expect(r).toMatchObject({ system: R(800), statement: R(785.5), difference: -R(14.5) });
    expect(r.adjustmentId).not.toBeNull();
    expect((await listAccounts(db, userId, NOW)).find((a) => a.id === id)!.balance).toBe(R(785.5));
    expect(await monthSummary(db, userId, "2026-11", NOW)).toMatchObject({ income: 0, expense: R(200) });

    // Bateu: registra a conferência sem lançar nada.
    const ok = (await reconcileAccount(db, userId, id, { statementBalance: R(785.5) }, NOW))!;
    expect(ok).toMatchObject({ difference: 0, adjustmentId: null });
    expect(await listReconciliations(db, userId, id)).toHaveLength(2);
  });

  it("reenvio com a mesma chave não ajusta duas vezes; data futura e conta alheia são recusadas", async () => {
    const userId = await newUser(db);
    const id = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: 0 }))!;
    const key = randomUUID();
    await reconcileAccount(db, userId, id, { statementBalance: R(10), submissionKey: key }, NOW);
    expect(await reconcileAccount(db, userId, id, { statementBalance: R(10), submissionKey: key }, NOW)).toBeNull();
    expect((await listAccounts(db, userId, NOW)).find((a) => a.id === id)!.balance).toBe(R(10));
    await expect(reconcileAccount(db, userId, id, { statementBalance: 0, date: "2026-12-01" }, NOW)).rejects.toThrow("hoje");
    const other = await newUser(db);
    await expect(reconcileAccount(db, other, id, { statementBalance: 0 }, NOW)).rejects.toThrow("não encontrada");
  });
});

describe("auditoria", () => {
  it("criação, alteração e exclusão ficam registradas com o que mudou", async () => {
    const userId = await newUser(db);
    const id = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: 0 }))!;
    const [tx] = await createTransaction(db, userId, { type: "expense", description: "Café", amount: R(5), date: "2026-11-02", paid: true, accountId: id });
    await updateTransaction(db, userId, tx, { type: "expense", description: "Café", amount: R(7), date: "2026-11-02", paid: true, accountId: id });
    await deleteTransaction(db, userId, tx);
    await updateAccount(db, userId, id, { name: "Banco Novo", type: "checking", initialBalance: 0 });
    const log = await listAudit(db, userId, { entityId: id });
    expect(log.map((l) => l.summary)).toEqual([
      'Conta "Banco Novo": mudou nome',
      'Lançamento "Café" excluído',
      'Lançamento "Café": mudou valor',
      'Lançamento "Café" criado',
      'Conta "Banco" criada',
    ]);
    expect((await listAudit(db, await newUser(db))).some((l) => l.entityId === id)).toBe(false);
  });

  it("apagar o usuário apaga o histórico dele", async () => {
    const userId = await newUser(db);
    await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: 0 });
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1", [userId]);
    expect(rows[0].n).toBe(0);
  });
});
