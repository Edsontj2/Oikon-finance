import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { today } from "@/lib/dates";
import { listLoans } from "@/data/loans";
import { listAccountOptions } from "@/data/accounts";
import { isMoneyAccount } from "@/domain/accounts";
import { LoansView } from "./loans-view";

export default async function DividasPage() {
  const userId = await requireUserId();
  const db = getDb();
  const [loans, accounts] = await Promise.all([listLoans(db, userId), listAccountOptions(db, userId)]);
  return <LoansView loans={loans} accounts={accounts.filter((a) => isMoneyAccount(a.type))} today={today()} />;
}
