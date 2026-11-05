/**
 * O que cada plano libera. Preço e franquia de IA ficam no banco (tabela plans, ajustável pelo
 * administrador); aqui fica só a definição do produto, sem valores de cobrança.
 */
export type PlanId = "essencial" | "inteligente" | "premium";
export const PLAN_IDS: readonly PlanId[] = ["essencial", "inteligente", "premium"];

export type Feature =
  // Essencial
  | "transactions" | "accounts_cards" | "categories" | "budgets" | "basic_reports" | "dashboard"
  // Inteligente
  | "ai_chat" | "ai_whatsapp" | "ai_entries" | "ai_queries" | "spending_analysis" | "forecast"
  | "recommendations" | "smart_alerts"
  // Premium
  | "deep_analysis" | "personal_planning" | "purchase_simulation" | "payment_capacity"
  | "smart_reports" | "trends" | "goal_planning" | "savings_tips";

const ESSENCIAL: Feature[] = ["transactions", "accounts_cards", "categories", "budgets", "basic_reports", "dashboard"];
const INTELIGENTE: Feature[] = [
  ...ESSENCIAL, "ai_chat", "ai_whatsapp", "ai_entries", "ai_queries", "spending_analysis", "forecast", "recommendations", "smart_alerts",
];
const PREMIUM: Feature[] = [
  ...INTELIGENTE, "deep_analysis", "personal_planning", "purchase_simulation", "payment_capacity", "smart_reports", "trends",
  "goal_planning", "savings_tips",
];

export const PLAN_FEATURES: Record<PlanId, ReadonlySet<Feature>> = {
  essencial: new Set(ESSENCIAL),
  inteligente: new Set(INTELIGENTE),
  premium: new Set(PREMIUM),
};
export const ALL_FEATURES: ReadonlySet<Feature> = new Set(PREMIUM);

/** Ordem para saber se uma troca é para cima (vale na hora) ou para baixo (no fim do período). */
export const PLAN_RANK: Record<PlanId, number> = { essencial: 1, inteligente: 2, premium: 3 };

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

/** Texto para a página de planos (o que aparece em cada cartão). */
export const PLAN_COPY: Record<PlanId, { tagline: string; items: string[] }> = {
  essencial: {
    tagline: "Para organizar o dia a dia.",
    items: [
      "Receitas e despesas", "Contas e cartões", "Categorias", "Orçamento mensal", "Relatórios básicos", "Painel financeiro",
    ],
  },
  inteligente: {
    tagline: "Com o OIKON IA no app e no WhatsApp.",
    items: [
      "Tudo do Essencial", "OIKON IA no app e no WhatsApp", "Registrar gastos por mensagem", "Perguntas em linguagem natural",
      "Análise de gastos e desperdícios", "Previsão de saldo", "Recomendações e alertas",
    ],
  },
  premium: {
    tagline: "Para planejar com profundidade.",
    items: [
      "Tudo do Inteligente", "Análises aprofundadas e tendências", "Planejamento financeiro personalizado",
      "Simulação de compras e parcelamentos", "Capacidade de pagamento", "Relatórios inteligentes", "Planejamento de metas e economia",
    ],
  },
};

/** Mês de referência da franquia de IA (fuso de São Paulo, como o resto do app). */
export function usagePeriod(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Um mês depois (mesmo dia; se não existir, o último dia do mês seguinte). */
export function addMonth(date: Date): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
