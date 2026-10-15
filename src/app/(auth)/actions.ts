"use server";

import { redirect } from "next/navigation";
import { authenticate, createUser } from "@/data/users";
import { UserError } from "@/data/errors";
import { getDb } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { text, withMessage } from "../actions-helpers";

export async function entrar(form: FormData) {
  const userId = await authenticate(getDb(), text(form, "email"), text(form, "senha"));
  if (!userId) redirect(withMessage("/login", "erro", "E-mail ou senha incorretos."));
  await startSession(userId);
  redirect("/");
}

export async function cadastrar(form: FormData) {
  const name = text(form, "nome").trim();
  const email = text(form, "email").trim();
  const password = text(form, "senha");

  let error = "";
  if (!name) error = "Informe seu nome.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = "E-mail inválido.";
  else if (password.length < 8) error = "A senha precisa ter pelo menos 8 caracteres.";
  if (error) redirect(withMessage("/cadastro", "erro", error));

  let userId: string;
  try {
    userId = await createUser(getDb(), { name, email, password });
  } catch (err) {
    if (err instanceof UserError) redirect(withMessage("/cadastro", "erro", err.message));
    throw err;
  }
  await startSession(userId);
  redirect("/");
}
