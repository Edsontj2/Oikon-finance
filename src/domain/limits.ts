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
} as const;

/** Texto obrigatório, sem espaços nas pontas e dentro do limite. */
export function requiredText(value: unknown, max: number, emptyMessage: string, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new UserError(emptyMessage);
  if (text.length > max) throw new UserError(`${label} pode ter no máximo ${max} caracteres.`);
  return text;
}
