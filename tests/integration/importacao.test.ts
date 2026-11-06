import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { createCategory } from "@/data/categories";
import { createTransaction, listTransactions } from "@/data/transactions";
import { applyImport, previewImport } from "@/data/statement-import";
import { parseCsv } from "@/domain/statement";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

const R = (reais: number) => Math.round(reais * 100);
const NOW = new Date("2026-11-10T15:00:00Z");
const CSV = "Data;Descrição;Valor\n03/11/2026;Mercado Bom Preço;-120,00\n04/11/2026;Conta de luz;-150,00\n05/11/2026;Salário;3.000,00\n06/11/2026;Padaria;-12,00\n";

async function setup() {
  const userId = await newUser(db);
  const bank = (await createAccount(db, userId, { name: "Banco", type: "checking", initialBalance: R(1000) }))!;
  const tx = (input: Record<string, unknown>) =>
    createTransaction(db, userId, { type: "expense", description: "x", amount: R(1), date: "2026-11-04", paid: true, accountId: bank, ...input } as never);
  return { userId, bank, tx };
}

describe("importar extrato", () => {
  it("separa novo, já lançado e pendente; grava, concilia e não duplica ao reimportar", async () => {
    const s = await setup();
    const cat = (await createCategory(db, s.userId, { name: "Padarias", kind: "expense", monthlyLimit: null }))!;
    await s.tx({ description: "Padaria", amount: R(8), date: "2026-10-20", categoryId: cat }); // histórico: sugere a categoria
    await s.tx({ description: "Supermercado", amount: R(120), date: "2026-11-02" }); // já lançado (1 dia de diferença)
    const [luz] = await s.tx({ description: "Luz", amount: R(150), date: "2026-11-10", paid: false }); // pendente

    const lines = parseCsv(CSV).lines;
    const preview = await previewImport(db, s.userId, s.bank, lines);
    expect(preview.map((p) => [p.description, p.status])).toEqual([
      ["Mercado Bom Preço", "duplicate"],
      ["Conta de luz", "pending"],
      ["Salário", "new"],
      ["Padaria", "new"],
    ]);
    expect(preview[1].match?.id).toBe(luz);
    expect(preview[3].categoryId).toBe(cat);

    const decisions = preview.map((p) => ({
      ...p,
      action: (p.status === "new" ? "create" : p.status === "pending" ? "reconcile" : "skip") as "create" | "reconcile" | "skip",
      matchId: p.match?.id ?? null,
    }));
    expect(await applyImport(db, s.userId, s.bank, decisions)).toMatchObject({ created: 2, reconciled: 1, skipped: 1 });
    const nov = await listTransactions(db, s.userId, { month: "2026-11" });
    expect(nov.find((t) => t.id === luz)).toMatchObject({ paid: true, date: "2026-11-04" });
    expect(nov.find((t) => t.description === "Padaria")).toMatchObject({ categoryId: cat, paid: true });
    const balance = (await listAccounts(db, s.userId, NOW)).find((a) => a.id === s.bank)!.balance;
    expect(balance).toBe(R(1000 - 8 - 120 - 150 + 3000 - 12));

    // Mesmo arquivo de novo: tudo aparece como já importado/lançado e nada é gravado.
    const again = await previewImport(db, s.userId, s.bank, parseCsv(CSV).lines);
    expect(again.map((p) => p.status)).toEqual(["duplicate", "imported", "imported", "imported"]);
    expect(await applyImport(db, s.userId, s.bank, decisions)).toMatchObject({ created: 0, reconciled: 0, skipped: 4 });
    expect(await listTransactions(db, s.userId, { month: "2026-11" })).toHaveLength(nov.length);
  });

  it("recusa conta de outra pessoa, categoria de outra pessoa e dados adulterados", async () => {
    const s = await setup();
    const other = await setup();
    const lines = parseCsv(CSV).lines;
    await expect(previewImport(db, s.userId, other.bank, lines)).rejects.toThrow("Conta não encontrada");
    const otherCat = (await createCategory(db, other.userId, { name: "Alheia", kind: "expense", monthlyLimit: null }))!;
    const line = { ...lines[0], action: "create" as const };
    await expect(applyImport(db, s.userId, s.bank, [{ ...line, categoryId: otherCat }])).rejects.toThrow("Categoria não encontrada");
    await expect(applyImport(db, s.userId, s.bank, [{ ...line, amount: -5 }])).rejects.toThrow("Valor inválido");
    await expect(applyImport(db, s.userId, s.bank, [{ ...line, date: "2026-02-31" }])).rejects.toThrow("Data inválida");
    // Conciliar um lançamento de outra pessoa não faz nada.
    const [theirs] = await other.tx({ description: "Deles", amount: R(120), paid: false });
    expect(await applyImport(db, s.userId, s.bank, [{ ...line, action: "reconcile", matchId: theirs }])).toMatchObject({ reconciled: 0 });
  });
});

