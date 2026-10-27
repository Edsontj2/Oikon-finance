import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { formatMoney, parseMoney } from "@/lib/money";
import { verifySession } from "@/lib/session";
import { currentMonth, today, addMonths } from "@/lib/dates";
import { seriesDates, MAX_REPEAT } from "@/data/transactions";

describe("parseMoney - casos que faltavam", () => {
  it.each([
    ["1.234.567,89", 123456789],
    ["R$-5", -500],
    ["-R$ 5,00", -500],
    ["R$ 1 234,56", 123456],
    ["90071992547409,91", Number.MAX_SAFE_INTEGER],
    ["1.234", 123400],
    ["1.23", 123],
  ])("%j -> %i", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each([" ", "   ", "R$ ", "-", "R$-", "90071992547409,92", "99999999999999999999", "1.2345", "+-5", "5-", ",50", "1,2.3"])(
    "rejeita %j",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );

  it("'-0' e '-0,00' viram 0 (não -0, que o Intl mostra como '-R$ 0,00')", () => {
    expect(parseMoney("-0")).toBe(0);
    expect(parseMoney("-0,00")).toBe(0);
  });

  it("formatMoney de centavo e de -0", () => {
    expect(formatMoney(1).replace(/\s/g, " ")).toBe("R$ 0,01");
    expect(formatMoney(-1).replace(/\s/g, " ")).toBe("-R$ 0,01");
    expect(formatMoney(-0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
});

describe("datas - virada de ano e fuso SP", () => {
  it("31/12 23:30 em SP ainda é dezembro (UTC já é janeiro)", () => {
    const now = new Date("2027-01-01T02:30:00Z");
    expect(today(now)).toBe("2026-12-31");
    expect(currentMonth(now)).toBe("2026-12");
  });

  it("repetir 60 meses a partir de 31/01 termina em 31/12/2030 e respeita fevereiro bissexto", () => {
    const d = seriesDates("2026-01-31", MAX_REPEAT);
    expect(d).toHaveLength(60);
    expect(d[0]).toBe("2026-01-31");
    expect(d[25]).toBe("2028-02-29");
    expect(d[59]).toBe("2030-12-31");
    expect(new Set(d).size).toBe(60);
  });

  it("29/02 + 12 meses = 28/02 do ano seguinte", () => {
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
  });
});

describe("sessão - tokens forjados/expirados", () => {
  const key = new TextEncoder().encode(process.env.AUTH_SECRET!);

  it("rejeita token expirado", async () => {
    const t = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
    expect(await verifySession(t)).toBeNull();
  });

  it("rejeita token assinado com outro segredo", async () => {
    const t = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setExpirationTime("1d")
      .sign(new TextEncoder().encode("outro-segredo-qualquer-com-mais-de-32-chars"));
    expect(await verifySession(t)).toBeNull();
  });

  it("rejeita alg none", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "u1", exp: 9999999999 })}.`;
    expect(await verifySession(t)).toBeNull();
  });
});
