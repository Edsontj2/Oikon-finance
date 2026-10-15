import { describe, expect, it } from "vitest";
import {
  addMonths, currentMonth, formatDate, formatMonth, isValidDate, isValidMonth, monthRange, shiftMonth, today,
} from "@/lib/dates";
import { seriesDates } from "@/data/transactions";

describe("datas", () => {
  it("usa o fuso de São Paulo para 'hoje'", () => {
    // 02:00 UTC de 1º de novembro ainda é 31 de outubro em São Paulo (UTC-3).
    expect(today(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(currentMonth(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10");
    expect(today(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
  });

  it("intervalo do mês com fim exclusivo, inclusive na virada do ano", () => {
    expect(monthRange("2026-10")).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("anda meses para frente e para trás", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-05", 14)).toBe("2027-07");
  });

  it("soma meses usando o último dia quando o dia não existe", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("gera as datas de 'repetir todo mês' sem acumular o corte do dia 31", () => {
    expect(seriesDates("2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(seriesDates("2026-10-10", 1)).toEqual(["2026-10-10"]);
  });

  it("valida datas e meses", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("15/10/2026")).toBe(false);
    expect(isValidMonth("2026-10")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
  });

  it("formata para exibição", () => {
    expect(formatDate("2026-10-05")).toBe("05/10/2026");
    expect(formatMonth("2026-03")).toBe("março de 2026");
  });
});
