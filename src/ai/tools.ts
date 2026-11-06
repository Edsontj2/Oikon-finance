/**
 * Ferramentas que o OIKON IA pode chamar. Cada uma tem descrição e parâmetros (JSON Schema,
 * no formato de "function calling"), valida o que o modelo mandou e executa sempre para o
 * usuário autenticado (o userId nunca vem do modelo). Os resultados saem com valores já
 * formatados em reais, para o modelo só repetir, nunca calcular.
 *
 * Nenhuma ferramenta grava nada: registrar lançamentos passa pela confirmação explícita
 * (etapa do chat), fora daqui.
 */
import type { Db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { isValidMonth } from "@/lib/dates";
import type { Feature } from "@/domain/plans";
import { UserError } from "@/data/errors";
import * as A from "@/data/analysis";

export type ToolContext = { db: Db; userId: string; now: Date; features: ReadonlySet<Feature> };
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  /** Recurso do plano exigido (Premium tem análises que o Inteligente não tem). */
  feature: Feature;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

// ---------- validação dos argumentos vindos do modelo ----------

function month(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !isValidMonth(v)) throw new UserError(`${key}: use AAAA-MM.`);
  return v;
}

function int(args: Record<string, unknown>, key: string, min: number, max: number, fallback?: number): number {
  const v = args[key];
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new UserError(`${key} é obrigatório.`);
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new UserError(`${key}: inteiro de ${min} a ${max}.`);
  return v;
}

/** Valor em reais (número com até 2 casas) → centavos. */
function reais(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 100_000_000) throw new UserError(`${key}: valor em reais maior que zero.`);
  const cents = Math.round(v * 100);
  if (Math.abs(cents - v * 100) > 1e-6) throw new UserError(`${key}: no máximo 2 casas decimais.`);
  return cents;
}

const MONTH = { type: "string", description: "Mês no formato AAAA-MM. Omita para o mês atual.", pattern: "^\\d{4}-\\d{2}$" };

// ---------- formatação: centavos → "R$ 1.234,56" ----------

const MONEY_KEYS = new Set([
  "balance", "projectedBalance", "availableInAccounts", "received", "expected", "total", "paid", "toPay", "pending", "budget",
  "average3Months", "uncategorized", "amount", "limit", "limitAvailable", "remaining", "target", "saved", "monthlyNeeded",
  "start", "inflow", "outflow", "available", "netWorth", "monthResult", "openInvoices", "owed", "lentReceivable", "forecast30Days",
  "totalA", "totalB", "diff", "a", "b", "installment", "existingInstallments", "free", "maxInstallment", "safetyMargin",
  "averageIncome", "averageExpenseNoInstallments", "perDay", "dueBefore", "averageSurplus", "toReceive",
]);

export function present(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => present(v, key === "upcoming" ? "upcoming" : ""));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, present(v, k)]));
  }
  if (typeof value === "number" && Number.isInteger(value) && MONEY_KEYS.has(key)) return formatMoney(value);
  return value;
}

// ---------- as ferramentas ----------

