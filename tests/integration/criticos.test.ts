import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { createCategory, listCategories } from "@/data/categories";
import { createTransaction, listTransactions } from "@/data/transactions";
import { authenticate, createUser } from "@/data/users";
import { createSession, deleteSession, isSessionActive } from "@/data/sessions";
import { allowAttempt, clearAttempts } from "@/data/rate-limit";
import { SESSION_GONE, UserError } from "@/data/errors";
import { freshDb, newUser, uniqueEmail } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

async function walletId(userId: string) {
  return (await listAccounts(db, userId))[0].id;
}

describe("1. envio duplicado (duplo clique / reenvio)", () => {
  it("a mesma chave de formulário lança uma vez só, mesmo enviada 3 vezes ao mesmo tempo", async () => {
    const userId = await newUser(db);
    const accountId = await walletId(userId);
    const key = randomUUID();
    const send = () =>
      createTransaction(db, userId, {
        type: "expense", description: "Pão", amount: 750, date: "2026-10-10", paid: true, accountId, submissionKey: key,
      });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.filter((ids) => ids.length > 0)).toHaveLength(1);
    expect(await listTransactions(db, userId, { month: "2026-10" })).toHaveLength(1);
    expect((await listAccounts(db, userId))[0].balance).toBe(-750);
  });

  it("chaves diferentes lançam normalmente; sem chave também", async () => {
    const userId = await newUser(db);
    const accountId = await walletId(userId);
    const base = { type: "income" as const, description: "x", amount: 100, date: "2026-10-10", paid: true, accountId };
    await createTransaction(db, userId, { ...base, submissionKey: randomUUID() });
    await createTransaction(db, userId, { ...base, submissionKey: randomUUID() });
    await createTransaction(db, userId, base);
    expect(await listTransactions(db, userId, { month: "2026-10" })).toHaveLength(3);
  });

  it("série (repetir) com chave repetida não duplica a série", async () => {
    const userId = await newUser(db);
    const accountId = await walletId(userId);
    const key = randomUUID();
    const input = { type: "expense" as const, description: "Academia", amount: 100, date: "2026-10-10", paid: true, accountId, repeat: 3, submissionKey: key };
    expect(await createTransaction(db, userId, input)).toHaveLength(3);
    expect(await createTransaction(db, userId, input)).toHaveLength(0);
  });

  it("conta e categoria também não duplicam com a mesma chave", async () => {
    const userId = await newUser(db);
    const key = randomUUID();
    await Promise.all([
      createAccount(db, userId, { name: "Nubank", type: "checking", initialBalance: 0, submissionKey: key }),
      createAccount(db, userId, { name: "Nubank", type: "checking", initialBalance: 0, submissionKey: key }),
    ]);
    expect((await listAccounts(db, userId)).filter((a) => a.name === "Nubank")).toHaveLength(1);
    const catKey = randomUUID();
    await createCategory(db, userId, { name: "Pets", kind: "expense", monthlyLimit: null, submissionKey: catKey });
    expect(await createCategory(db, userId, { name: "Pets", kind: "expense", monthlyLimit: null, submissionKey: catKey })).toBeNull();
    expect((await listCategories(db, userId, "2026-10")).filter((c) => c.name === "Pets")).toHaveLength(1);
  });

  it("se o lançamento for recusado pelo banco, a chave não fica 'gasta'", async () => {
    const userId = await newUser(db);
    const accountId = await walletId(userId);
    const key = randomUUID();
    await db.query("ALTER TABLE transactions ADD CONSTRAINT tmp_recusa CHECK (description <> 'recusar') NOT VALID");
    try {
      await expect(
        createTransaction(db, userId, { type: "expense", description: "recusar", amount: 1, date: "2026-10-10", paid: true, accountId, submissionKey: key }),
      ).rejects.toThrow(UserError);
    } finally {
      await db.query("ALTER TABLE transactions DROP CONSTRAINT tmp_recusa");
    }
    expect(
      await createTransaction(db, userId, { type: "expense", description: "ok", amount: 1, date: "2026-10-10", paid: true, accountId, submissionKey: key }),
    ).toHaveLength(1);
  });
});

describe("2 e 3. sessões no banco", () => {
  it("sessão vale até ser encerrada (sair); depois o mesmo cookie não vale mais", async () => {
    const userId = await newUser(db);
    const sessionId = await createSession(db, userId);
    expect(await isSessionActive(db, sessionId, userId)).toBe(true);
    await deleteSession(db, sessionId);
    expect(await isSessionActive(db, sessionId, userId)).toBe(false);
  });

  it("sessão de outro usuário, vencida ou com id inválido não vale", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    const sessionA = await createSession(db, a);
    expect(await isSessionActive(db, sessionA, b)).toBe(false);
    expect(await isSessionActive(db, "lixo", a)).toBe(false);
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1", [sessionA]);
    expect(await isSessionActive(db, sessionA, a)).toBe(false);
  });

  it("apagar o usuário derruba as sessões dele e as ações dão mensagem amigável", async () => {
    const userId = await newUser(db);
    const sessionId = await createSession(db, userId);
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    expect(await isSessionActive(db, sessionId, userId)).toBe(false);
    await expect(createAccount(db, userId, { name: "Fantasma", type: "cash", initialBalance: 0 })).rejects.toThrow(SESSION_GONE);
    await expect(createCategory(db, userId, { name: "Fantasma", kind: "expense", monthlyLimit: null })).rejects.toThrow(SESSION_GONE);
  });
});

