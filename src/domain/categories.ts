export type CategoryKind = "income" | "expense";

export const categoryKinds: Record<CategoryKind, string> = { expense: "Saída", income: "Entrada" };

export function isCategoryKind(value: unknown): value is CategoryKind {
  return typeof value === "string" && Object.hasOwn(categoryKinds, value);
}

/** `parentId`: subcategoria (um nível só, do mesmo tipo da mãe). */
export type CategoryOption = { id: string; name: string; kind: CategoryKind; parentId?: string | null };

export type Category = CategoryOption & {
  monthlyLimit: number | null;
  /** Já pago/recebido no mês. */
  paidTotal: number;
  /** Ainda pendente no mês. */
  pendingTotal: number;
  /** Pago + pendente: o que o mês vai custar (é o que conta para o limite). */
  monthTotal: number;
};

/** "Alimentação › Restaurante" para subcategorias; o nome puro para as demais. */
export function categoryLabel(c: CategoryOption, all: CategoryOption[]): string {
  const parent = c.parentId ? all.find((p) => p.id === c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Opções em ordem de lista: cada categoria seguida das suas subcategorias, com o rótulo pronto. */
export function sortedCategoryOptions<T extends CategoryOption>(all: T[]): (T & { label: string })[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");
  const isTop = (c: T) => !c.parentId || !all.some((p) => p.id === c.parentId);
  const out: (T & { label: string })[] = [];
  for (const top of all.filter(isTop).sort(byName)) {
    out.push({ ...top, label: top.name });
    for (const child of all.filter((c) => c.parentId === top.id).sort(byName)) out.push({ ...child, label: categoryLabel(child, all) });
  }
  return out;
}

export type CategoryGroup = Category & {
  children: Category[];
  /** Totais da categoria somados aos das subcategorias. */
  group: { paidTotal: number; pendingTotal: number; monthTotal: number };
};

/** Junta as subcategorias embaixo da mãe; o limite da mãe vale para o total do grupo. */
export function groupCategories(cats: Category[]): CategoryGroup[] {
  const isTop = (c: Category) => !c.parentId || !cats.some((p) => p.id === c.parentId);
  return cats.filter(isTop).map((top) => {
    const children = cats.filter((c) => c.parentId === top.id);
    const sum = (k: "paidTotal" | "pendingTotal" | "monthTotal") => top[k] + children.reduce((s, c) => s + c[k], 0);
    return { ...top, children, group: { paidTotal: sum("paidTotal"), pendingTotal: sum("pendingTotal"), monthTotal: sum("monthTotal") } };
  });
}
