import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { today } from "@/lib/dates";
import { getCard, limitHistory } from "@/data/cards";
import { listAccountOptions } from "@/data/accounts";
import { listCategoryOptions } from "@/data/categories";
import { CardDetailView } from "./card-detail";

export default async function CartaoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const [card, accounts, categories, history] = await Promise.all([
    getCard(db, userId, id),
    listAccountOptions(db, userId),
    listCategoryOptions(db, userId),
    limitHistory(db, userId, id),
  ]);
  if (!card) notFound();
  const asked = typeof sp.fatura === "string" ? sp.fatura : null;
  const todayStr = today();
  // Sem fatura escolhida: a que falta pagar; senão a fechada que ainda não venceu (acabou de ser paga); senão a aberta.
  const justClosed = card.invoices.find((i) => i.closingDate <= todayStr && i.dueDate >= todayStr && i.status !== "empty");
  const selected =
    card.invoices.find((i) => i.month === asked) ?? card.toPay ?? justClosed ?? card.current ?? card.invoices[card.invoices.length - 1];
  return (
    <CardDetailView
      card={card}
      invoice={selected}
      payers={accounts.filter((a) => a.type !== "credit_card")}
      categories={categories.filter((c) => c.kind === "expense")}
      history={history}
      today={todayStr}
    />
  );
}