describe("4. cadastro atômico", () => {
  it("se criar as categorias falhar, o usuário não fica criado pela metade e pode se cadastrar de novo", async () => {
    const email = uniqueEmail("meio");
    await db.query("ALTER TABLE categories ADD CONSTRAINT tmp_falha CHECK (name <> 'Lazer') NOT VALID");
    try {
      await expect(createUser(db, { name: "Meio", email, password: "senha-segura-123" })).rejects.toThrow();
    } finally {
      await db.query("ALTER TABLE categories DROP CONSTRAINT tmp_falha");
    }
    const { rows } = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
    expect(rows).toHaveLength(0);
    const id = await createUser(db, { name: "Meio", email, password: "senha-segura-123" });
    expect(await listAccounts(db, id)).toHaveLength(1);
    expect((await listCategories(db, id, "2026-10")).length).toBe(9);
  });

  it("valida nome, e-mail e senha na camada de dados", async () => {
    const email = uniqueEmail();
    await expect(createUser(db, { name: "  ", email, password: "senha-segura-123" })).rejects.toThrow("Informe seu nome.");
    await expect(createUser(db, { name: "A", email: "ze@ze", password: "senha-segura-123" })).rejects.toThrow("E-mail inválido.");
    await expect(createUser(db, { name: "A", email, password: "        " })).rejects.toThrow("pelo menos 8");
    await expect(createUser(db, { name: "A", email, password: "1234567" })).rejects.toThrow("pelo menos 8");
    await expect(createUser(db, { name: "A", email, password: "x".repeat(73) })).rejects.toThrow("no máximo 72");
    await expect(createUser(db, { name: "A".repeat(81), email, password: "senha-segura-123" })).rejects.toThrow("no máximo 80");
  });
});

describe("5. limite de tentativas", () => {
  it("bloqueia depois do limite e libera ao limpar", async () => {
    const bucket = `teste:${randomUUID()}`;
    const rule = { limit: 3, windowSeconds: 60 };
    expect(await allowAttempt(db, bucket, rule)).toBe(true);
    expect(await allowAttempt(db, bucket, rule)).toBe(true);
    expect(await allowAttempt(db, bucket, rule)).toBe(true);
    expect(await allowAttempt(db, bucket, rule)).toBe(false);
    await clearAttempts(db, bucket);
    expect(await allowAttempt(db, bucket, rule)).toBe(true);
  });

  it("tentativas fora da janela não contam", async () => {
    const bucket = `teste:${randomUUID()}`;
    await db.query("INSERT INTO rate_limit_hits (bucket, hit_at) SELECT $1, now() - interval '2 hours' FROM generate_series(1, 10)", [bucket]);
    expect(await allowAttempt(db, bucket, { limit: 3, windowSeconds: 3600 })).toBe(true);
  });

  it("login errado não revela se o e-mail existe", async () => {
    expect(await authenticate(db, uniqueEmail(), "qualquer-coisa")).toBeNull();
  });
});

describe("6. limites de tamanho no servidor e no banco", () => {
  it("descrição, nome de conta e de categoria acima do limite são recusados", async () => {
    const userId = await newUser(db);
    const accountId = await walletId(userId);
    await expect(
      createTransaction(db, userId, { type: "expense", description: "x".repeat(121), amount: 1, date: "2026-10-10", paid: true, accountId, repeat: 60 }),
    ).rejects.toThrow("no máximo 120");
    await expect(createAccount(db, userId, { name: "x".repeat(61), type: "cash", initialBalance: 0 })).rejects.toThrow("no máximo 60");
    await expect(createCategory(db, userId, { name: "x".repeat(61), kind: "expense", monthlyLimit: null })).rejects.toThrow("no máximo 60");
    expect(await listTransactions(db, userId, { month: "2026-10" })).toHaveLength(0);
  });

  it("o banco também recusa texto gigante gravado por fora do app", async () => {
    const userId = await newUser(db);
    await expect(
      db.query("INSERT INTO accounts (user_id, name, type) VALUES ($1, $2, 'cash')", [userId, "x".repeat(1000)]),
    ).rejects.toThrow(/accounts_name_len/);
  });
});
