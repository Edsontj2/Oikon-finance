import { redirect } from "next/navigation";
import { UserError } from "@/data/errors";

/** Só aceita caminhos internos ("/lancamentos?mes=..."), nunca outro site. */
export function safeReturnPath(value: FormDataEntryValue | null, fallback: string): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : fallback;
}

export function withMessage(path: string, key: "erro" | "ok", message: string): string {
  const url = new URL(path, "http://x");
  url.searchParams.delete("erro");
  url.searchParams.delete("ok");
  url.searchParams.set(key, message);
  return url.pathname + url.search;
}

/**
 * Roda a ação e volta para a página com a mensagem de sucesso, ou com a mensagem
 * de erro quando ela é um UserError. Outros erros sobem normalmente.
 */
export async function runAction(back: string, ok: string, action: () => Promise<unknown>): Promise<never> {
  try {
    await action();
  } catch (err) {
    if (err instanceof UserError) redirect(withMessage(back, "erro", err.message));
    throw err;
  }
  redirect(withMessage(back, "ok", ok));
}

export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}