export const TOOLS: ToolDefinition[] = [
  {
    name: "getFinancialSummary", feature: "ai_queries",
    description: "Resumo geral: dinheiro disponível nas contas, patrimônio, entradas e saídas do mês, resultado do mês, faturas, dívidas e saldo previsto em 30 dias.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (c) => A.getFinancialSummary(c.db, c.userId, c.now),
  },
  {
    name: "getAccountBalances", feature: "ai_queries",
    description: "Saldo atual e previsto de cada conta e o total disponível nas contas de dinheiro.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (c) => A.getAccountBalances(c.db, c.userId, c.now),
  },
  {
    name: "getMonthlyIncome", feature: "ai_queries",
    description: "Entradas de um mês: recebidas e ainda previstas.",
    parameters: { type: "object", properties: { month: MONTH }, additionalProperties: false },
    run: (c, a) => A.getMonthlyIncome(c.db, c.userId, month(a, "month"), c.now),
  },
  {
    name: "getMonthlyExpenses", feature: "ai_queries",
    description: "Saídas de um mês: já pagas e ainda a pagar (transferências não contam).",
    parameters: { type: "object", properties: { month: MONTH }, additionalProperties: false },
    run: (c, a) => A.getMonthlyExpenses(c.db, c.userId, month(a, "month"), c.now),
  },
  {
    name: "getExpensesByCategory", feature: "spending_analysis",
    description: "Gastos por categoria num mês, com orçamento, média dos 3 meses anteriores e gastos fora do comum.",
    parameters: { type: "object", properties: { month: MONTH }, additionalProperties: false },
    run: (c, a) => A.getExpensesByCategory(c.db, c.userId, month(a, "month"), c.now),
  },
  {
    name: "getTransactions", feature: "ai_queries",
    description: "Lista lançamentos (até 50), com filtros opcionais de mês, tipo e trecho da descrição.",
    parameters: {
      type: "object",
      properties: {
        month: MONTH,
        type: { type: "string", enum: ["income", "expense", "transfer"] },
        search: { type: "string", maxLength: 60, description: "Trecho da descrição, ex.: mercado" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    run: (c, a) => {
      const type = a.type;
      if (type !== undefined && type !== "income" && type !== "expense" && type !== "transfer") throw new UserError("type inválido.");
      const search = typeof a.search === "string" ? a.search.slice(0, 60) : undefined;
      return A.getTransactions(c.db, c.userId, { month: month(a, "month"), type, search, limit: int(a, "limit", 1, 50, 30) }, c.now);
    },
  },
  {
    name: "getCreditCardInvoices", feature: "ai_queries",
    description: "Cartões de crédito: limite, limite disponível, fatura a pagar, fatura atual e próximas faturas.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (c) => A.getCreditCardInvoices(c.db, c.userId, c.now),
  },
  {
    name: "getUpcomingBills", feature: "ai_queries",
    description: "Contas a pagar e a receber nos próximos dias (inclui atrasadas, faturas e contas de todo mês previstas).",
    parameters: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false },
    run: (c, a) => A.getUpcomingBills(c.db, c.userId, int(a, "days", 1, 90, 30), c.now),
  },
  {
    name: "getFinancialGoals", feature: "ai_queries",
    description: "Metas e reserva de emergência: alvo, guardado, quanto falta e quanto guardar por mês.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (c) => A.getFinancialGoals(c.db, c.userId, c.now),
  },
  {
    name: "getCashFlowForecast", feature: "forecast",
    description: "Previsão do saldo das contas em 7, 15, 30, 60 e 90 dias, o menor saldo previsto e se fica negativo.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (c) => A.getCashFlowForecast(c.db, c.userId, c.now),
  },
  {
    name: "compareMonthlyExpenses", feature: "spending_analysis",
    description: "Compara os gastos por categoria de dois meses (padrão: o mês atual com o anterior).",
    parameters: { type: "object", properties: { monthA: MONTH, monthB: MONTH }, additionalProperties: false },
    run: (c, a) => A.compareMonthlyExpenses(c.db, c.userId, month(a, "monthA"), month(a, "monthB"), c.now),
  },
  {
    name: "getDailySpendingAllowance", feature: "ai_queries",
    description: "Quanto dá para gastar por dia até a próxima entrada prevista, descontando as contas que vencem até lá.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (c) => A.getDailySpendingAllowance(c.db, c.userId, c.now),
  },
  {
    name: "planSavings", feature: "goal_planning",
    description: "Quanto guardar por mês para juntar um valor (e em quantos meses, no ritmo atual).",
    parameters: {
      type: "object",
      properties: { target: { type: "number", description: "Valor do objetivo em reais" }, months: { type: "integer", minimum: 1, maximum: 600 } },
      required: ["target"],
      additionalProperties: false,
    },
    run: (c, a) => A.planSavings(c.db, c.userId, { target: reais(a, "target"), months: a.months == null ? null : int(a, "months", 1, 600) }, c.now),
  },
  {
    name: "simulateInstallmentPurchase", feature: "purchase_simulation",
    description: "Simula uma compra parcelada mês a mês contra a renda e os gastos médios, as parcelas já existentes e uma margem de segurança. Devolve premissas e limitações.",
    parameters: {
      type: "object",
      properties: {
        total: { type: "number", description: "Valor total da compra em reais" },
        installments: { type: "integer", minimum: 1, maximum: 48 },
        safetyPct: { type: "integer", minimum: 0, maximum: 50, description: "Margem de segurança em % da renda (padrão 10)" },
      },
      required: ["total", "installments"],
      additionalProperties: false,
    },
    run: (c, a) => A.simulateInstallmentPurchase(c.db, c.userId, { total: reais(a, "total"), installments: int(a, "installments", 1, 48), safetyPct: int(a, "safetyPct", 0, 50, 10) }, c.now),
  },
];

/**
 * Executa uma ferramenta pedida pelo modelo. Nome desconhecido, argumento inválido ou recurso
 * fora do plano voltam como erro legível para o modelo explicar, sem derrubar a conversa.
 */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: "Ferramenta desconhecida." };
  if (!ctx.features.has(tool.feature)) return { ok: false, error: "Este recurso não está incluído no plano da pessoa." };
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  const allowed = new Set(Object.keys(tool.parameters.properties));
  if (Object.keys(args).some((k) => !allowed.has(k))) return { ok: false, error: "Argumento não aceito." };
  try {
    return { ok: true, result: present(await tool.run(ctx, args)) };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    throw err;
  }
}
