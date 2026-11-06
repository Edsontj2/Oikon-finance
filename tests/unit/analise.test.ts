import { describe, expect, it } from "vitest";
import { compareCategories, dailyAllowance, divCents, percentOf, savingsPlan, simulatePurchase, splitInstallments } from "@/domain/analysis";
import { present } from "@/ai/tools";

const R = (v: number) => Math.round(v * 100);

describe("cálculos do motor de análise (centavos inteiros)", () => {
  it("divide e reparte centavos sem perder nem criar dinheiro", () => {
    expect(divCents(1000, 3)).toBe(333);
    expect(divCents(1001, 2)).toBe(501);
    expect(percentOf(R(5000), 10)).toBe(R(500));
    const parts = splitInstallments(R(2000.02), 3);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(R(2000.02));
    expect(parts).toEqual([66668, 66667, 66667]);
    // 0,1 + 0,2 em reais seria 0,30000000000000004; em centavos não.
    expect(splitInstallments(30, 1)).toEqual([30]);
  });

  it("simulação de compra: cabe, aperta ou não cabe, sempre com premissas", () => {
    const months = ["2026-12", "2027-01", "2027-02"];
    const baseline = { monthsUsed: 3, averageIncome: R(5000), averageExpenseNoInstallments: R(3500), available: R(2000) };
    const ok = simulatePurchase({ total: R(1500), count: 3, months, existingByMonth: {}, baseline, safetyPct: 10 });
    expect(ok.verdict).toBe("fits");
    expect(ok.months.map((m) => m.free)).toEqual([R(1000), R(1000), R(1000)]);
    expect(ok.maxInstallment).toBe(R(1000)); // 5000 − 3500 − 500 de margem
    expect(ok.assumptions.length).toBeGreaterThan(2);

    const tight = simulatePurchase({ total: R(3000), count: 3, months, existingByMonth: { "2027-01": R(200) }, baseline, safetyPct: 10 });
    expect(tight.verdict).toBe("tight");
    expect(tight.months[1]).toMatchObject({ existingInstallments: R(200), free: R(300), status: "tight" });

    const no = simulatePurchase({ total: R(6000), count: 3, months, existingByMonth: {}, baseline, safetyPct: 10 });
    expect(no.verdict).toBe("does_not_fit");

    const none = simulatePurchase({ total: R(100), count: 1, months: ["2026-12"], existingByMonth: {}, baseline: { ...baseline, monthsUsed: 0, averageIncome: 0 }, safetyPct: 10 });
    expect(none.verdict).toBe("insufficient_data");
    expect(none.limitations.length).toBeGreaterThan(0);
  });

  it("plano de economia, gasto por dia e comparação de meses", () => {
    expect(savingsPlan({ target: R(5000), saved: 0, averageSurplus: R(800), months: 10 })).toMatchObject({ monthlyNeeded: R(500), monthsAtCurrentPace: 7 });
    expect(savingsPlan({ target: R(5000), saved: 0, averageSurplus: -R(100), months: null }).monthsAtCurrentPace).toBeNull();
    expect(dailyAllowance({ available: R(1000), dueBefore: R(400), days: 10, reserve: 0 })).toEqual({ free: R(600), days: 10, perDay: R(60) });
    expect(dailyAllowance({ available: R(100), dueBefore: R(400), days: 10, reserve: 0 }).perDay).toBe(0);
    const diff = compareCategories(new Map([["Mercado", R(800)], ["Lazer", R(200)]]), new Map([["Mercado", R(1000)], ["Uber", R(50)]]));
    expect(diff.find((d) => d.name === "Mercado")).toEqual({ name: "Mercado", a: R(800), b: R(1000), diff: R(200), percent: 25 });
    expect(Math.abs(diff[0].diff)).toBe(R(200)); // maiores diferenças primeiro
    expect(diff.find((d) => d.name === "Uber")?.percent).toBeNull();
  });

  it("resultado para o modelo sai com valores em reais formatados (o modelo não converte)", () => {
    const out = present({ available: R(1234.56), monthsUsed: 3, items: [{ amount: R(10), date: "2026-11-01" }] }) as Record<string, unknown>;
    expect(out.available).toMatch(/^R\$\s1\.234,56$/);
    expect(out.monthsUsed).toBe(3);
    expect((out.items as Record<string, unknown>[])[0].amount).toMatch(/^R\$\s10,00$/);
  });
});
