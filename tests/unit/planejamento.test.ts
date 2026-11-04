import { describe, expect, it } from "vitest";
import { emergencyTarget, goalProgress, monthsBetween, reachDate } from "@/domain/goals";
import { buildForecast } from "@/domain/forecast";
import { groupCategories, sortedCategoryOptions, type Category } from "@/domain/categories";

describe("metas", () => {
  it("quanto guardar por mês até a data e se está no ritmo", () => {
    const p = goalProgress({ target: 1_200_000, saved: 300_000, targetDate: "2027-10-31", createdAt: "2026-11-01", today: "2026-11-04" });
    expect(p.monthsLeft).toBe(12);
    expect(p.monthlyNeeded).toBe(75_000);
    expect(p.percent).toBe(25);
    expect(p.status).toBe("on_track");
    const atrasada = goalProgress({ target: 1_200_000, saved: 100_000, targetDate: "2027-05-31", createdAt: "2026-05-01", today: "2026-11-04" });
    expect(atrasada.status).toBe("behind");
    expect(goalProgress({ target: 100, saved: 150, targetDate: null, createdAt: "2026-01-01", today: "2026-11-04" })).toMatchObject({ status: "done", percent: 100, remaining: 0 });
    expect(goalProgress({ target: 100, saved: 10, targetDate: "2026-10-01", createdAt: "2026-01-01", today: "2026-11-04" }).status).toBe("late");
    expect(goalProgress({ target: 100, saved: 10, targetDate: null, createdAt: "2026-01-01", today: "2026-11-04" }).status).toBe("no_date");
  });

  it("reserva sugerida, meses entre datas e data para chegar lá", () => {
    expect(emergencyTarget(345_678, 6)).toBe(2_080_000); // 20.740,68 → arredonda para cima em R$ 100
    expect(monthsBetween("2026-11-04", "2026-11-30")).toBe(1);
    expect(monthsBetween("2026-11-04", "2027-01-01")).toBe(3);
    expect(reachDate(100_000, 30_000, "2026-11-04")).toBe("2027-03-04");
    expect(reachDate(100_000, 0, "2026-11-04")).toBeNull();
  });
});

describe("previsão de saldo", () => {
  it("acumula por dia, atrasado entra hoje e avisa quando fica negativo", () => {
    const f = buildForecast("2026-11-04", 100_000, [
      { date: "2026-10-30", delta: -20_000, source: "pending" },
      { date: "2026-11-10", delta: 300_000, source: "pending" },
      { date: "2026-11-08", delta: -150_000, source: "invoice" },
      { date: "2027-03-01", delta: -999_999, source: "recurring" }, // depois de 90 dias: fora
    ]);
    expect(f.daily[0].balance).toBe(80_000);
    expect(f.overdue).toEqual({ inflow: 0, outflow: 20_000 });
    expect(f.points.map((p) => p.days)).toEqual([7, 15, 30, 60, 90]);
    expect(f.points[0]).toMatchObject({ date: "2026-11-11", balance: 230_000, inflow: 300_000, outflow: 170_000 });
    expect(f.firstNegative).toBe("2026-11-08");
    expect(f.lowest).toEqual({ date: "2026-11-08", balance: -70_000 });
    expect(f.points[4].balance).toBe(230_000);
  });
});

describe("subcategorias", () => {
  const cat = (id: string, name: string, parentId: string | null, paid: number, limit: number | null = null): Category => ({
    id, name, kind: "expense", parentId, monthlyLimit: limit, paidTotal: paid, pendingTotal: 0, monthTotal: paid,
  });
  it("agrupa embaixo da principal e soma no grupo", () => {
    const groups = groupCategories([cat("a", "Alimentação", null, 100, 500), cat("b", "Restaurante", "a", 250), cat("c", "Mercado", "a", 50), cat("d", "Lazer", null, 10)]);
    expect(groups.map((g) => g.name)).toEqual(["Alimentação", "Lazer"]);
    expect(groups[0].group.monthTotal).toBe(400);
    expect(groups[0].children.map((c) => c.name)).toEqual(["Restaurante", "Mercado"]);
  });
  it("lista de escolha: principal seguida das filhas com rótulo", () => {
    const list = sortedCategoryOptions([
      { id: "b", name: "Restaurante", kind: "expense", parentId: "a" },
      { id: "z", name: "Casa", kind: "expense", parentId: null },
      { id: "a", name: "Alimentação", kind: "expense", parentId: null },
    ]);
    expect(list.map((c) => c.label)).toEqual(["Alimentação", "Alimentação › Restaurante", "Casa"]);
  });
});
