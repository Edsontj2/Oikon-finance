import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { activeSessionUserName, createSession, deleteSession } from "@/data/sessions";
import { ensureRecurring } from "@/data/recurring";
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

export type CurrentUser = { id: string; name: string };

/** Usuário logado, conferindo no banco se a sessão ainda existe. Uma consulta por requisição. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const name = await activeSessionUserName(getDb(), token.sessionId, token.userId);
  if (name === null) return null;
  // Lança os recorrentes ("Todo mês") do mês que chegou antes de qualquer tela ou ação ler os dados.
  try {
    await ensureRecurring(getDb(), token.userId);
  } catch (err) {
    console.error("recorrentes: falha ao lançar o mês", err instanceof Error ? err.message : err);
  }
  return { id: token.userId, name };
});

export async function getCurrentUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

/** Usuário logado; manda para o login se não houver sessão válida. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireUserId(): Promise<string> {
  return (await requireUser()).id;
}