describe("desfazer importação e excluir em lote", () => {
  it("desfazer apaga o que o extrato criou e devolve o pendente conciliado ao que era", async () => {
    const { undoImport, listImports } = await import("@/data/statement-import");
    const s = await setup();
    const [luz] = await s.tx({ description: "Luz", amount: R(150), date: "2026-11-10", paid: false });
    const before = (await listAccounts(db, s.userId, NOW)).find((a) => a.id === s.bank)!.balance;
    const preview = await previewImport(db, s.userId, s.bank, parseCsv(CSV).lines);
    const decisions = preview.map((p) => ({
      ...p,
      action: (p.status === "new" ? "create" : p.status === "pending" ? "reconcile" : "skip") as "create" | "reconcile" | "skip",
      matchId: p.match?.id ?? null,
    }));
    const r = await applyImport(db, s.userId, s.bank, decisions, "extrato-novembro.csv");
    expect(r).toMatchObject({ created: 3, reconciled: 1 });
    const [imp] = await listImports(db, s.userId);
    expect(imp).toMatchObject({ id: r.importId, fileName: "extrato-novembro.csv", created: 3, reconciled: 1, undoneAt: null, accountName: "Banco" });

    // Outra pessoa não consegue desfazer.
    const other = await newUser(db);
    await expect(undoImport(db, other, imp.id)).rejects.toThrow("não encontrada");

    expect(await undoImport(db, s.userId, imp.id)).toEqual({ removed: 3, restored: 1 });
    const nov = await listTransactions(db, s.userId, { month: "2026-11" });
    expect(nov.map((t) => t.description)).toEqual(["Luz"]);
    expect(nov[0]).toMatchObject({ id: luz, paid: false, date: "2026-11-10" });
    expect((await listAccounts(db, s.userId, NOW)).find((a) => a.id === s.bank)!.balance).toBe(before);
    expect((await listImports(db, s.userId))[0].undoneAt).not.toBeNull();
    await expect(undoImport(db, s.userId, imp.id)).rejects.toThrow("já foi desfeita");

    // Depois de desfazer, dá para importar o mesmo extrato de novo.
    const again = await previewImport(db, s.userId, s.bank, parseCsv(CSV).lines);
    expect(again.filter((p) => p.status === "new")).toHaveLength(3);
  });

  it("importação que não muda nada não aparece na lista", async () => {
    const { listImports } = await import("@/data/statement-import");
    const s = await setup();
    const preview = await previewImport(db, s.userId, s.bank, parseCsv(CSV).lines);
    const r = await applyImport(db, s.userId, s.bank, preview.map((p) => ({ ...p, action: "skip" as const, matchId: null })));
    expect(r).toMatchObject({ created: 0, reconciled: 0, importId: null });
    expect(await listImports(db, s.userId)).toEqual([]);
  });

  it("excluir vários de uma vez: só os da pessoa, e os saldos voltam", async () => {
    const { deleteTransactions } = await import("@/data/transactions");
    const s = await setup();
    const [a] = await s.tx({ description: "A", amount: R(10) });
    const [b] = await s.tx({ description: "B", amount: R(20) });
    const [c] = await s.tx({ description: "C", amount: R(30) });
    const parcels = await s.tx({ description: "TV", amount: R(100), installments: 3, date: "2026-11-04" });
    const other = await setup();
    const [foreign] = await other.tx({ description: "Dela", amount: R(5) });
    expect(await deleteTransactions(db, s.userId, [a, b, parcels[1], foreign, "lixo", a])).toBe(3);
    const left = (await db.query("SELECT description, installment_number FROM transactions WHERE user_id = $1 ORDER BY date, description", [s.userId])).rows;
    expect(left.map((r) => `${r.description}${r.installment_number ? r.installment_number : ""}`)).toEqual(["C", "TV1", "TV3"]);
    expect((await listAccounts(db, s.userId, NOW)).find((x) => x.id === s.bank)!.balance).toBe(R(1000 - 30 - 100));
    expect((await db.query("SELECT 1 FROM transactions WHERE id = $1", [foreign])).rows).toHaveLength(1);
    expect(c).toBeTruthy();
    await expect(deleteTransactions(db, s.userId, [])).rejects.toThrow("Selecione");
    await expect(deleteTransactions(db, s.userId, Array.from({ length: 501 }, () => a))).rejects.toThrow("até 500");
  });
});
