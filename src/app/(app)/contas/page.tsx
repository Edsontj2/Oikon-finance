import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { listAccounts } from "@/data/accounts";
import { AccountsView } from "./accounts-view";

export default async function ContasPage() {
  const userId = await requireUserId();
  return <AccountsView accounts={await listAccounts(getDb(), userId)} />;
}
