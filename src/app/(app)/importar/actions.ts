"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { UserError } from "@/data/errors";
import { applyImport, previewImport, type ImportDecision, type ImportPreviewLine } from "@/data/statement-import";
import type { StatementLine } from "@/domain/statement";

export type PreviewResult = { ok: true; lines: ImportPreviewLine[] } | { ok: false; message: string };
export type ApplyResult = { ok: boolean; message: string };

export async function previewStatement(accountId: string, lines: StatementLine[]): Promise<PreviewResult> {
  const userId = await requireUserId();
  try {
    return { ok: true, lines: await previewImport(getDb(), userId, accountId, Array.isArray(lines) ? lines : []) };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, message: err.message };
    console.error(err);
    return { ok: false, message: "Não foi possível conferir o extrato agora. Tente de novo." };
  }
}

export async function importStatement(accountId: string, decisions: ImportDecision[]): Promise<ApplyResult> {
  const userId = await requireUserId();
  try {
    const r = await applyImport(getDb(), userId, accountId, Array.isArray(decisions) ? decisions : []);
    revalidatePath("/", "layout");
    const parts = [
      r.created && `${r.created} lançado${r.created > 1 ? "s" : ""}`,
      r.reconciled && `${r.reconciled} pendente${r.reconciled > 1 ? "s" : ""} marcado${r.reconciled > 1 ? "s" : ""} como pago${r.reconciled > 1 ? "s" : ""}`,
    ].filter(Boolean);
    return { ok: true, message: parts.length ? `Extrato importado: ${parts.join(", ")}.` : "Nada novo para importar." };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, message: err.message };
    console.error(err);
    return { ok: false, message: "Não foi possível importar agora. Tente de novo." };
  }
}
