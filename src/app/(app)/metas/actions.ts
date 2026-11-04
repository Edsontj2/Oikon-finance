"use server";

import { createGoal, deleteGoal, moveGoalSaved, updateGoal } from "@/data/goals";
import type { GoalKind } from "@/domain/goals";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { field, moneyField, runAction, wholeNumberField, type ActionResult } from "../../action-result";

export async function saveGoal(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const kind = field(form, "kind") as GoalKind;
  const input = {
    name: field(form, "name"),
    kind,
    target: moneyField(form, "target", "Valor da meta") ?? 0,
    targetDate: field(form, "targetDate") || null,
    accountId: field(form, "accountId") || null,
    months: kind === "emergency" ? wholeNumberField(form, "months", 6) : null,
    submissionKey: field(form, "submissionKey"),
  };
  const id = field(form, "id");
  if (id) return runAction("Meta atualizada.", () => updateGoal(getDb(), userId, id, input));
  return runAction("Meta criada.", () => createGoal(getDb(), userId, input));
}

export async function moveSaved(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const withdraw = field(form, "direction") === "out";
  return runAction(withdraw ? "Retirada anotada." : "Valor guardado.", async () => {
    const cents = moneyField(form, "amount", "Valor") ?? 0;
    await moveGoalSaved(getDb(), userId, field(form, "goalId"), withdraw ? -cents : cents);
  });
}

export async function removeGoal(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Meta excluída.", () => deleteGoal(getDb(), userId, id));
}
