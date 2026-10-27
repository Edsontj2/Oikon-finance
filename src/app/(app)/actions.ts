"use server";

import { redirect } from "next/navigation";
import { createAccount, deleteAccount, type AccountType } from "@/data/accounts";
import { createCategory, deleteCategory, type CategoryKind } from "@/data/categories";
import { createTransaction, deleteTransaction, setPaid, type TransactionType } from "@/data/transactions";
import { UserError } from "@/data/errors";
import { getDb } from "@/lib/db";
import { parseMoney } from "@/lib/money";
import { endSession, requireUserId } from "@/lib/auth";
import { runAction, safeReturnPath, text } from "../actions-helpers";

function money(form: FormData, name: string, label: string): number {
  const cents = parseMoney(text(form, name));
  if (cents === null) throw new UserError(`${label} inválido. Use, por exemplo, 1.234,56.`);
  return cents;
}

export async function criarLancamento(form: FormData) {
  const userId = await requireUserId();
  const back = safeReturnPath(form.get("voltar"), "/lancamentos");
  await runAction(back, "Lançamento salvo.", async () => {
    const repeat = Number(text(form, "repetir") || "1");
    await createTransaction(getDb(), userId, {
      type: text(form, "tipo") as TransactionType,
      description: text(form, "descricao"),
      amount: money(form, "valor", "Valor"),
      date: text(form, "data"),
      paid: form.get("pago") === "on",
      accountId: text(form, "conta"),
      toAccountId: text(form, "destino") || null,
      categoryId: text(form, "categoria") || null,
      repeat,
      submissionKey: text(form, "chave"),
    });
  });
}

export async function alternarPago(form: FormData) {
  const userId = await requireUserId();
  const back = safeReturnPath(form.get("voltar"), "/lancamentos");
  const paid = text(form, "pago") === "true";
  await runAction(back, paid ? "Marcado como pago." : "Marcado como pendente.", () =>
    setPaid(getDb(), userId, text(form, "id"), paid),
  );
}

export async function excluirLancamento(form: FormData) {
  const userId = await requireUserId();
  const back = safeReturnPath(form.get("voltar"), "/lancamentos");
  const scope = text(form, "escopo") === "futuros" ? "future" : "one";
  await runAction(back, "Lançamento excluído.", () => deleteTransaction(getDb(), userId, text(form, "id"), scope));
}

export async function criarConta(form: FormData) {
  const userId = await requireUserId();
  await runAction("/contas", "Conta criada.", async () => {
    const initial = text(form, "saldo_inicial").trim() ? money(form, "saldo_inicial", "Saldo inicial") : 0;
    await createAccount(getDb(), userId, {
      name: text(form, "nome"),
      type: text(form, "tipo") as AccountType,
      initialBalance: initial,
      submissionKey: text(form, "chave"),
    });
  });
}

export async function excluirConta(form: FormData) {
  const userId = await requireUserId();
  await runAction("/contas", "Conta excluída.", () => deleteAccount(getDb(), userId, text(form, "id")));
}

export async function criarCategoria(form: FormData) {
  const userId = await requireUserId();
  await runAction("/categorias", "Categoria criada.", async () => {
    const limit = text(form, "limite").trim() ? money(form, "limite", "Limite") : null;
    await createCategory(getDb(), userId, {
      name: text(form, "nome"),
      kind: text(form, "tipo") as CategoryKind,
      monthlyLimit: limit,
      submissionKey: text(form, "chave"),
    });
  });
}

export async function excluirCategoria(form: FormData) {
  const userId = await requireUserId();
  await runAction("/categorias", "Categoria excluída.", () => deleteCategory(getDb(), userId, text(form, "id")));
}

export async function sair() {
  await endSession();
  redirect("/login");
}
