import { createHash, randomInt } from "node:crypto";
import type { Db } from "@/lib/db";
import { UserError, assertUuid } from "../errors";

/**
 * Vínculo entre um número de WhatsApp e um usuário. O número sozinho não prova identidade:
 * o vínculo só acontece quando o número envia um código de 6 dígitos que a pessoa gerou
 * dentro do app, logada. O código vale 10 minutos, uma vez, com poucas tentativas.
 */
export type WhatsappLink = {
  userId: string;
  phone: string;
  status: "active" | "paused";
  defaultAccountId: string | null;
  allowEntries: boolean;
  linkedAt: string;
};

const CODE_MINUTES = 10;

function hashCode(code: string): string {
  return createHash("sha256").update(`oikon-whatsapp:${code}`).digest("hex");
}

/** Só dígitos, com DDI (o WhatsApp manda assim: 5511999998888). */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return /^[0-9]{8,15}$/.test(digits) ? digits : null;
}

/** Número mascarado para mostrar na tela e nos registros: +55 11 9••••-8888. */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "••••" : `+${phone.slice(0, 2)} ••••${phone.slice(-4)}`;
}

/** Gera (ou troca) o código de vínculo do usuário. Devolve o código só desta vez. */
export async function createLinkCode(db: Db, userId: string): Promise<{ code: string; expiresAt: string }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO whatsapp_link_codes (user_id, code_hash, expires_at, attempts)
     VALUES ($1, $2, now() + make_interval(mins => $3), 0)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0
     RETURNING expires_at`,
    [userId, hashCode(code), CODE_MINUTES],
  );
  return { code, expiresAt: rows[0].expires_at.toISOString() };
}

/**
 * Usa o código enviado pelo número. Certo: vincula (um número só vale para um usuário; se já
 * estava em outra conta, passa para esta, porque quem manda prova ter o número e o login).
 */
export async function redeemLinkCode(db: Db, phone: string, code: string): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(
    `DELETE FROM whatsapp_link_codes WHERE code_hash = $1 AND expires_at > now() RETURNING user_id`,
    [hashCode(code)],
  );
  const userId = rows[0]?.user_id;
  if (!userId) return null;
  await db.query("DELETE FROM whatsapp_links WHERE phone = $1 AND user_id <> $2", [phone, userId]);
  await db.query(
    `INSERT INTO whatsapp_links (user_id, phone) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, status = 'active', linked_at = now()`,
    [userId, phone],
  );
  return userId;
}

function mapLink(r: Record<string, unknown>): WhatsappLink {
  return {
    userId: r.user_id as string,
    phone: r.phone as string,
    status: r.status as WhatsappLink["status"],
    defaultAccountId: (r.default_account_id as string) ?? null,
    allowEntries: r.allow_entries as boolean,
    linkedAt: (r.linked_at as Date).toISOString(),
  };
}

export async function getLinkByPhone(db: Db, phone: string): Promise<WhatsappLink | null> {
  const { rows } = await db.query("SELECT * FROM whatsapp_links WHERE phone = $1", [phone]);
  return rows[0] ? mapLink(rows[0]) : null;
}

export async function getLinkForUser(db: Db, userId: string): Promise<WhatsappLink | null> {
  const { rows } = await db.query("SELECT * FROM whatsapp_links WHERE user_id = $1", [userId]);
  return rows[0] ? mapLink(rows[0]) : null;
}

export async function unlink(db: Db, userId: string): Promise<void> {
  await db.query("DELETE FROM whatsapp_links WHERE user_id = $1", [userId]);
  await db.query("UPDATE whatsapp_pending_ops SET state = 'cancelled', closed_at = now() WHERE user_id = $1 AND state = 'open'", [userId]);
}

export type LinkSettings = { status: "active" | "paused"; defaultAccountId: string | null; allowEntries: boolean };

export async function updateLinkSettings(db: Db, userId: string, settings: LinkSettings): Promise<void> {
  if (settings.status !== "active" && settings.status !== "paused") throw new UserError("Situação inválida.");
  if (settings.defaultAccountId) {
    assertUuid(settings.defaultAccountId, "Conta não encontrada.");
    const own = await db.query("SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2", [settings.defaultAccountId, userId]);
    if (!own.rows.length) throw new UserError("Conta não encontrada.");
  }
  const { rowCount } = await db.query(
    "UPDATE whatsapp_links SET status = $2, default_account_id = $3, allow_entries = $4 WHERE user_id = $1",
    [userId, settings.status, settings.defaultAccountId, settings.allowEntries === true],
  );
  if (!rowCount) throw new UserError("Vincule o WhatsApp antes de mudar as configurações.");
}

export type MessageLogEntry = { id: string; body: string; reply: string | null; status: string; error: string | null; receivedAt: string };

/** Últimas mensagens do usuário (histórico e erros na tela de configurações). */
export async function listMessages(db: Db, userId: string, limit = 30): Promise<MessageLogEntry[]> {
  const { rows } = await db.query(
    `SELECT id, body, reply, status, error, received_at FROM whatsapp_messages
      WHERE user_id = $1 ORDER BY received_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    reply: r.reply,
    status: r.status,
    error: r.error,
    receivedAt: (r.received_at as Date).toISOString(),
  }));
}
