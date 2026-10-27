import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { monthParam, type SearchParams } from "@/lib/search-params";
import { listCategories } from "@/data/categories";
import { MonthNav } from "@/components/month-nav";
import { CategoriesView } from "./categories-view";

export default async function CategoriasPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUserId();
  const month = monthParam(await searchParams);
  const categories = await listCategories(getDb(), userId, month);
  return <CategoriesView categories={categories} monthNav={<MonthNav month={month} path="/categorias" />} />;
}
