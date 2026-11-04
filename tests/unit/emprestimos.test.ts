import { describe, expect, it } from "vitest";
import { loanInputError, loanSchedule, payoffEstimate } from "@/domain/loans";

describe("simulação de empréstimo", () => {
  it("Price: parcelas iguais e soma das amortizações = valor emprestado", () => {
    const s = loanSchedule(1_000_000, 2, 12, "2026-12-10", "price");
    const amounts = new Set(s.installments.slice(0, -1).map((p) => p.amount));
    expect(amounts.size).toBe(1);
    expect([...amounts][0]).toBe(94560); // R$ 945,60 (PMT de 10 mil a 2% em 12x)
    expect(s.installments.reduce((t, p) => t + p.principal, 0)).toBe(1_000_000);
    expect(s.installments.at(-1)!.balance).toBe(0);
    expect(s.totalInterest).toBe(s.totalPaid - 1_000_000);
    expect(s.installments[1].date).toBe("2027-01-10");
    expect(s.yearlyRate).toBe(26.82);
  });

  it("SAC: amortização igual e parcelas decrescentes", () => {
    const s = loanSchedule(1_200_000, 1, 12, "2026-12-10", "sac");
    expect(s.installments.every((p) => p.principal === 100_000)).toBe(true);
    expect(s.installments[0].amount).toBe(112_000);
    expect(s.installments[11].amount).toBe(101_000);
    expect(s.installments[0].amount).toBeGreaterThan(s.installments[11].amount);
  });

  it("sem juros divide igual; quitação antecipada economiza os juros que faltam", () => {
    const zero = loanSchedule(100_000, 0, 3, "2026-12-01", "price");
    expect(zero.installments.map((p) => p.amount)).toEqual([33333, 33333, 33334]);
    const s = loanSchedule(1_000_000, 2, 12, "2026-12-10", "price");
    const p = payoffEstimate(s, 4);
    expect(p.remainingPrincipal).toBe(s.installments[3].balance);
    expect(p.interestSaved).toBe(s.installments.slice(4).reduce((t, x) => t + x.interest, 0));
  });

  it("valida taxa absurda e parcelas", () => {
    expect(loanInputError(100, 25.5 * 2, 10)).toContain("confira");
    expect(loanInputError(0, 1, 10)).toContain("maior que zero");
    expect(loanInputError(100, 1, 0)).toContain("Parcelas");
    expect(loanInputError(100, 1.99, 24)).toBeNull();
  });
});
