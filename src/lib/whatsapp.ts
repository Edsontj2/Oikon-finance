import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Platform (Cloud API oficial da Meta). Variáveis de ambiente:
 *   WHATSAPP_VERIFY_TOKEN      texto livre escolhido por você, igual ao do painel da Meta (verificação do webhook)
 *   WHATSAPP_APP_SECRET        "Chave secreta do app" (assina cada chamada do webhook)
 *   WHATSAPP_TOKEN             token de acesso do sistema (envio de mensagens)
 *   WHATSAPP_PHONE_NUMBER_ID   id do número do WhatsApp Business que envia as respostas
 *   WHATSAPP_API_VERSION       opcional, padrão v21.0
 */
export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Confere o cabeçalho X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com a chave do app). */
export function verifySignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type InboundMessage = { id: string; from: string; text: string | null; type: string };

/** Mensagens recebidas no corpo do webhook (status de entrega e outros eventos são ignorados). */
export function extractMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of (entry as { changes?: unknown[] })?.changes ?? []) {
      const value = (change as { value?: { messages?: unknown[] } })?.value;
      for (const m of value?.messages ?? []) {
        const msg = m as { id?: unknown; from?: unknown; type?: unknown; text?: { body?: unknown } };
        if (typeof msg.id !== "string" || typeof msg.from !== "string") continue;
        out.push({
          id: msg.id.slice(0, 200),
          from: msg.from.replace(/\D/g, "").slice(0, 15),
          type: typeof msg.type === "string" ? msg.type : "unknown",
          text: msg.type === "text" && typeof msg.text?.body === "string" ? msg.text.body : null,
        });
      }
    }
  }
  return out;
}

/** Envia texto para o número (dentro da janela de atendimento aberta pela mensagem da pessoa). */
export async function sendText(to: string, body: string): Promise<boolean> {
  try {
    return await postText(to, body);
  } catch (err) {
    console.error("whatsapp: falha ao enviar", err instanceof Error ? err.message : err);
    return false;
  }
}

async function postText(to: string, body: string): Promise<boolean> {
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const base = process.env.WHATSAPP_API_BASE || "https://graph.facebook.com";
  const res = await fetch(`${base}/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4096), preview_url: false } }),
  });
  if (!res.ok) console.error("whatsapp: falha ao enviar", res.status, (await res.text()).slice(0, 300));
  return res.ok;
}
