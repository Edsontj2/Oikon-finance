/**
 * Importação de extrato: compara as linhas do arquivo com o que já está lançado na conta e
 * grava só o que falta. Notificações e lançamentos à mão são indícios; o extrato é a confirmação.
 */
import { num, type Db } from "@/lib/db";
import { isValidDate } from "@/lib/dates";
import { LIMITS, TOO_BIG, isValidCents } from "@/domain/limits";
import { MAX_STATEMENT_LINES, type StatementLine } from "@/domain/statement";
import { UserError, assertUuid, isUuid, toUserError } from "./errors";

export type ImportStatus =
  /** Não existe: vai ser lançado. */
  | "new"
  /** Já importado antes (mesma linha do extrato). */
  | "imported"
  /** Já lançado à mão e pago: não lança de novo. */
  | "duplicate"
  /** Lançado à mão como pendente: o extrato confirma, marca como pago. */
  | "pending";

export type ImportPreviewLine = StatementLine & {
  status: ImportStatus;
  match: { id: string; description: string; date: string } | null;
  /** Categoria usada da última vez numa descrição igual (sugestão). */
  categoryId: string | null;
};

/** Diferença de datas aceita: lançado pago ±3 dias; pendente pago até 10 dias antes do vencimento. */
const DAYS = 3;
const EARLY_DAYS = 10;

export async function previewImport(db: Db, userId: string, accountId: string, lines: StatementLine[]): Promise<ImportPreviewLine[]> {
  assertUuid(accountId, "Conta não encontrada.");
  lines = lines.filter(
    (l) => l && typeof l.ref === "string" && l.ref.length <= 200 && isValidDate(l.date) && Number.isSafeInteger(l.amount) && l.amount > 0 && (l.type === "income" || l.type === "expense"),
  ).map((l) => ({ ...l, description: String(l.description ?? "").slice(0, LIMITS.description) }));
  const acc = await db.query("SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2", [accountId, userId]);
  if (!acc.rows[0]) throw new UserError("Conta não encontrada.");
  if (lines.length > MAX_STATEMENT_LINES) throw new UserError(`O extrato tem linhas demais (máximo ${MAX_STATEMENT_LINES}). Divida o período.`);
  if (!lines.length) return [];
  const dates = lines.map((l) => l.date).sort();
  const [imported, candidates, history] = await Promise.all([
    db.query<{ import_ref: string }>("SELECT import_ref FROM transactions WHERE (account_id = $1 OR to_account_id = $1) AND user_id = $2 AND import_ref = ANY($3::text[])", [
      accountId, userId, lines.map((l) => l.ref),
    ]),
    // O que mexe nesta conta, sem vínculo com extrato, perto das datas do arquivo.
    db.query(
      `SELECT t.id, t.description, to_char(t.date, 'YYYY-MM-DD') AS date, t.amount_cents, t.paid,
              CASE WHEN t.account_id = $1 AND t.type <> 'income' THEN -1 ELSE 1 END AS sign
         FROM transactions t
        WHERE t.user_id = $2 AND (t.account_id = $1 OR t.to_account_id = $1) AND t.import_ref IS NULL
          AND t.date BETWEEN $3::date - ${DAYS} AND $4::date + ${EARLY_DAYS}
        ORDER BY t.paid, t.date`,
      [accountId, userId, dates[0], dates[dates.length - 1]],
    ),
    db.query(
      `SELECT DISTINCT ON (lower(description), type) lower(description) AS d, type, category_id
         FROM transactions WHERE user_id = $1 AND category_id IS NOT NULL AND lower(description) = ANY($2::text[])
        ORDER BY lower(description), type, date DESC, created_at DESC`,
      [userId, lines.map((l) => l.description.toLowerCase())],
    ),
  ]);
  const done = new Set(imported.rows.map((r) => r.import_ref));
  const used = new Set<string>();
  const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  return lines.map((l) => {
    const category = history.rows.find((h) => h.d === l.description.toLowerCase() && h.type === l.type)?.category_id ?? null;
    if (done.has(l.ref)) return { ...l, status: "imported", match: null, categoryId: category };
    const sign = l.type === "income" ? 1 : -1;
    // Prefere o pendente mais próximo da data; depois o pago.
    const found = candidates.rows
      .filter((c) => {
        if (used.has(c.id) || num(c.amount_cents) !== l.amount || Number(c.sign) !== sign) return false;
        const early = !c.paid && c.date > l.date; // conta pendente paga antes do vencimento
        return dayDiff(c.date, l.date) <= (early ? EARLY_DAYS : DAYS);
      })
      .sort((a, b) => Number(a.paid) - Number(b.paid) || dayDiff(a.date, l.date) - dayDiff(b.date, l.date))[0];
    if (!found) return { ...l, status: "new", match: null, categoryId: category };
    used.add(found.id);
    return { ...l, status: found.paid ? "duplicate" : "pending", match: { id: found.id, description: found.description, date: found.date }, categoryId: category };
  });
}

