"use server";

import {
  addCardToAccount,
  linkCardToAccount,
  unlinkCard,
  addCharge,
  addRefund,
  installInvoice,
  moveToInvoice,
  payInvoice,
  updateCardSettings,
} from "@/data/cards";
import type { ChargeKind } from "@/domain/cards";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { field, moneyField, runAction, wholeNumberField, type ActionResult } from "../../action-result";
import { cardSettingsFromForm, dayOrNull } from "./card-form";

/** Cria o cartão de crédito de uma conta corrente. */
export async function addAccountCard(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Cartão de crédito adicionado à conta.", () => addCardToAccount(getDb(), userId, field(form, "accountId"), cardSettingsFromForm(form)));
}

/** Liga um cartão já cadastrado a uma conta corrente. */
export async function linkAccountCard(accountId: string, cardId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Cartão ligado à conta.", () => linkCardToAccount(getDb(), userId, accountId, cardId));
}

export async function unlinkAccountCard(cardId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Cartão desligado da conta.", () => unlinkCard(getDb(), userId, cardId));
}


export async function saveCardSettings(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Cartão atualizado.", () =>
    updateCardSettings(getDb(), userId, field(form, "cardId"), {
      creditLimit: moneyField(form, "creditLimit", "Limite", true),
      closingDay: dayOrNull(form, "closingDay"),
      dueDay: dayOrNull(form, "dueDay"),
      payerAccountId: field(form, "payerAccountId") || null,
      brand: field(form, "brand") || null,
      last4: field(form, "last4") || null,
    }),
  );
}

export async function payCardInvoice(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const scheduled = field(form, "when") === "schedule";
  return runAction(scheduled ? "Pagamento agendado." : "Pagamento registrado.", () =>
    payInvoice(getDb(), userId, field(form, "cardId"), {
      amount: moneyField(form, "amount", "Valor") ?? 0,
      fromAccountId: field(form, "fromAccountId"),
      date: field(form, "date") || undefined,
      paid: !scheduled,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function addCardRefund(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Estorno registrado.", () =>
    addRefund(getDb(), userId, field(form, "cardId"), {
      amount: moneyField(form, "amount", "Valor") ?? 0,
      description: field(form, "description"),
      date: field(form, "date") || undefined,
      categoryId: field(form, "categoryId") || null,
      invoiceMonth: field(form, "invoiceMonth") || null,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function addCardCharge(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Encargo lançado.", () =>
    addCharge(getDb(), userId, field(form, "cardId"), {
      kind: field(form, "kind") as ChargeKind,
      amount: moneyField(form, "amount", "Valor") ?? 0,
      description: field(form, "description"),
      date: field(form, "date") || undefined,
      invoiceMonth: field(form, "invoiceMonth") || null,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function installCardInvoice(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Fatura parcelada.", () =>
    installInvoice(getDb(), userId, field(form, "cardId"), {
      month: field(form, "month"),
      count: wholeNumberField(form, "count", 0),
      installmentAmount: moneyField(form, "installmentAmount", "Valor da parcela") ?? 0,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function moveCardEntry(transactionId: string, month: string | null): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction(month ? "Lançamento movido de fatura." : "Lançamento voltou para a fatura pela data.", () =>
    moveToInvoice(getDb(), userId, transactionId, month),
  );
}
