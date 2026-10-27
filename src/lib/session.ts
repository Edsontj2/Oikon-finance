import { SignJWT, jwtVerify } from "jose";
export const SESSION_COOKIE = "oikon_session";
export const SESSION_DAYS = 30;

export type SessionToken = { userId: string; sessionId: string };

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 caracteres");
  return new TextEncoder().encode(secret);
}

export async function signSession({ userId, sessionId }: SessionToken): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/**
 * Confere só a assinatura e a validade do cookie (rápido, usado no proxy).
 * Se a sessão ainda existe no banco é conferido em lib/auth.ts.
 */
export async function verifySession(token: string | undefined): Promise<SessionToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.sub && payload.jti ? { userId: payload.sub, sessionId: payload.jti } : null;
  } catch {
    return null;
  }
}