export type ImportDecision = StatementLine & { action: "create" | "reconcile" | "skip"; matchId?: string | null; categoryId?: string | null };

export type ImportResult = { created: number; reconciled: number; skipped: number; importId: string | null };

/** Grava as linhas escolhidas. Reimportar o mesmo extrato não duplica (import_ref único por conta). */
export async function applyImport(db: Db, userId: string, accountId: string, decisions: ImportDecision[], fileName: string | null = null): Promise<ImportResult> {
  assertUuid(accountId, "Conta não encontrada.");
  if (decisions.length > MAX_STATEMENT_LINES) throw new UserError("Linhas demais.");
  const acc = await db.query("SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2", [accountId, userId]);
  if (!acc.rows[0]) throw new UserError("Conta não encontrada.");
  for (const d of decisions) {
    if (typeof d.ref !== "string" || !d.ref || d.ref.length > 200) throw new UserError("Linha do extrato inválida.");
    if (!isValidDate(d.date)) throw new UserError("Data inválida no extrato.");
    if (!Number.isSafeInteger(d.amount) || d.amount <= 0) throw new UserError("Valor inválido no extrato.");
    if (!isValidCents(d.amount)) throw new UserError(TOO_BIG);
    if (d.type !== "income" && d.type !== "expense") throw new UserError("Tipo inválido no extrato.");
    if (!["create", "reconcile", "skip"].includes(d.action)) throw new UserError("Escolha inválida.");
    if (d.action === "reconcile" && !isUuid(d.matchId)) throw new UserError("Lançamento a conciliar não encontrado.");
    if (d.categoryId && !isUuid(d.categoryId)) throw new UserError("Categoria não encontrada.");
  }
  const create = decisions.filter((d) => d.action === "create");
  const reconcile = decisions.filter((d) => d.action === "reconcile");

  const catIds = [...new Set(create.map((d) => d.categoryId).filter(Boolean))] as string[];
  if (catIds.length) {
    const { rows } = await db.query<{ id: string; kind: string }>("SELECT id, kind FROM categories WHERE user_id = $1 AND id = ANY($2::uuid[])", [userId, catIds]);
    for (const d of create) {
      if (!d.categoryId) continue;
      const cat = rows.find((r) => r.id === d.categoryId);
      if (!cat) throw new UserError("Categoria não encontrada.");
      if (cat.kind !== d.type) d.categoryId = null; // categoria do outro tipo: fica sem categoria
    }
  }

  try {
    // Um único comando: registra a importação, cria, concilia e guarda o que mudou (para desfazer).
    const { rows } = await db.query(
      `WITH imp AS (
         INSERT INTO statement_imports (user_id, account_id, file_name) VALUES ($1, $2, $9) RETURNING id
       ), created AS (
         INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id, category_id, import_ref)
         SELECT $1, d.type, left(d.description, ${LIMITS.description}), d.amount, d.date, true, $2, d.category, d.ref
           FROM unnest($3::text[], $4::text[], $5::bigint[], $6::date[], $7::uuid[], $8::text[]) AS d(type, description, amount, date, category, ref)
         ON CONFLICT (account_id, import_ref) WHERE import_ref IS NOT NULL DO NOTHING
         RETURNING id
       ), old AS (
         SELECT t.id, t.date AS prev_date, t.paid AS prev_paid, d.date, d.ref
           FROM transactions t
           JOIN unnest($10::uuid[], $11::date[], $12::text[], $13::bigint[]) AS d(id, date, ref, amount) ON d.id = t.id
          WHERE t.user_id = $1 AND (t.account_id = $2 OR t.to_account_id = $2)
            AND t.import_ref IS NULL AND t.amount_cents = d.amount
            AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.account_id = t.account_id AND x.import_ref = d.ref)
       ), reconciled AS (
         -- Conciliar: o pendente lançado à mão vira pago na data do extrato e fica ligado à linha.
         UPDATE transactions t SET paid = true, date = old.date, import_ref = old.ref
           FROM old WHERE t.id = old.id
         RETURNING t.id, old.prev_date, old.prev_paid
       ), items AS (
         INSERT INTO statement_import_items (import_id, transaction_id, action, prev_date, prev_paid)
         SELECT (SELECT id FROM imp), id, 'created', NULL, NULL FROM created
         UNION ALL
         SELECT (SELECT id FROM imp), id, 'reconciled', prev_date, prev_paid FROM reconciled
       )
       SELECT (SELECT id FROM imp) AS import_id, (SELECT count(*) FROM created) AS created, (SELECT count(*) FROM reconciled) AS reconciled`,
      [
        userId, accountId,
        create.map((d) => d.type), create.map((d) => d.description.trim() || (d.type === "income" ? "Entrada" : "Saída")),
        create.map((d) => d.amount), create.map((d) => d.date), create.map((d) => d.categoryId || null), create.map((d) => d.ref),
        fileName ? fileName.slice(0, 200) : null,
        reconcile.map((d) => d.matchId), reconcile.map((d) => d.date), reconcile.map((d) => d.ref), reconcile.map((d) => d.amount),
      ],
    );
    const created = Number(rows[0].created);
    const reconciled = Number(rows[0].reconciled);
    // Importação que não mudou nada não fica na lista; as outras guardam os totais (só para mostrar).
    if (!created && !reconciled) await db.query("DELETE FROM statement_imports WHERE id = $1", [rows[0].import_id]);
    else await db.query("UPDATE statement_imports SET created_count = $2, reconciled_count = $3 WHERE id = $1", [rows[0].import_id, created, reconciled]);
    return { created, reconciled, skipped: decisions.length - created - reconciled, importId: created || reconciled ? rows[0].import_id : null };
  } catch (err) {
    throw toUserError(err);
  }
}

