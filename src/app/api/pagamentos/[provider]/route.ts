import { getDb } from "@/lib/db";
import { getBillingProvider } from "@/lib/billing";
import { applyPaymentEvent } from "@/data/subscriptions";

/**
 * Webhook do gateway. Só o gateway configurado é aceito, e só com assinatura válida; cada evento
 * é aplicado uma única vez (reenvios respondem 200 sem repetir nada).
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await params;
  const provider = getBillingProvider();
  if (!provider || provider.id !== name) return new Response("not found", { status: 404 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  const events = await provider.parseWebhook(request, raw);
  if (!events) return new Response("unauthorized", { status: 401 });
  try {
    for (const event of events) await applyPaymentEvent(getDb(), event);
    return new Response("ok");
  } catch (err) {
    console.error("pagamentos: falha ao aplicar evento", err instanceof Error ? err.message : err);
    return new Response("error", { status: 500 }); // o gateway reenvia
  }
}
