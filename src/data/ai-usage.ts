/**
 * Franquia mensal de IA, compartilhada entre app e WhatsApp. Cada interação é reservada antes de
 * chamar o modelo, num único comando atômico que nunca passa do limite (duas mensagens ao mesmo
 * tempo não estouram a franquia). Tokens e custo estimado são somados depois da resposta.
 * Nada do conteúdo das conversas é guardado aqui: só contagens.
 */
import { num, type Db } from "@/lib/db";
import { usagePeriod } from "@/domain/plans";

export type AiChannel = "app" | "whatsapp";

/** Reserva uma interação. Devolve quantas já foram usadas no mês, ou null se a franquia acabou. */
export async function consumeAiInteraction(db: Db, userId: string, channel: AiChannel, quota: number, now = new Date()): Promise<number | null> {
  if (!Number.isInteger(quota) || quota <= 0) return null;
  const col = channel === "app" ? "app_count" : "whatsapp_count";
  const { rows } = await db.query(
    `INSERT INTO ai_usage (user_id, period, interactions, ${col}) VALUES ($1, $2, 1, 1)
     ON CONFLICT (user_id, period) DO UPDATE
       SET interactions = ai_usage.interactions + 1, ${col} = ai_usage.${col} + 1, updated_at = now()
       WHERE ai_usage.interactions < $3
     RETURNING interactions`,
    [userId, usagePeriod(now), quota],
  );
  return rows[0] ? num(rows[0].interactions) : null;
}

/** Devolve a interação reservada quando o modelo falhou (a pessoa não paga pelo erro). */
export async function refundAiInteraction(db: Db, userId: string, channel: AiChannel, now = new Date()): Promise<void> {
  const col = channel === "app" ? "app_count" : "whatsapp_count";
  await db.query(
    `UPDATE ai_usage SET interactions = GREATEST(interactions - 1, 0), ${col} = GREATEST(${col} - 1, 0), updated_at = now()
      WHERE user_id = $1 AND period = $2`,
    [userId, usagePeriod(now)],
  );
}

export async function recordAiCost(db: Db, userId: string, tokens: { input: number; output: number; costMicros: number }, now = new Date()): Promise<void> {
  const ok = (v: number) => Number.isSafeInteger(v) && v >= 0;
  if (!ok(tokens.input) || !ok(tokens.output) || !ok(tokens.costMicros)) return;
  await db.query(
    `UPDATE ai_usage SET input_tokens = input_tokens + $3, output_tokens = output_tokens + $4, cost_micros = cost_micros + $5, updated_at = now()
      WHERE user_id = $1 AND period = $2`,
    [userId, usagePeriod(now), tokens.input, tokens.output, tokens.costMicros],
  );
}

export async function aiUsage(db: Db, userId: string, now = new Date()) {
  const { rows } = await db.query("SELECT interactions, app_count, whatsapp_count FROM ai_usage WHERE user_id = $1 AND period = $2", [userId, usagePeriod(now)]);
  const r = rows[0];
  return { interactions: num(r?.interactions), app: num(r?.app_count), whatsapp: num(r?.whatsapp_count) };
}
