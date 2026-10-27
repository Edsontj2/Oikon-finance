import { describe, expect, it } from "vitest";
import { field, moneyField, wholeNumberField } from "@/app/action-result";
import { signedAmount } from "@/domain/transactions";
import { isAccountType } from "@/domain/accounts";
import { isCategoryKind } from "@/domain/categories";
import { isTransactionType } from "@/domain/transactions";
import { monthParam, withParams } from "@/lib/search-params";
import { signSession, verifySession } from "@/lib/session";

describe("withParams", () => {
  it("monta a URL ignorando vazios e escapando valores", () => {
    expect(withParams("/lancamentos", { mes: "2026-10", conta: undefined, busca: "pão & café" })).toBe(
      "/lancamentos?mes=2026-10&busca=p%C3%A3o+%26+caf%C3%A9",
    );
    expect(withParams("/", {})).toBe("/");
  });
});

describe("monthParam", () => {
  it("aceita mês válido e cai no mês atual quando inválido", () => {
    expect(monthParam({ mes: "2026-03" })).toBe("2026-03");
    for (const mes of ["0000-01", "2026-13", "abc", "10000-01", "2026-1"]) {
      expect(monthParam({ mes })).toMatch(/^\d{4}-\d{2}$/);
      expect(monthParam({ mes })).not.toBe(mes);
    }
  });
});

describe("campos de formulário", () => {
  const form = (values: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  };
  it("repetir aceita só dígitos ('1e1' e '2.5' não viram número)", () => {
    expect(wholeNumberField(form({ r: "12" }), "r", 1)).toBe(12);
    expect(wholeNumberField(form({ r: "" }), "r", 1)).toBe(1);
    expect(wholeNumberField(form({ r: "1e1" }), "r", 1)).toBeNaN();
    expect(wholeNumberField(form({ r: "2.5" }), "r", 1)).toBeNaN();
  });
  it("valor em reais: obrigatório, opcional e inválido", () => {
    expect(moneyField(form({ v: "1.234,56" }), "v", "Valor")).toBe(123456);
    expect(moneyField(form({ v: "" }), "v", "Limite", true)).toBeNull();
    expect(() => moneyField(form({ v: "abc" }), "v", "Valor")).toThrow("Valor inválido");
    expect(field(form({}), "nada")).toBe("");
  });
});

describe("tipos vindos do formulário", () => {
  it("só aceitam valores conhecidos (nada de 'constructor' ou 'toString')", () => {
    for (const bad of ["constructor", "toString", "__proto__", "hasOwnProperty", "", undefined, 1]) {
      expect(isTransactionType(bad)).toBe(false);
      expect(isAccountType(bad)).toBe(false);
      expect(isCategoryKind(bad)).toBe(false);
    }
    expect(isTransactionType("transfer")).toBe(true);
    expect(isAccountType("credit_card")).toBe(true);
    expect(isCategoryKind("income")).toBe(true);
  });
});

describe("signedAmount", () => {
  it("entrada positiva, saída negativa, transferência sem sinal", () => {
    expect(signedAmount({ type: "income", amount: 100 })).toBe(100);
    expect(signedAmount({ type: "expense", amount: 100 })).toBe(-100);
    expect(signedAmount({ type: "transfer", amount: 100 })).toBe(100);
  });
});

describe("sessão", () => {
  it("assina e valida o token; rejeita token alterado", async () => {
    const session = { userId: "11111111-1111-1111-1111-111111111111", sessionId: "22222222-2222-2222-2222-222222222222" };
    const token = await signSession(session);
    expect(await verifySession(token)).toEqual(session);
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("lixo")).toBeNull();
  });
});