export type StatementImport = {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string | null;
  created: number;
  reconciled: number;
  createdAt: string;
  undoneAt: string | null;
};

/** Importações recentes (para a pessoa conferir e, se quiser, desfazer). */
export async function listImports(db: Db, userId: string, limit = 20): Promise<StatementImport[]> {
  const { rows } = await db.query(
    `SELECT i.id, i.account_id, a.name AS account_name, i.file_name, i.created_count, i.reconciled_count, i.created_at, i.undone_at
       FROM statement_imports i JOIN accounts a ON a.id = i.account_id
      WHERE i.user_id = $1 ORDER BY i.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id, accountId: r.account_id, accountName: r.account_name, fileName: r.file_name,
    created: Number(r.created_count), reconciled: Number(r.reconciled_count),
    createdAt: new Date(r.created_at).toISOString(), undoneAt: r.undone_at ? new Date(r.undone_at).toISOString() : null,
  }));
}

/**
 * Desfaz uma importação inteira, num único comando: apaga os lançamentos que ela criou e devolve
 * os conciliados ao que eram (data, pendente/pago, sem ligação com o extrato). Desfazer de novo
 * não faz nada. Lançamentos criados e depois editados à mão também são apagados (vieram do extrato).
 */
export async function undoImport(db: Db, userId: string, importId: string): Promise<{ removed: number; restored: number }> {
  assertUuid(importId, "Importação não encontrada.");
  const { rows } = await db.query(
    `WITH imp AS (
       UPDATE statement_imports SET undone_at = now() WHERE id = $1 AND user_id = $2 AND undone_at IS NULL RETURNING id
     ), restored AS (
       UPDATE transactions t SET date = it.prev_date, paid = it.prev_paid, import_ref = NULL
         FROM statement_import_items it
        WHERE it.import_id = (SELECT id FROM imp) AND it.action = 'reconciled' AND t.id = it.transaction_id AND t.user_id = $2
       RETURNING t.id
     ), removed AS (
       DELETE FROM transactions t USING statement_import_items it
        WHERE it.import_id = (SELECT id FROM imp) AND it.action = 'created' AND t.id = it.transaction_id AND t.user_id = $2
       RETURNING t.id
     )
     SELECT (SELECT count(*) FROM imp) AS found, (SELECT count(*) FROM removed) AS removed, (SELECT count(*) FROM restored) AS restored`,
    [importId, userId],
  );
  if (!Number(rows[0].found)) {
    const { rows: done } = await db.query("SELECT 1 FROM statement_imports WHERE id = $1 AND user_id = $2", [importId, userId]);
    throw new UserError(done.length ? "Esta importação já foi desfeita." : "Importação não encontrada.");
  }
  return { removed: Number(rows[0].removed), restored: Number(rows[0].restored) };
}
