import type { Db } from "@/lib/db";
import { SESSION_DAYS } from "@/lib/session";
import { isUuid } from "./errors";

/** Abre uma sessão no banco; o id vai dentro do cookie assinado. */
export async function createSession(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `WITH cleanup AS (DELETE FROM sessions WHERE user_id = $1 AND expires_at < now())
     INSERT INTO sessions (user_id, expires_at) VALUES ($1, now() + make_interval(days => $2)) RETURNING id`,
    [userId, SESSION_DAYS],
  );
  return rows[0].id;
}

/** A sessão existe, é desse usuário e não venceu? (Apagar o usuário apaga as sessões em cascata.) */
export async function isSessionActive(db: Db, sessionId: string, userId: string): Promise<boolean> {
  return (await activeSessionUserName(db, sessionId, userId)) !== null;
}

/** Nome de quem é dono da sessão, se ela ainda vale: confere a sessão e busca o nome numa consulta só. */
export async function activeSessionUserName(db: Db, sessionId: string, userId: string): Promise<string | null> {
  if (!isUuid(sessionId) || !isUuid(userId)) return null;
  const { rows } = await db.query<{ name: string }>(
    `SELECT u.name FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.expires_at > now()`,
    [sessionId, userId],
  );
  return rows[0]?.name ?? null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  if (!isUuid(sessionId)) return;
  await db.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}
