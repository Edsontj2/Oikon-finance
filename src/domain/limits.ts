import { UserError } from "@/data/errors";

/** Tamanhos máximos; os mesmos limites existem no banco (migração 0002) e nos campos da tela. */
export const LIMITS = {
  userName: 80,
  email: 254,
  passwordMin: 8,
  /** O bcrypt só usa os primeiros 72 bytes da senha. */
  passwordMaxBytes: 72,
  accountName: 60,
  categoryName: 60,
  description: 120,
  /** Maior valor aceito em qualquer campo de dinheiro: R$ 1 bilhão, em centavos. */
  maxCents: 100_000_000_000,
} as const;

/** Valor em centavos inteiro e dentro do limite (em módulo). */
export function isValidCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= LIMITS.maxCents;
}

export const TOO_BIG = "Valor alto demais: o máximo é R$ 1 bilhão.";

/** Texto obrigatório, sem espaços nas pontas e dentro do limite. */
export function requiredText(value: unknown, max: number, emptyMessage: string, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new UserError(emptyMessage);
  if (text.length > max) throw new UserError(`${label} pode ter no máximo ${max} caracteres.`);
  return text;
}
