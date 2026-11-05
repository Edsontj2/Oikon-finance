import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { param, type SearchParams } from "@/lib/search-params";
import { listAccountOptions } from "@/data/accounts";
import { listCategoryOptions } from "@/data/categories";
import { ImportView } from "./import-view";

export default async function ImportarPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUserId();
  const db = getDb();
  const [accounts, categories] = await Promise.all([listAccountOptions(db, userId), listCategoryOptions(db, userId)]);
  const conta = param(await searchParams, "conta");
  const usable = accounts.filter((a) => a.type !== "loan");
  return <ImportView accounts={usable} categories={categories} defaultAccountId={usable.some((a) => a.id === conta) ? conta! : usable[0]?.id ?? ""} />;
}
