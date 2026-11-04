import { after, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { extractMessages, sendText, verifySignature } from "@/lib/whatsapp";
import { handleIncomingMessage } from "@/data/assistant/conversation";

export const dynamic = "force-dynamic";

/** Verificação do webhook pela Meta: devolve o desafio se o token combinar. */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Mensagens recebidas. Responde 200 na hora (a Meta reenvia se demorar) e processa depois;
 * a mesma mensagem reenviada é reconhecida pelo id e não é tratada duas vezes.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 256_000) return new Response("Payload too large", { status: 413 });
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const messages = extractMessages(payload);
  after(async () => {
    for (const m of messages) {
      const text = m.text ?? "";
      const result = await handleIncomingMessage(getDb(), { id: m.id, phone: m.from, text: m.text === null ? `[${m.type}]` : text });
      const reply = m.text === null && !result.duplicate ? "Por enquanto eu entendo só mensagens de texto. 🙂" : result.reply;
      if (reply) await sendText(m.from, reply);
    }
  });
  return new Response("OK", { status: 200 });
}
