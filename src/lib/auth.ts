import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./session";

export async function startSession(userId: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, await signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Id do usuário logado; manda para o login se não houver sessão. */
export async function requireUserId(): Promise<string> {
  const userId = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) redirect("/login");
  return userId;
}
