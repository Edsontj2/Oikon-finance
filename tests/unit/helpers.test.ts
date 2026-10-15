import { describe, expect, it } from "vitest";
import { safeReturnPath, withMessage } from "@/app/actions-helpers";
import { signedAmount } from "@/app/(app)/lancamentos/amount";
import { signSession, verifySession } from "@/lib/session";

describe("safeReturnPath", () => {
  it("aceita só caminhos internos", () => {
    expect(safeReturnPath("/lancamentos?mes=2026-10", "/")).toBe("/lancamentos?mes=2026-10");
    expect(safeReturnPath("https://site-malicioso.com", "/")).toBe("/");
    expect(safeReturnPath("//site-malicioso.com", "/")).toBe("/");
    expect(safeReturnPath("/\\site-malicioso.com", "/")).toBe("/");
    expect(safeReturnPath(null, "/x")).toBe("/x");
  });
});

describe("withMessage", () => {
  it("troca a mensagem anterior e mantém os outros parâmetros", () => {
    expect(withMessage("/lancamentos?mes=2026-10&erro=velho", "ok", "Salvo.")).toBe(
      "/lancamentos?mes=2026-10&ok=Salvo.",
    );
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
    const token = await signSession("11111111-1111-1111-1111-111111111111");
    expect(await verifySession(token)).toBe("11111111-1111-1111-1111-111111111111");
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("lixo")).toBeNull();
  });
});
