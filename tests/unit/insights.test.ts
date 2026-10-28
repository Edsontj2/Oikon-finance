import { describe, expect, it } from "vitest";
import { buildInsights, type InsightInput } from "@/domain/insights";

const base: InsightInput = {
  month: "2026-10",
  isCurrentMonth: true,
  totalBalance: 100000,
  accounts: [{ name: "Carteira", type: "cash", balance: 100000 }],
  income: 0,
  expense: 0,
  pendingIncome: 0,
  pendingExpense: 0,
  overdue: { count: 0, expense: 0, income: 0 },
  dueSoon: { count: 0, amount: 0 },
  previousExpenses: [0, 0, 0],
  categories: [],
};
const titles = (input: Partial<InsightInput>) => buildInsights({ ...base, ...input }).map((i) => `${i.tone}: ${i.title}`);

describe("análise do painel", () => {
  it("sem movimento: só uma dica", () => {
    expect(titles({})).toEqual(["info: Ainda sem movimento neste mês"]);
  });

  it("atrasados e conta no negativo aparecem primeiro", () => {
    const out = titles({
      income: 50000,
      expense: 10000,
      overdue: { count: 2, expense: 9000, income: 0 },
      accounts: [{ name: "Nubank", type: "checking", balance: -500 }, { name: "Cartão", type: "credit_card", balance: -9000 }],
    });
    expect(out.slice(0, 2)).toEqual(["bad: 2 lançamentos atrasados", "bad: Nubank está no negativo"]);
    // Cartão de crédito negativo é normal (é fatura), não vira alerta.
    expect(out.join()).not.toContain("Cartão");
  });

  it("limite de categoria: estourado e perto do limite", () => {
    const out = titles({
      expense: 30000,
      categories: [
        { name: "Mercado", monthTotal: 12000, monthlyLimit: 10000, previousAverage: 0 },
        { name: "Lazer", monthTotal: 8500, monthlyLimit: 10000, previousAverage: 0 },
        { name: "Casa", monthTotal: 1000, monthlyLimit: 10000, previousAverage: 0 },
      ],
    });
    expect(out).toContain("warn: Mercado passou do limite");
    expect(out).toContain("info: Lazer está perto do limite");
    expect(out.join()).not.toContain("Casa");
  });

  it("previsão do fim do mês soma pendentes ao saldo e avisa se fica negativo", () => {
    expect(titles({ totalBalance: 10000, pendingExpense: 30000, expense: 1 })).toContain("bad: Previsão: outubro termina no negativo");
    expect(titles({ totalBalance: 10000, pendingIncome: 5000, expense: 1 }).join()).toContain("Previsão para o fim de outubro: R$");
    // Mês passado não tem previsão.
    expect(titles({ isCurrentMonth: false, pendingExpense: 30000, expense: 1 }).join()).not.toContain("Previsão");
  });

  it("compara gastos com a média dos meses anteriores", () => {
    expect(titles({ expense: 150000, previousExpenses: [100000, 100000, 100000] })).toContain("warn: Gastos de outubro 50% acima da média");
    expect(titles({ isCurrentMonth: false, expense: 50000, previousExpenses: [100000, 0, 100000] })).toContain(
      "good: Gastos de outubro 50% abaixo da média",
    );
  });

  it("taxa de economia e saídas maiores que entradas", () => {
    expect(titles({ income: 100000, expense: 70000 })).toContain("good: Você guardou 30% do que recebeu");
    expect(titles({ income: 100000, expense: 120000 })).toContain("bad: Saídas pagas maiores que as entradas");
  });

  it("mês que ainda não começou: não compara com a média nem fala em 'guardou'", () => {
    const out = titles({ isCurrentMonth: false, isFutureMonth: true, month: "2026-11", pendingExpense: 20000, previousExpenses: [100000, 0, 0] });
    expect(out).toEqual(["info: Novembro ainda não começou"]);
    expect(buildInsights({ ...base, isCurrentMonth: false, isFutureMonth: true, month: "2026-11", pendingExpense: 20000 })[0].detail).toContain("a pagar");
  });

  it("previsão usa o saldo do fim do mês calculado no banco quando vem pronto", () => {
    expect(titles({ pendingExpense: 1000, expense: 1, endOfMonthBalance: -500 })).toContain("bad: Previsão: outubro termina no negativo");
  });

  it("no máximo 5, graves primeiro", () => {
    const out = buildInsights({
      ...base,
      income: 100000,
      expense: 150000,
      overdue: { count: 1, expense: 100, income: 0 },
      dueSoon: { count: 3, amount: 5000 },
      pendingExpense: 1000,
      previousExpenses: [50000, 50000, 50000],
      categories: [
        { name: "A", monthTotal: 20000, monthlyLimit: 10000, previousAverage: 1000 },
        { name: "B", monthTotal: 20000, monthlyLimit: 10000, previousAverage: 1000 },
      ],
    });
    expect(out).toHaveLength(5);
    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    expect(out.map((i) => order[i.tone])).toEqual([...out.map((i) => order[i.tone])].sort());
  });
});
