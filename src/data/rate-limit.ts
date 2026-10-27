import type { Db } from "@/lib/db";

export const RATE_LIMITS = {
  loginPerEmail: { limit: 8, windowSeconds: 15 * 60 },
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  // Várias pessoas podem compartilhar o mesmo IP (casa, escritório); os testes automáticos sobem esse valor.
  signupPerIp: { limit: Number(process.env.SIGNUP_LIMIT_PER_IP) || 20, windowSeconds: 60 * 60 },
} as const;

/**
 * Registra uma tentativa e diz se ainda está dentro do limite.
 * Fica no banco porque na Vercel cada requisição pode cair numa instância diferente.
 */
export async function allowAttempt(
  db: Db,
  bucket: string,
  rule: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const { rows } = await db.query<{ previous: string }>(
    `WITH hit AS (INSERT INTO rate_limit_hits (bucket) VALUES ($1))
     SELECT count(*) AS previous FROM rate_limit_hits
      WHERE bucket = $1 AND hit_at > now() - make_interval(secs => $2)`,
    [bucket, rule.windowSeconds],
  );
  // De vez em quando, limpa o que já passou da maior janela.
  if (Math.random() < 0.02) {
    await db.query("DELETE FROM rate_limit_hits WHERE hit_at < now() - interval '1 day'");
  }
  return Number(rows[0].previous) < rule.limit;
}

export async function clearAttempts(db: Db, bucket: string): Promise<void> {
  await db.query("DELETE FROM rate_limit_hits WHERE bucket = $1", [bucket]);
}
