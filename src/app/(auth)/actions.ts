"use server";

import { redirect } from "next/navigation";
import { authenticate, createUser, normalizeEmail } from "@/data/users";
import { allowAttempt, clearAttempts, RATE_LIMITS } from "@/data/rate-limit";
import { UserError } from "@/data/errors";
import { getDb } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { field, type ActionResult } from "../action-result";

const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

export async function signIn(form: FormData): Promise<ActionResult> {
  const db = getDb();
  const email = normalizeEmail(field(form, "email"));
  const ip = await clientIp();
  const allowed =
    (await allowAttempt(db, `login:ip:${ip}`, RATE_LIMITS.loginPerIp)) &&
    (await allowAttempt(db, `login:email:${email}`, RATE_LIMITS.loginPerEmail));
  if (!allowed) return { ok: false, message: TOO_MANY };

  const userId = await authenticate(db, email, field(form, "password"));
  if (!userId) return { ok: false, message: "E-mail ou senha incorretos." };
  await clearAttempts(db, `login:email:${email}`);
  await startSession(userId);
  redirect("/");
}

export async function signUp(form: FormData): Promise<ActionResult> {
  const db = getDb();
  if (!(await allowAttempt(db, `signup:ip:${await clientIp()}`, RATE_LIMITS.signupPerIp))) {
    return { ok: false, message: TOO_MANY };
  }
  let userId: string;
  try {
    userId = await createUser(db, { name: field(form, "name"), email: field(form, "email"), password: field(form, "password") });
  } catch (err) {
    if (err instanceof UserError) return { ok: false, message: err.message };
    throw err;
  }
  await startSession(userId);
  redirect("/");
}
