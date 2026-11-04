"use server";

import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { createLinkCode, unlink, updateLinkSettings } from "@/data/assistant/link";
import { field, runAction, type ActionResult } from "../../action-result";

export async function createWhatsappCode(): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; message: string }> {
  const userId = await requireUserId();
  try {
    return { ok: true, ...(await createLinkCode(getDb(), userId)) };
  } catch (err) {
    console.error(err);
    return { ok: false, message: "Não foi possível gerar o código agora. Tente de novo." };
  }
}

export async function saveWhatsappSettings(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Configurações do WhatsApp salvas.", () =>
    updateLinkSettings(getDb(), userId, {
      status: form.get("active") === "on" ? "active" : "paused",
      defaultAccountId: field(form, "defaultAccountId") || null,
      allowEntries: form.get("allowEntries") === "on",
    }),
  );
}

export async function unlinkWhatsapp(): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("WhatsApp desvinculado.", () => unlink(getDb(), userId));
}
