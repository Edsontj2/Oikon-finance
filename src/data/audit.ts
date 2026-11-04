/** Histórico de alterações gravado pelo próprio banco (migração 0008): quem mudou o quê e quando. */
import { num, type Db } from "@/lib/db";
import { isUuid } from "./errors";

export type AuditEntry = {
  id: number;
  entity: "account" | "transaction";
  entityId: string;
  action: "insert" | "update" | "delete";
  /** Texto curto do que aconteceu, pronto para mostrar. */
  summary: string;
  at: string;
};

const fieldLabels: Record<string, string> = {
  description: "descrição",
  amount_cents: "valor",
  date: "data",
  paid: "pago",
  account_id: "conta",
  to_account_id: "conta de destino",
  category_id: "categoria",
  type: "tipo",
  name: "nome",
  initial_balance_cents: "saldo inicial",
  institution: "instituição",
  color: "cor",
  icon: "ícone",
  archived: "arquivada",
  overdraft_limit_cents: "cheque especial",
  credit_limit_cents: "limite",
  closing_day: "fechamento",
  due_day: "vencimento",
  invoice_month: "fatura",
};

function describe(entity: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  const row = after ?? before ?? {};
  const label = entity === "account" ? `Conta "${row.name}"` : `Lançamento "${row.description}"`;
  const a = entity === "account" ? "a" : "o";
  if (action === "insert") return `${label} criad${a}`;
  if (action === "delete") return `${label} excluíd${a}`;
  const changed = Object.keys(fieldLabels).filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  return changed.length ? `${label}: mudou ${changed.map((k) => fieldLabels[k]).join(", ")}` : `${label} alterad${a}`;
}

export async function listAudit(db: Db, userId: string, opts: { entityId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  if (opts.entityId !== undefined && !isUuid(opts.entityId)) return [];
  const { rows } = await db.query(
    `SELECT id, entity, entity_id, action, before, after, at FROM audit_log
      WHERE user_id = $1 AND ($2::uuid IS NULL OR entity_id = $2::uuid OR (entity = 'transaction' AND (after->>'account_id' = $2::text OR before->>'account_id' = $2::text)))
      ORDER BY at DESC, id DESC LIMIT $3`,
    [userId, opts.entityId ?? null, Math.min(Math.max(opts.limit ?? 50, 1), 200)],
  );
  return rows.map((r) => ({
    id: num(r.id),
    entity: r.entity,
    entityId: r.entity_id,
    action: r.action,
    summary: describe(r.entity, r.action, r.before, r.after),
    at: (r.at as Date).toISOString(),
  }));
}
