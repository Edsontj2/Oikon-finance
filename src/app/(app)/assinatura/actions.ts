"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { getBillingProvider } from "@/lib/billing";
import { UserError } from "@/data/errors";
import { cancelSubscription, resumeSubscription, scheduleDowngrade, startCheckout, startTrial } from "@/data/subscriptions";
import { runAction, type ActionResult } from "../../action-result";

export async function startTrialAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Teste grátis iniciado. Aproveite!", () => startTrial(getDb(), userId));
}

/** Contratar: só existe com gateway configurado; a assinatura ativa quando o gateway confirmar. */
export async function checkoutAction(planId: string, launchOffer: boolean): Promise<ActionResult | undefined> {
  const userId = await requireUserId();
  const provider = getBillingProvider();
  if (!provider) return { ok: false, message: "O pagamento online ainda não está disponível." };
  let url: string;
  try {
    const db = getDb();
    const { subscription } = await startCheckout(db, userId, planId, new Date(), { launchOffer });
    const { rows } = await db.query("SELECT u.email, p.name FROM users u, plans p WHERE u.id = $1 AND p.id = $2", [userId, planId]);
    const host = (await headers()).get("host");
    const checkout = await provider.createCheckout({
      subscriptionId: subscription.id, planName: rows[0].name, amountCents: subscription.priceCents, customerEmail: rows[0].email,
      returnUrl: `https://${host}/assinatura`,
    });
    if (checkout.providerRef) {
      await db.query("UPDATE subscriptions SET provider = $2, provider_ref = $3 WHERE id = $1", [subscription.id, provider.id, checkout.providerRef]);
    }
    url = checkout.url;
  } catch (err) {
    if (err instanceof UserError) return { ok: false, message: err.message };
    console.error("assinatura: falha ao iniciar pagamento", err instanceof Error ? err.message : err);
    return { ok: false, message: "Não foi possível abrir o pagamento agora. Tente de novo." };
  }
  redirect(url);
}

export async function cancelAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Cancelamento registrado.", () => cancelSubscription(getDb(), userId));
}

export async function resumeAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Cancelamento desfeito.", () => resumeSubscription(getDb(), userId));
}

export async function downgradeAction(planId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  return runAction("Troca agendada para o fim do período.", () => scheduleDowngrade(getDb(), userId, planId));
}
