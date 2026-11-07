import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { today } from "@/lib/dates";
import { listAccounts } from "@/data/accounts";
import { listReconciliations } from "@/data/reconciliation";
import { listAudit } from "@/data/audit";
import { getAccountCard, listUnlinkedCards } from "@/data/cards";
import { AccountDetail } from "./account-detail";

export default async function ContaPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const db = getDb();
  const account = (await listAccounts(db, userId)).find((a) => a.id === id);
  if (!account) notFound();
  const checking = account.type === "checking";
  const [reconciliations, audit, card, unlinked] = await Promise.all([
    listReconciliations(db, userId, id),
    listAudit(db, userId, { entityId: id, limit: 30 }),
    checking ? getAccountCard(db, userId, id) : null,
    checking ? listUnlinkedCards(db, userId) : [],
  ]);
  return (
    <AccountDetail account={account} reconciliations={reconciliations} audit={audit} today={today()}
      card={checking ? { card, unlinked } : null} />
  );
}
