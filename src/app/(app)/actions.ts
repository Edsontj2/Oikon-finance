"use server";

import { redirect } from "next/navigation";
import { createAccount, deleteAccount, updateAccount, type AccountType } from "@/data/accounts";
import { createCategory, deleteCategory, updateCategory, type CategoryKind } from "@/data/categories";
import {
  createTransaction,
  deleteTransaction,
  setPaid,
  updateTransaction,
  type TransactionInput,
  type TransactionType,
} from "@/data/transactions";
import { UserError } from "@/data/errors";
import { getDb } from "@/lib/db";
import { endSession, requireUserId } from "@/lib/auth";
import { field, moneyField, runAction, wholeNumberField, type ActionResult } from "../action-result";

function transactionFromForm(form: FormData): TransactionInput {
  return {
    type: field(form, "type") as TransactionType,
    description: field(form, "description"),
    amount: moneyField(form, "amount", "Valor") ?? 0,
    date: field(form, "date"),
    paid: form.get("paid") === "on",
    accountId: field(form, "accountId"),
    toAccountId: field(form, "toAccountId") || null,
    categoryId: field(form, "categoryId") || null,
  };
}

/** Cria (sem id) ou edita (com id) um lançamento. */
export async function saveTransaction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = field(form, "id");
  if (id) {
    return runAction("Lançamento atualizado.", () => updateTransaction(getDb(), userId, id, transactionFromForm(form)));
  }
  return runAction("Lançamento salvo.", async () => {
    const repeat = form.get("repeatEnabled") === "on" ? wholeNumberField(form, "repeat", 1) : 1;
    await createTransaction(getDb(), userId, {
      ...transactionFromForm(form),
      repeat,
      submissionKey: field(form, "submissionKey"),
    });
  });
}

export async function setTransactionPaid(id: string, paid: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction(paid ? "Marcado como pago." : "Voltou para pendente.", () =>
    setPaid(getDb(), userId, id, paid === true),
  );
}

export async function removeTransaction(id: string, scope: "one" | "future"): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction(scope === "future" ? "Lançamentos excluídos." : "Lançamento excluído.", async () => {
    const removed = await deleteTransaction(getDb(), userId, id, scope === "future" ? "future" : "one");
    if (!removed) throw new UserError("Lançamento não encontrado.");
  });
}

export async function saveAccount(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = field(form, "id");
  const input = () => ({
    name: field(form, "name"),
    type: field(form, "type") as AccountType,
    initialBalance: moneyField(form, "initialBalance", "Saldo inicial", true) ?? 0,
  });
  if (id) return runAction("Conta atualizada.", () => updateAccount(getDb(), userId, id, input()));
  return runAction("Conta criada.", () =>
    createAccount(getDb(), userId, { ...input(), submissionKey: field(form, "submissionKey") }),
  );
}

export async function removeAccount(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Conta excluída.", () => deleteAccount(getDb(), userId, id));
}

export async function saveCategory(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = field(form, "id");
  const fields = () => ({ name: field(form, "name"), monthlyLimit: moneyField(form, "monthlyLimit", "Limite", true) });
  if (id) return runAction("Categoria atualizada.", () => updateCategory(getDb(), userId, id, fields()));
  return runAction("Categoria criada.", () =>
    createCategory(getDb(), userId, {
      ...fields(),
      kind: field(form, "kind") as CategoryKind,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function removeCategory(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Categoria excluída.", () => deleteCategory(getDb(), userId, id));
}

export async function signOut() {
  await endSession();
  redirect("/login");
}
