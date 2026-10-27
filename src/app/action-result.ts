import { revalidatePath } from "next/cache";
import { UserError } from "@/data/errors";
import { parseMoney } from "@/lib/money";

/** O que toda ação devolve para a tela: deu certo (com aviso) ou a mensagem do erro. */
export type ActionResult = { ok: boolean; message: string };

/**
 * Roda a ação, atualiza as telas e devolve o resultado. Erros de validação viram mensagem;
 * erros inesperados são registrados no servidor e viram uma mensagem genérica.
 */
export async function runAction(successMessage: string, action: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await action();
  } catch (err) {
    if (err instanceof UserError) return { ok: false, message: err.message };
    console.error(err);
    return { ok: false, message: "Não foi possível concluir agora. Tente de novo." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: successMessage };
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Valor em reais digitado → centavos. Vazio vira `null` quando o campo é opcional. */
export function moneyField(form: FormData, name: string, label: string, optional = false): number | null {
  const text = field(form, name).trim();
  if (!text && optional) return null;
  const cents = parseMoney(text);
  if (cents === null) throw new UserError(`${label} inválido. Use, por exemplo, 1.234,56.`);
  return cents;
}

/** Número inteiro digitado (aceita só dígitos: "1e1" ou "2.5" não passam). */
export function wholeNumberField(form: FormData, name: string, fallback: number): number {
  const text = field(form, name).trim();
  if (!text) return fallback;
  return /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
}
