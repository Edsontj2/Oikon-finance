import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, deleteSession, isSessionActive } from "@/data/sessions";
import { getDb } from "./db";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./session";

export async function startSession(userId: string): Promise<void> {
  const sessionId = await createSession(getDb(), userId);
  (await cookies()).set(SESSION_COOKIE, await signSession({ userId, sessionId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Sair: apaga a sessão no banco (o cookie antigo deixa de valer) e o cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (token) await deleteSession(getDb(), token.sessionId);
  jar.delete(SESSION_COOKIE);
}

/** Id do usuário logado, conferindo no banco se a sessão ainda existe. Uma consulta por requisição. */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const token = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!token) return null;
  return (await isSessionActive(getDb(), token.sessionId, token.userId)) ? token.userId : null;
});

/** Id do usuário logado; manda para o login se não houver sessão válida. */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  return userId;
}
