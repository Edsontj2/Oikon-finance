/**
 * Gateway de pagamento, desacoplado. O resto do app só conhece esta interface: o gateway cria o
 * pagamento (com a nossa assinatura como referência) e, pelo webhook, devolve eventos já
 * conferidos, que src/data/subscriptions.ts aplica de forma idempotente.
 *
 * Nenhum gateway está ligado ainda: getBillingProvider() devolve null e o app não mostra botão de
 * pagar. Para ativar, implemente um adaptador (ex.: Mercado Pago, Stripe, Asaas, Pagar.me) e
 * configure BILLING_PROVIDER e as chaves dele na Vercel. Ver docs/assinaturas.md.
 */
import type { PaymentEvent } from "@/data/subscriptions";

export type CheckoutInput = { subscriptionId: string; planName: string; amountCents: number; customerEmail: string; returnUrl: string };

export interface BillingProvider {
  readonly id: string;
  /** Cria o pagamento recorrente e devolve o endereço para a pessoa pagar. */
  createCheckout(input: CheckoutInput): Promise<{ url: string; providerRef?: string }>;
  /** Confere a assinatura do webhook; null = requisição não autêntica (responder 401). */
  parseWebhook(request: Request, rawBody: string): Promise<PaymentEvent[] | null>;
}

const adapters: Record<string, () => BillingProvider> = {
  // Nenhum adaptador implementado ainda.
};

export function getBillingProvider(): BillingProvider | null {
  const id = process.env.BILLING_PROVIDER?.trim();
  if (!id || !adapters[id]) return null;
  return adapters[id]();
}
