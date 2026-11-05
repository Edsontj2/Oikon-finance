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

export type ImportResult = { created: number; reconciled: number; skipped: number };

/** Grava as linhas escolhidas. Reimportar o mesmo extrato não duplica (import_ref único por conta). */
export async function applyImport(db: Db, userId: string, accountId: string, decisions: ImportDecision[]): Promise<ImportResult> {
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
    const created = create.length
      ? await db.query(
          `INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id, category_id, import_ref)
           SELECT $1, d.type, left(d.description, ${LIMITS.description}), d.amount, d.date, true, $2, d.category, d.ref
             FROM unnest($3::text[], $4::text[], $5::bigint[], $6::date[], $7::uuid[], $8::text[]) AS d(type, description, amount, date, category, ref)
           ON CONFLICT (account_id, import_ref) WHERE import_ref IS NOT NULL DO NOTHING`,
          [
            userId, accountId,
            create.map((d) => d.type), create.map((d) => d.description.trim() || (d.type === "income" ? "Entrada" : "Saída")),
            create.map((d) => d.amount), create.map((d) => d.date), create.map((d) => d.categoryId || null), create.map((d) => d.ref),
          ],
        )
      : { rowCount: 0 };
    // Conciliar: o pendente lançado à mão vira pago na data do extrato e fica ligado à linha.
    const reconciled = reconcile.length
      ? await db.query(
          `UPDATE transactions t SET paid = true, date = d.date, import_ref = d.ref
             FROM unnest($3::uuid[], $4::date[], $5::text[], $6::bigint[]) AS d(id, date, ref, amount)
            WHERE t.id = d.id AND t.user_id = $1 AND (t.account_id = $2 OR t.to_account_id = $2)
              AND t.import_ref IS NULL AND t.amount_cents = d.amount
              AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.account_id = t.account_id AND x.import_ref = d.ref)`,
          [userId, accountId, reconcile.map((d) => d.matchId), reconcile.map((d) => d.date), reconcile.map((d) => d.ref), reconcile.map((d) => d.amount)],
        )
      : { rowCount: 0 };
    return { created: created.rowCount ?? 0, reconciled: reconciled.rowCount ?? 0, skipped: decisions.length - (created.rowCount ?? 0) - (reconciled.rowCount ?? 0) };
  } catch (err) {
    throw toUserError(err);
  }
}
