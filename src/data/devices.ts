/**
 * Celulares com o app OIKON (leitura de notificações). O vínculo exige um código de 8 dígitos
 * gerado no site, logado: vale 10 minutos e uma vez só. O celular recebe um token aleatório que
 * só ele guarda; no banco fica o hash (vazar o banco não dá acesso aos celulares).
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Db } from "@/lib/db";
import { UserError, assertUuid } from "./errors";

const CODE_MINUTES = 10;
const hashCode = (code: string) => createHash("sha256").update(`oikon-device-code:${code}`).digest("hex");
const hashToken = (token: string) => createHash("sha256").update(`oikon-device:${token}`).digest("hex");

export type Device = { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null };
export type DeviceAuth = { deviceId: string; userId: string; name: string; paused: boolean };

export async function createDeviceLinkCode(db: Db, userId: string): Promise<{ code: string; expiresAt: string }> {
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO device_link_codes (user_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at
     RETURNING expires_at`,
    [userId, hashCode(code), CODE_MINUTES],
  );
  return { code, expiresAt: rows[0].expires_at.toISOString() };
}

/** Troca o código por um token do celular. Devolve null se o código não vale. */
export async function redeemDeviceCode(db: Db, code: string, name: string): Promise<{ token: string; deviceId: string } | null> {
  if (!/^\d{8}$/.test(code)) return null;
  const deviceName = (name || "Celular").replace(/\s+/g, " ").trim().slice(0, 60) || "Celular";
  const token = randomBytes(32).toString("base64url");
  const { rows } = await db.query<{ id: string }>(
    `WITH used AS (DELETE FROM device_link_codes WHERE code_hash = $1 AND expires_at > now() RETURNING user_id)
     INSERT INTO devices (user_id, name, token_hash) SELECT user_id, $2, $3 FROM used RETURNING id`,
    [hashCode(code), deviceName, hashToken(token)],
  );
  return rows[0] ? { token, deviceId: rows[0].id } : null;
}

export async function authenticateDevice(db: Db, token: string | null | undefined): Promise<DeviceAuth | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const { rows } = await db.query(
    `UPDATE devices d SET last_seen_at = now()
       FROM users u
      WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND u.id = d.user_id
     RETURNING d.id, d.user_id, d.name, u.bank_notifications_paused AS paused`,
    [hashToken(token)],
  );
  const r = rows[0];
  return r ? { deviceId: r.id, userId: r.user_id, name: r.name, paused: r.paused } : null;
}

export async function listDevices(db: Db, userId: string): Promise<Device[]> {
  const { rows } = await db.query(
    `SELECT id, name, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = $1 ORDER BY revoked_at NULLS FIRST, created_at DESC LIMIT 20`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    revokedAt: r.revoked_at?.toISOString() ?? null,
  }));
}

export async function revokeDevice(db: Db, userId: string, deviceId: string): Promise<void> {
  assertUuid(deviceId, "Celular não encontrado.");
  const { rowCount } = await db.query("UPDATE devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [deviceId, userId]);
  if (!rowCount) throw new UserError("Celular não encontrado.");
}

export async function setNotificationsPaused(db: Db, userId: string, paused: boolean): Promise<void> {
  await db.query("UPDATE users SET bank_notifications_paused = $2 WHERE id = $1", [userId, paused === true]);
}

export async function notificationsPaused(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ p: boolean }>("SELECT bank_notifications_paused AS p FROM users WHERE id = $1", [userId]);
  return rows[0]?.p ?? false;
}
