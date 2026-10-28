import { describe, expect, it } from "vitest";
import { installmentPlan } from "@/domain/transactions";
import { monthPace } from "@/domain/pace";

describe("compra parcelada", () => {
  it("divide o total e a 1ª parcela leva os centavos que sobram; a soma é exata", () => {
    const p = installmentPlan("2026-10-28", 3, 10000, true);
    expect(p.amounts).toEqual([3334, 3333, 3333]);
    expect(p.amounts.reduce((s, a) => s + a, 0)).toBe(10000);
    expect(p.dates).toEqual(["2026-10-28", "2026-11-28", "2026-12-28"]);
    expect(p.lastDate).toBe("2026-12-28");
  });

  it("com valor por parcela, todas iguais e o total é n × parcela", () => {
    expect(installmentPlan("2026-10-10", 10, 12000, false).amounts).toEqual(Array(10).fill(12000));
  });

  it("reconhece o mês em que termina, atravessando o ano e meses curtos", () => {
    expect(installmentPlan("2026-01-31", 12, 1200, true).lastDate).toBe("2026-12-31");
    expect(installmentPlan("2026-01-31", 2, 100, true).dates).toEqual(["2026-01-31", "2026-02-28"]);
    expect(installmentPlan("2026-11-15", 10, 1000, true).lastDate).toBe("2027-08-15");
  });
});

describe("ritmo do mês", () => {
  it("média por dia, sobra e quanto dá para gastar por dia até o fim do mês", () => {
    const p = monthPace("2026-10-28", { income: 500000, expense: 280000, pendingIncome: 0, pendingExpense: 20000 });
    expect(p).toMatchObject({ dayOfMonth: 28, daysInMonth: 31, daysLeft: 4, dailyAverage: 10000, monthLeftover: 200000 });
    expect(p.perDayAvailable).toBe(50000);
    expect(p.savingsRate).toBeCloseTo(0.44);
  });

  it("mês que já fecha no negativo: zero por dia e sem taxa sem entradas", () => {
    const p = monthPace("2026-02-01", { income: 0, expense: 1000, pendingIncome: 0, pendingExpense: 0 });
    expect(p).toMatchObject({ daysInMonth: 28, daysLeft: 28, perDayAvailable: 0, monthLeftover: -1000, savingsRate: null });
  });
});
