"use server";

import { redirect } from "next/navigation";
import { authenticate, createUser, normalizeEmail } from "@/data/users";
import { allowAttempt, clearAttempts, RATE_LIMITS } from "@/data/rate-limit";
import { UserError } from "@/data/errors";
import { getDb } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { text, withMessage } from "../actions-helpers";

const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

export async function entrar(form: FormData) {
  const db = getDb();
  const email = normalizeEmail(text(form, "email"));
  const ip = await clientIp();
  const allowed =
    (await allowAttempt(db, `login:ip:${ip}`, RATE_LIMITS.loginPerIp)) &&
    (await allowAttempt(db, `login:email:${email}`, RATE_LIMITS.loginPerEmail));
  if (!allowed) redirect(withMessage("/login", "erro", TOO_MANY));

  const userId = await authenticate(db, email, text(form, "senha"));
  if (!userId) redirect(withMessage("/login", "erro", "E-mail ou senha incorretos."));
  await clearAttempts(db, `login:email:${email}`);
  await startSession(userId);
  redirect("/");
}

export async function cadastrar(form: FormData) {
  const db = getDb();
  if (!(await allowAttempt(db, `signup:ip:${await clientIp()}`, RATE_LIMITS.signupPerIp))) {
    redirect(withMessage("/cadastro", "erro", TOO_MANY));
  }
  let userId: string;
  try {
    userId = await createUser(db, { name: text(form, "nome"), email: text(form, "email"), password: text(form, "senha") });
  } catch (err) {
    if (err instanceof UserError) redirect(withMessage("/cadastro", "erro", err.message));
    throw err;
  }
  await startSession(userId);
  redirect("/");
}
