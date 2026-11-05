/**
 * Quem é administrador: papel "admin" no banco, ou e-mail listado em OIKON_ADMIN_EMAILS
 * (separados por vírgula; útil para o primeiro acesso). Sempre conferido no servidor.
 */
import type { Db } from "@/lib/db";

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query("SELECT email, role FROM users WHERE id = $1", [userId]);
  const user = rows[0];
  if (!user) return false;
  if (user.role === "admin") return true;
  const allowed = (process.env.OIKON_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(String(user.email).toLowerCase());
}
