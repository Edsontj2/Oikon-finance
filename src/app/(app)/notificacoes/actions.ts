"use server";

import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { createDeviceLinkCode, revokeDevice, setNotificationsPaused } from "@/data/devices";
import { confirmNotification, ignoreNotification } from "@/data/bank-notifications";
import type { TransactionType } from "@/domain/transactions";
import { field, moneyField, runAction, wholeNumberField, type ActionResult } from "../../action-result";

export async function generateDeviceCode(): Promise<{ code: string; expiresAt: string }> {
  const userId = await requireUserId();
  return createDeviceLinkCode(getDb(), userId);
}

export async function unlinkDevice(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Celular desvinculado.", () => revokeDevice(getDb(), userId, id));
}

export async function pauseNotifications(paused: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction(paused ? "Leitura pausada." : "Leitura reativada.", () => setNotificationsPaused(getDb(), userId, paused));
}

export async function confirmBankNotification(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Lançamento criado.", async () => {
    const installments = wholeNumberField(form, "installments", 1);
    await confirmNotification(getDb(), userId, field(form, "id"), {
      type: field(form, "type") as TransactionType,
      description: field(form, "description"),
      amount: moneyField(form, "amount", "Valor") ?? 0,
      date: field(form, "date"),
      accountId: field(form, "accountId"),
      toAccountId: field(form, "toAccountId") || null,
      categoryId: field(form, "categoryId") || null,
      installments: Number.isFinite(installments) ? installments : 1,
    });
  });
}

export async function ignoreBankNotification(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Notificação ignorada.", () => ignoreNotification(getDb(), userId, id));
}
