export type CategoryKind = "income" | "expense";

export const categoryKinds: Record<CategoryKind, string> = { expense: "Saída", income: "Entrada" };

export function isCategoryKind(value: unknown): value is CategoryKind {
  return typeof value === "string" && Object.hasOwn(categoryKinds, value);
}

export type CategoryOption = { id: string; name: string; kind: CategoryKind };

export type Category = CategoryOption & {
  monthlyLimit: number | null;
  /** Já pago/recebido no mês. */
  paidTotal: number;
  /** Ainda pendente no mês. */
  pendingTotal: number;
  /** Pago + pendente: o que o mês vai custar (é o que conta para o limite). */
  monthTotal: number;
};
