import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { today } from "@/lib/dates";
import { averageMonthlyExpense, listGoals } from "@/data/goals";
import { listAccountOptions } from "@/data/accounts";
import { isMoneyAccount } from "@/domain/accounts";
import { GoalsView } from "./goals-view";

export default async function MetasPage() {
  const userId = await requireUserId();
  const db = getDb();
  const [goals, accounts, average] = await Promise.all([listGoals(db, userId), listAccountOptions(db, userId), averageMonthlyExpense(db, userId)]);
  return <GoalsView goals={goals} accounts={accounts.filter((a) => isMoneyAccount(a.type))} averageExpense={average} today={today()} />;
}
