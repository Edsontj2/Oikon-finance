import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "@/lib/money";

describe("parseMoney (texto digitado -> centavos)", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1234,5", 123450],
    ["1234,", 123400],
    ["0,01", 1],
    ["10", 1000],
    ["1.000.000", 100000000],
    ["1234.56", 123456],
    ["1.5", 150],
    ["R$ 2.500,00", 250000],
    ["  99,90 ", 9990],
    ["-350,00", -35000],
    ["0", 0],
  ])("%s -> %i", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each(["", "abc", "1,234", "12,345", "1.23.4", "1,2,3", "--5", "1e5", "R$", "12.345,6.7"])(
    "rejeita %j",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );
});

describe("formatMoney", () => {
  it("formata em reais", () => {
    expect(formatMoney(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(formatMoney(-500).replace(/\s/g, " ")).toBe("-R$ 5,00");
    expect(formatMoney(0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
});
