import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { listBills } from "@/data/bills";
import { BillsView } from "./bills-view";

export default async function AgendaPage() {
  const userId = await requireUserId();
  const { groups, next30 } = await listBills(getDb(), userId);
  return <BillsView groups={groups} next30={next30} />;
}
