"use server";

import { createLoan, deleteLoan, settleLoan, type LoanKind } from "@/data/loans";
import type { AmortizationSystem } from "@/domain/loans";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { field, moneyField, runAction, wholeNumberField, type ActionResult } from "../../action-result";

/** "1,99" ou "1.99" -> 1.99; vazio ou inválido -> NaN (o serviço recusa com mensagem). */
function rateField(form: FormData, name: string): number {
  const text = field(form, name).trim().replace(",", ".");
  return /^\d{1,2}(\.\d{1,4})?$/.test(text) ? Number(text) : Number.NaN;
}

export async function saveLoan(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Empréstimo registrado.", () =>
    createLoan(getDb(), userId, {
      name: field(form, "name"),
      kind: field(form, "kind") as LoanKind,
      principal: moneyField(form, "principal", "Valor") ?? 0,
      monthlyRate: rateField(form, "monthlyRate"),
      installments: wholeNumberField(form, "installments", 0),
      system: field(form, "system") as AmortizationSystem,
      firstDue: field(form, "firstDue"),
      startDate: field(form, "startDate") || undefined,
      payerAccountId: field(form, "payerAccountId"),
      disbursementAccountId: field(form, "disbursementAccountId") || null,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function payOffLoan(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Quitação registrada.", () =>
    settleLoan(getDb(), userId, field(form, "loanId"), {
      amount: moneyField(form, "amount", "Valor") ?? 0,
      date: field(form, "date") || undefined,
      submissionKey: field(form, "submissionKey"),
    }),
  );
}

export async function removeLoan(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Empréstimo excluído.", () => deleteLoan(getDb(), userId, id));
}
