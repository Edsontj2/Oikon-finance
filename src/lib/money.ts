const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 -> "R$ 1.234,56" */
export function formatMoney(cents: number): string {
  return brl.format(cents / 100);
}

/**
 * Converte texto digitado em centavos. Aceita "1.234,56", "1234,5", "1234.56", "R$ 10", "-50".
 * Devolve null se o texto não for um valor válido.
 */
export function parseMoney(input: string): number | null {
  let s = input.replace(/R\$/gi, "").replace(/\s/g, "");
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  if (!s) return null;

  let intPart: string;
  let decPart = "";
  if (s.includes(",")) {
    // Formato brasileiro: ponto é milhar, vírgula é decimal.
    if (!/^\d{1,3}(\.\d{3})*(,\d{0,2})?$|^\d+(,\d{0,2})?$/.test(s)) return null;
    [intPart, decPart = ""] = s.split(",");
    intPart = intPart.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    // "1234.56": ponto como decimal.
    [intPart, decPart] = s.split(".");
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    intPart = s.replace(/\./g, "");
  } else {
    return null;
  }

  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(cents)) return null;
  return sign * cents;
}
