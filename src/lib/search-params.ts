import { currentMonth, isValidMonth } from "./dates";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Params = Record<string, string | string[] | undefined>;

/** Primeiro valor de um parâmetro da URL. */
export function param(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Mês da URL (?mes=AAAA-MM) ou o mês atual quando ausente/inválido. */
export function monthParam(params: Params): string {
  const mes = param(params, "mes");
  return mes && isValidMonth(mes) ? mes : currentMonth();
}

/** Monta "/caminho?a=1&b=2", ignorando valores vazios. */
export function withParams(path: string, values: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
