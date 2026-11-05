/**
 * Assinaturas: teste grátis, contratação, pagamento, renovação, inadimplência, cancelamento,
 * troca de plano e a oferta de lançamento. Tudo é decidido aqui no servidor: uma assinatura só
 * fica ativa com um evento de pagamento confirmado pelo gateway (ou concessão manual do admin),
 * nunca porque a tela disse que pagou.
 *
 * Regras da oferta de lançamento (R$ 19,90 no Inteligente, primeiras 100 vagas):
 *  - a vaga é reservada ao iniciar a contratação e fica segura por `checkout_hours`; sem pagamento
 *    nesse prazo, a contratação expira e a vaga volta;
 *  - o preço com desconto vale enquanto a assinatura existir: renovações, atraso dentro da
 *    tolerância e cancelamento agendado (até o fim do período) mantêm o desconto;
 *  - a vaga é perdida quando a assinatura termina (cancelada no fim do período, expirada por falta
 *    de pagamento além da tolerância ou trocada por outro plano); ela volta para a oferta;
 *  - quem perdeu a vaga e assina de novo paga o preço normal, a não ser que reserve outra vaga livre.
 */
import type { Pool } from "pg";
import { inTransaction, num, type Db } from "@/lib/db";
import { ALL_FEATURES, PLAN_FEATURES, PLAN_RANK, addDays, addMonth, isPlanId, usagePeriod, type Feature, type PlanId } from "@/domain/plans";
import { UserError, pgCode } from "./errors";

export type Plan = { id: PlanId; name: string; priceCents: number; aiQuota: number; active: boolean };
export type SubscriptionStatus = "trialing" | "pending" | "active" | "past_due" | "canceled" | "expired";
export type Subscription = {
  id: string;
  planId: PlanId;
  status: SubscriptionStatus;
  trial: boolean;
  priceCents: number;
  launchOffer: boolean;
  periodStart: string;
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: PlanId | null;
  pastDueSince: string | null;
};
export type LaunchOffer = { enabled: boolean; planId: PlanId; priceCents: number; slotLimit: number; claimed: number; available: number };

// ---------- Configurações ----------

export type Settings = {
  billingEnforced: boolean;
  plansPublic: boolean;
  trialDays: number;
  trialPlan: PlanId;
  trialAiQuota: number;
  graceDays: number;
  checkoutHours: number;
  legacyAiQuota: number;
};

const DEFAULTS: Settings = { billingEnforced: false, plansPublic: false, trialDays: 7, trialPlan: "inteligente", trialAiQuota: 30, graceDays: 3, checkoutHours: 24, legacyAiQuota: 0 };
const KEYS: Record<keyof Settings, string> = {
  billingEnforced: "billing_enforced", plansPublic: "plans_public", trialDays: "trial_days", trialPlan: "trial_plan", trialAiQuota: "trial_ai_quota",
  graceDays: "grace_days", checkoutHours: "checkout_hours", legacyAiQuota: "legacy_ai_quota",
};

export async function getSettings(db: Db): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: unknown }>("SELECT key, value FROM app_settings");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const int = (k: keyof Settings, min: number, max: number) => {
    const v = Number(map.get(KEYS[k]));
    return Number.isInteger(v) && v >= min && v <= max ? v : (DEFAULTS[k] as number);
  };
  const plan = map.get(KEYS.trialPlan);
  return {
    billingEnforced: map.get(KEYS.billingEnforced) === true,
    plansPublic: map.get(KEYS.plansPublic) === true,
    trialDays: int("trialDays", 0, 60),
    trialPlan: isPlanId(plan) ? plan : DEFAULTS.trialPlan,
    trialAiQuota: int("trialAiQuota", 0, 10000),
    graceDays: int("graceDays", 0, 30),
    checkoutHours: int("checkoutHours", 1, 168),
    legacyAiQuota: int("legacyAiQuota", 0, 10000),
  };
}

/** Só o painel administrativo chama (a página confere o papel antes). */
export async function updateSettings(db: Db, adminId: string, patch: Partial<Settings>): Promise<void> {
  const limits: Partial<Record<keyof Settings, [number, number]>> = {
    trialDays: [0, 60], trialAiQuota: [0, 10000], graceDays: [0, 30], checkoutHours: [1, 168], legacyAiQuota: [0, 10000],
  };
  for (const [k, v] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (v === undefined) continue;
    if ((k === "billingEnforced" || k === "plansPublic") && typeof v !== "boolean") throw new UserError("Valor inválido.");
    if (k === "trialPlan" && !isPlanId(v)) throw new UserError("Plano inválido.");
    const range = limits[k];
    if (range && !(Number.isInteger(v) && (v as number) >= range[0] && (v as number) <= range[1])) {
      throw new UserError(`Valor fora do permitido (${range[0]} a ${range[1]}).`);
    }
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [KEYS[k], JSON.stringify(v), adminId],
    );
  }
}

// ---------- Planos e oferta ----------

export async function listPlans(db: Db): Promise<Plan[]> {
  const { rows } = await db.query("SELECT id, name, price_cents, ai_quota, active FROM plans ORDER BY sort");
  return rows.map((r) => ({ id: r.id, name: r.name, priceCents: num(r.price_cents), aiQuota: num(r.ai_quota), active: r.active }));
}

export async function updatePlan(db: Db, planId: string, input: { priceCents?: number; aiQuota?: number }): Promise<void> {
  if (!isPlanId(planId)) throw new UserError("Plano inválido.");
  const ok = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max);
  if (!ok(input.priceCents, 100000) || !ok(input.aiQuota, 100000)) throw new UserError("Valor fora do permitido.");
  await db.query(
    "UPDATE plans SET price_cents = COALESCE($2, price_cents), ai_quota = COALESCE($3, ai_quota), updated_at = now() WHERE id = $1",
    [planId, input.priceCents ?? null, input.aiQuota ?? null],
  );
}

export async function getLaunchOffer(db: Db): Promise<LaunchOffer> {
  const { rows } = await db.query("SELECT enabled, plan_id, price_cents, slot_limit, claimed FROM launch_offer WHERE id = 1");
  const r = rows[0];
  if (!r) return { enabled: false, planId: "inteligente", priceCents: 0, slotLimit: 0, claimed: 0, available: 0 };
  const slotLimit = num(r.slot_limit);
  const claimed = num(r.claimed);
  return { enabled: r.enabled, planId: r.plan_id, priceCents: num(r.price_cents), slotLimit, claimed, available: r.enabled ? Math.max(0, slotLimit - claimed) : 0 };
}

export async function updateLaunchOffer(db: Db, input: { enabled?: boolean; priceCents?: number; slotLimit?: number }): Promise<void> {
  if (input.priceCents !== undefined && !(Number.isInteger(input.priceCents) && input.priceCents >= 0 && input.priceCents <= 100000)) throw new UserError("Preço inválido.");
  if (input.slotLimit !== undefined && !(Number.isInteger(input.slotLimit) && input.slotLimit >= 0 && input.slotLimit <= 100000)) throw new UserError("Limite inválido.");
  const { rowCount } = await db.query(
    `UPDATE launch_offer SET enabled = COALESCE($1, enabled), price_cents = COALESCE($2, price_cents), slot_limit = COALESCE($3, slot_limit)
      WHERE id = 1 AND COALESCE($3, slot_limit) >= claimed`,
    [input.enabled ?? null, input.priceCents ?? null, input.slotLimit ?? null],
  );
  if (!rowCount) throw new UserError("O limite não pode ficar abaixo das vagas já usadas.");
}

// ---------- Leitura e transições automáticas ----------

const SUB_COLS = `id, plan_id, status, trial, price_cents, launch_offer, current_period_start, current_period_end,
  cancel_at_period_end, pending_plan_id, past_due_since`;

function mapSub(r: Record<string, unknown>): Subscription {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: r.id as string,
    planId: r.plan_id as PlanId,
    status: r.status as SubscriptionStatus,
    trial: r.trial as boolean,
    priceCents: num(r.price_cents),
    launchOffer: r.launch_offer as boolean,
    periodStart: iso(r.current_period_start)!,
    periodEnd: iso(r.current_period_end)!,
    cancelAtPeriodEnd: r.cancel_at_period_end as boolean,
    pendingPlanId: (r.pending_plan_id as PlanId) ?? null,
    pastDueSince: iso(r.past_due_since),
  };
}

/** Libera a vaga da oferta de uma assinatura que terminou (parte de cada transição de fim). */
const RELEASE_CLAIMS = `
  released AS (
    DELETE FROM launch_offer_claims c USING ended e WHERE c.subscription_id = e.id RETURNING c.user_id
  ),
  freed AS (
    UPDATE launch_offer SET claimed = claimed - (SELECT count(*) FROM released) WHERE id = 1 AND (SELECT count(*) FROM released) > 0
  ),
  logged AS (
    INSERT INTO subscription_events (subscription_id, user_id, kind, data)
    SELECT id, user_id, kind, '{}'::jsonb FROM ended
  )`;

/**
 * Aplica o que o tempo decide: teste que acabou, cancelamento agendado que chegou, período pago
 * que venceu sem renovação (vira "em atraso"), atraso além da tolerância (expira) e contratação
 * não paga no prazo. Idempotente; serve para um usuário (ao abrir o app) ou para todos (rotina).
 */
export async function applyTimeRules(db: Db, now: Date, userId: string | null = null): Promise<void> {
  const s = await getSettings(db);
  const who = userId ? "AND user_id = $2" : "AND $2::uuid IS NULL";
  const args = [now.toISOString(), userId];
  // Teste e cancelamento agendado: terminam no fim do período.
  await db.query(
    `WITH ended AS (
       UPDATE subscriptions SET status = CASE WHEN trial THEN 'expired' ELSE 'canceled' END, ended_at = $1, updated_at = $1
        WHERE ((status = 'trialing') OR (status IN ('active', 'past_due') AND cancel_at_period_end))
          AND current_period_end <= $1 ${who}
        RETURNING id, user_id, CASE WHEN trial THEN 'trial_ended' ELSE 'canceled_at_period_end' END AS kind
     ), ${RELEASE_CLAIMS} SELECT 1`,
    args,
  );
  // Período pago venceu sem pagamento de renovação: em atraso (mantém acesso na tolerância).
  await db.query(
    `WITH due AS (
       UPDATE subscriptions SET status = 'past_due', past_due_since = current_period_end, updated_at = $1
        WHERE status = 'active' AND current_period_end <= $1 ${who} RETURNING id, user_id
     ) INSERT INTO subscription_events (subscription_id, user_id, kind) SELECT id, user_id, 'renewal_missing' FROM due`,
    args,
  );
  // Atraso além da tolerância: expira e perde a vaga da oferta.
  await db.query(
    `WITH ended AS (
       UPDATE subscriptions SET status = 'expired', ended_at = $1, updated_at = $1
        WHERE status = 'past_due' AND past_due_since + make_interval(days => $3) <= $1 ${who}
        RETURNING id, user_id, 'expired_unpaid' AS kind
     ), ${RELEASE_CLAIMS} SELECT 1`,
    [...args, s.graceDays],
  );
  // Contratação não paga no prazo: some e devolve a vaga reservada.
  await db.query(
    `WITH ended AS (
       UPDATE subscriptions SET status = 'expired', ended_at = $1, updated_at = $1
        WHERE status = 'pending' AND created_at + make_interval(hours => $3) <= $1 ${who}
        RETURNING id, user_id, 'checkout_expired' AS kind
     ), ${RELEASE_CLAIMS} SELECT 1`,
    [...args, s.checkoutHours],
  );
}

/** Assinatura em vigor (teste, ativa ou em atraso), já com as regras de tempo aplicadas. */
export async function currentSubscription(db: Db, userId: string, now = new Date()): Promise<Subscription | null> {
  await applyTimeRules(db, now, userId);
  const { rows } = await db.query(
    `SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = $1 AND status IN ('trialing', 'active', 'past_due')`,
    [userId],
  );
  return rows[0] ? mapSub(rows[0]) : null;
}

export async function pendingCheckout(db: Db, userId: string): Promise<Subscription | null> {
  const { rows } = await db.query(`SELECT ${SUB_COLS} FROM subscriptions WHERE user_id = $1 AND status = 'pending'`, [userId]);
  return rows[0] ? mapSub(rows[0]) : null;
}

export async function subscriptionHistory(db: Db, userId: string, limit = 30) {
  const { rows } = await db.query(
    `SELECT e.kind, e.actor, e.at, s.plan_id FROM subscription_events e JOIN subscriptions s ON s.id = e.subscription_id
      WHERE e.user_id = $1 ORDER BY e.at DESC, e.id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({ kind: r.kind as string, actor: r.actor as string, at: new Date(r.at).toISOString(), planId: r.plan_id as PlanId }));
}

// ---------- Acesso (o que a pessoa pode usar agora) ----------

export type Access = {
  enforced: boolean;
  subscription: Subscription | null;
  planId: PlanId | null;
  features: ReadonlySet<Feature>;
  aiQuota: number;
  aiUsed: number;
  trialAvailable: boolean;
  trialDays: number;
};

export async function getAccess(db: Db, userId: string, now = new Date()): Promise<Access> {
  const [settings, sub] = await Promise.all([getSettings(db), currentSubscription(db, userId, now)]);
  const [{ rows: usage }, { rows: trial }, plans] = await Promise.all([
    db.query("SELECT interactions FROM ai_usage WHERE user_id = $1 AND period = $2", [userId, usagePeriod(now)]),
    db.query("SELECT 1 FROM subscriptions WHERE user_id = $1 AND trial", [userId]),
    listPlans(db),
  ]);
  const aiUsed = num(usage[0]?.interactions);
  const trialAvailable = settings.plansPublic && !sub && trial.length === 0 && settings.trialDays > 0;
  if (sub) {
    const quota = sub.trial ? settings.trialAiQuota : (plans.find((p) => p.id === sub.planId)?.aiQuota ?? 0);
    return { enforced: settings.billingEnforced, subscription: sub, planId: sub.planId, features: PLAN_FEATURES[sub.planId], aiQuota: quota, aiUsed, trialAvailable, trialDays: settings.trialDays };
  }
  // Sem assinatura: com a cobrança desligada, tudo continua liberado como antes.
  return {
    enforced: settings.billingEnforced,
    subscription: null,
    planId: null,
    features: settings.billingEnforced ? new Set<Feature>() : ALL_FEATURES,
    aiQuota: settings.billingEnforced ? 0 : settings.legacyAiQuota,
    aiUsed,
    trialAvailable,
    trialDays: settings.trialDays,
  };
}

export function hasFeature(access: Access, feature: Feature): boolean {
  return access.features.has(feature);
}

export function requireFeature(access: Access, feature: Feature): void {
  if (!hasFeature(access, feature)) throw new UserError("Seu plano não inclui este recurso. Veja os planos em Assinatura.");
}

// ---------- Ações da pessoa ----------

export async function startTrial(db: Db, userId: string, now = new Date()): Promise<Subscription> {
  const s = await getSettings(db);
  if (!s.plansPublic || s.trialDays <= 0) throw new UserError("O teste grátis não está disponível.");
  if (await currentSubscription(db, userId, now)) throw new UserError("Você já tem uma assinatura em vigor.");
  try {
    const { rows } = await db.query(
      `WITH sub AS (
         INSERT INTO subscriptions (user_id, plan_id, status, trial, price_cents, current_period_start, current_period_end)
         VALUES ($1, $2, 'trialing', true, 0, $3, $4) RETURNING ${SUB_COLS}, user_id
       ), ev AS (INSERT INTO subscription_events (subscription_id, user_id, kind, actor) SELECT id, user_id, 'trial_started', 'user' FROM sub)
       SELECT * FROM sub`,
      [userId, s.trialPlan, now.toISOString(), addDays(now, s.trialDays).toISOString()],
    );
    return mapSub(rows[0]);
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("O teste grátis já foi usado nesta conta.");
    throw err;
  }
}

/**
 * Começa uma contratação (aguardando pagamento). Com `launchOffer`, tenta reservar uma vaga da
 * oferta: o UPDATE com "claimed < slot_limit" é atômico, então nunca passa de 100. Sem vaga, segue
 * pelo preço normal e avisa (`offerApplied: false`). O gateway recebe o id devolvido como referência.
 */
export async function startCheckout(
  db: Db, userId: string, planId: string, now = new Date(), opts: { launchOffer?: boolean } = {},
): Promise<{ subscription: Subscription; offerApplied: boolean }> {
  if (!isPlanId(planId)) throw new UserError("Plano inválido.");
  await applyTimeRules(db, now, userId);
  const plans = await listPlans(db);
  const plan = plans.find((p) => p.id === planId && p.active);
  if (!plan) throw new UserError("Plano indisponível.");
  const current = await currentSubscription(db, userId, now);
  if (current && !current.trial && current.planId === planId) throw new UserError("Você já assina este plano.");
  if (current && !current.trial && PLAN_RANK[planId] < PLAN_RANK[current.planId]) {
    throw new UserError("Para um plano menor, use \"Trocar de plano\": a troca vale no fim do período já pago.");
  }
  await db.query(
    `WITH ended AS (
       UPDATE subscriptions SET status = 'expired', ended_at = $2, updated_at = $2 WHERE user_id = $1 AND status = 'pending'
       RETURNING id, user_id, 'checkout_replaced' AS kind
     ), ${RELEASE_CLAIMS} SELECT 1`,
    [userId, now.toISOString()],
  );
  try {
    const { rows } = await db.query(
      `WITH slot AS (
         UPDATE launch_offer SET claimed = claimed + 1
          WHERE id = 1 AND $5 AND enabled AND plan_id = $2 AND claimed < slot_limit
            AND NOT EXISTS (SELECT 1 FROM launch_offer_claims WHERE user_id = $1)
         RETURNING price_cents
       ), sub AS (
         INSERT INTO subscriptions (user_id, plan_id, status, price_cents, launch_offer, current_period_start, current_period_end, created_at)
         SELECT $1, $2, 'pending', COALESCE((SELECT price_cents FROM slot), $3), EXISTS (SELECT 1 FROM slot), $4, $4, $4
         RETURNING ${SUB_COLS}, user_id
       ), claim AS (
         INSERT INTO launch_offer_claims (user_id, subscription_id, claimed_at) SELECT user_id, id, $4 FROM sub WHERE launch_offer
       ), ev AS (
         INSERT INTO subscription_events (subscription_id, user_id, kind, actor, data)
         SELECT id, user_id, 'checkout_started', 'user', jsonb_build_object('price_cents', price_cents, 'launch_offer', launch_offer) FROM sub
       )
       SELECT * FROM sub`,
      [userId, planId, plan.priceCents, now.toISOString(), opts.launchOffer === true],
    );
    const subscription = mapSub(rows[0]);
    return { subscription, offerApplied: subscription.launchOffer };
  } catch (err) {
    // Quem já tem vaga (de uma contratação anterior ainda ativa) continua com ela.
    if (pgCode(err) === "23505") throw new UserError("Já existe uma contratação em andamento. Tente de novo.");
    throw err;
  }
}

/** Cancela: a assinatura paga continua até o fim do período; teste e contratação acabam já. */
export async function cancelSubscription(db: Db, userId: string, now = new Date()): Promise<void> {
  const sub = await currentSubscription(db, userId, now);
  const pending = await pendingCheckout(db, userId);
  if (!sub && !pending) throw new UserError("Você não tem assinatura para cancelar.");
  const t = now.toISOString();
  if (pending) {
    await db.query(
      `WITH ended AS (UPDATE subscriptions SET status = 'canceled', canceled_at = $2, ended_at = $2, updated_at = $2
         WHERE id = $1 RETURNING id, user_id, 'checkout_canceled' AS kind), ${RELEASE_CLAIMS} SELECT 1`,
      [pending.id, t],
    );
  }
  if (!sub) return;
  if (sub.trial) {
    await db.query(
      `WITH ended AS (UPDATE subscriptions SET status = 'canceled', canceled_at = $2, ended_at = $2, updated_at = $2
         WHERE id = $1 RETURNING id, user_id, 'trial_canceled' AS kind), ${RELEASE_CLAIMS} SELECT 1`,
      [sub.id, t],
    );
    return;
  }
  await db.query(
    `WITH s AS (UPDATE subscriptions SET cancel_at_period_end = true, canceled_at = $2, updated_at = $2 WHERE id = $1 RETURNING id, user_id)
     INSERT INTO subscription_events (subscription_id, user_id, kind, actor) SELECT id, user_id, 'cancel_scheduled', 'user' FROM s`,
    [sub.id, t],
  );
}

/** Desfaz o cancelamento agendado (antes do fim do período, mantendo preço e vaga da oferta). */
export async function resumeSubscription(db: Db, userId: string, now = new Date()): Promise<void> {
  const sub = await currentSubscription(db, userId, now);
  if (!sub || !sub.cancelAtPeriodEnd) throw new UserError("Não há cancelamento agendado.");
  await db.query(
    `WITH s AS (UPDATE subscriptions SET cancel_at_period_end = false, canceled_at = NULL, updated_at = $2 WHERE id = $1 RETURNING id, user_id)
     INSERT INTO subscription_events (subscription_id, user_id, kind, actor) SELECT id, user_id, 'cancel_reverted', 'user' FROM s`,
    [sub.id, now.toISOString()],
  );
}

/** Troca para um plano menor no fim do período pago (para um maior, é uma nova contratação). */
export async function scheduleDowngrade(db: Db, userId: string, planId: string, now = new Date()): Promise<void> {
  if (!isPlanId(planId)) throw new UserError("Plano inválido.");
  const sub = await currentSubscription(db, userId, now);
  if (!sub || sub.trial || sub.status === "trialing") throw new UserError("Você não tem uma assinatura paga.");
  if (PLAN_RANK[planId] >= PLAN_RANK[sub.planId]) throw new UserError("Para um plano maior, contrate o novo plano.");
  await db.query(
    `WITH s AS (UPDATE subscriptions SET pending_plan_id = $2, updated_at = $3 WHERE id = $1 RETURNING id, user_id)
     INSERT INTO subscription_events (subscription_id, user_id, kind, actor, data) SELECT id, user_id, 'downgrade_scheduled', 'user', jsonb_build_object('plan', $2::text) FROM s`,
    [sub.id, planId, now.toISOString()],
  );
}

// ---------- Pagamentos (vindos do gateway, já com a assinatura do webhook conferida) ----------

export type PaymentEvent = {
  provider: string;
  eventId: string;
  type: "payment_succeeded" | "payment_failed" | "subscription_canceled";
  /** Nossa assinatura (o gateway devolve a referência que mandamos ao criar o pagamento). */
  subscriptionId: string;
  providerRef?: string | null;
  amountCents?: number | null;
  payload?: unknown;
};

/**
 * Aplica um evento de pagamento. Reenvio do mesmo evento não faz nada (chave provider+id).
 * Tudo numa transação: ou o evento é registrado e aplicado, ou nada muda.
 */
export async function applyPaymentEvent(pool: Pool, event: PaymentEvent, now = new Date()): Promise<"applied" | "duplicate" | "ignored"> {
  return inTransaction(pool, async (db) => {
    const { rows: fresh } = await db.query(
      `INSERT INTO payment_events (provider, id, type, payload) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (provider, id) DO NOTHING RETURNING id`,
      [event.provider, event.eventId, event.type, JSON.stringify(event.payload ?? {})],
    );
    if (!fresh.length) return "duplicate";
    const mark = (status: string, error: string | null = null) =>
      db.query("UPDATE payment_events SET status = $3, error = $4, processed_at = now() WHERE provider = $1 AND id = $2", [event.provider, event.eventId, status, error]);

    const { rows } = await db.query(`SELECT ${SUB_COLS}, user_id FROM subscriptions WHERE id::text = $1 FOR UPDATE`, [event.subscriptionId]);
    if (!rows[0]) {
      await mark("ignored", "assinatura não encontrada");
      return "ignored";
    }
    const sub = mapSub(rows[0]);
    const userId = rows[0].user_id as string;
    const t = now.toISOString();
    const log = (kind: string, data: object = {}) =>
      db.query("INSERT INTO subscription_events (subscription_id, user_id, kind, actor, data) VALUES ($1, $2, $3, 'payment', $4::jsonb)", [sub.id, userId, kind, JSON.stringify(data)]);

    if (event.type === "payment_succeeded") {
      if (event.amountCents != null && event.amountCents < sub.priceCents) {
        await mark("error", "valor pago menor que o preço");
        await log("payment_amount_mismatch", { paid: event.amountCents, price: sub.priceCents });
        return "ignored";
      }
      if (sub.status === "pending") {
        // Primeira cobrança: encerra teste ou plano anterior e ativa este.
        const { rows: old } = await db.query(
          `UPDATE subscriptions SET status = CASE WHEN trial THEN 'expired' ELSE 'canceled' END, ended_at = $2, updated_at = $2
            WHERE user_id = $1 AND status IN ('trialing', 'active', 'past_due') RETURNING id`,
          [userId, t],
        );
        for (const o of old) {
          const { rowCount } = await db.query("DELETE FROM launch_offer_claims WHERE subscription_id = $1", [o.id]);
          if (rowCount) await db.query("UPDATE launch_offer SET claimed = claimed - $1 WHERE id = 1", [rowCount]);
          await db.query("INSERT INTO subscription_events (subscription_id, user_id, kind, actor) VALUES ($1, $2, 'replaced', 'payment')", [o.id, userId]);
        }
        await db.query(
          `UPDATE subscriptions SET status = 'active', current_period_start = $2, current_period_end = $3, provider = $4,
                  provider_ref = COALESCE($5, provider_ref), updated_at = $2 WHERE id = $1`,
          [sub.id, t, addMonth(now).toISOString(), event.provider, event.providerRef ?? null],
        );
        await log("activated", { amount: event.amountCents ?? null });
      } else if (sub.status === "active" || sub.status === "past_due") {
        // Renovação: novo período a partir do fim do anterior (ou de hoje, se estava atrasada).
        const base = sub.status === "past_due" ? now : new Date(sub.periodEnd);
        const start = base.getTime() < now.getTime() - 40 * 86_400_000 ? now : base;
        let planId = sub.planId;
        let price = sub.priceCents;
        let keepOffer = sub.launchOffer;
        if (sub.pendingPlanId) {
          planId = sub.pendingPlanId;
          const { rows: p } = await db.query("SELECT price_cents FROM plans WHERE id = $1", [planId]);
          price = num(p[0]?.price_cents);
          if (keepOffer) {
            const { rowCount } = await db.query("DELETE FROM launch_offer_claims WHERE subscription_id = $1", [sub.id]);
            if (rowCount) await db.query("UPDATE launch_offer SET claimed = claimed - $1 WHERE id = 1", [rowCount]);
            keepOffer = false;
          }
        }
        await db.query(
          `UPDATE subscriptions SET status = 'active', past_due_since = NULL, current_period_start = $2, current_period_end = $3,
                  plan_id = $4, price_cents = $5, launch_offer = $6, pending_plan_id = NULL, updated_at = $7 WHERE id = $1`,
          [sub.id, start.toISOString(), addMonth(start).toISOString(), planId, price, keepOffer, t],
        );
        await log(sub.pendingPlanId ? "renewed_downgraded" : "renewed", { plan: planId });
      } else {
        await mark("ignored", `assinatura ${sub.status}`);
        return "ignored";
      }
    } else if (event.type === "payment_failed") {
      if (sub.status !== "active" && sub.status !== "past_due") {
        await mark("ignored", `assinatura ${sub.status}`);
        return "ignored";
      }
      await db.query("UPDATE subscriptions SET status = 'past_due', past_due_since = COALESCE(past_due_since, $2), updated_at = $2 WHERE id = $1", [sub.id, t]);
      await log("payment_failed");
    } else if (event.type === "subscription_canceled") {
      if (sub.status === "canceled" || sub.status === "expired") {
        await mark("ignored", "já encerrada");
        return "ignored";
      }
      await db.query("UPDATE subscriptions SET status = 'canceled', canceled_at = $2, ended_at = $2, updated_at = $2 WHERE id = $1", [sub.id, t]);
      const { rowCount } = await db.query("DELETE FROM launch_offer_claims WHERE subscription_id = $1", [sub.id]);
      if (rowCount) await db.query("UPDATE launch_offer SET claimed = claimed - $1 WHERE id = 1", [rowCount]);
      await log("canceled_by_provider");
    }
    await mark("processed");
    return "applied";
  });
}

/** Concessão manual pelo administrador (ex.: pagamento recebido fora do gateway). Fica registrada. */
export async function grantSubscription(pool: Pool, adminId: string, userId: string, planId: string, months: number, now = new Date()): Promise<void> {
  if (!isPlanId(planId)) throw new UserError("Plano inválido.");
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new UserError("Meses: de 1 a 24.");
  await inTransaction(pool, async (db) => {
    const { rows: plan } = await db.query("SELECT price_cents FROM plans WHERE id = $1", [planId]);
    const t = now.toISOString();
    const { rows: old } = await db.query(
      `UPDATE subscriptions SET status = CASE WHEN trial THEN 'expired' ELSE 'canceled' END, ended_at = $2, updated_at = $2
        WHERE user_id = $1 AND status IN ('trialing', 'active', 'past_due', 'pending') RETURNING id`,
      [userId, t],
    );
    for (const o of old) {
      const { rowCount } = await db.query("DELETE FROM launch_offer_claims WHERE subscription_id = $1", [o.id]);
      if (rowCount) await db.query("UPDATE launch_offer SET claimed = claimed - $1 WHERE id = 1", [rowCount]);
    }
    let end = now;
    for (let i = 0; i < months; i++) end = addMonth(end);
    const { rows } = await db.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, price_cents, current_period_start, current_period_end, provider)
       VALUES ($1, $2, 'active', $3, $4, $5, 'manual') RETURNING id`,
      [userId, planId, num(plan[0]?.price_cents), t, end.toISOString()],
    );
    await db.query(
      "INSERT INTO subscription_events (subscription_id, user_id, kind, actor, data) VALUES ($1, $2, 'granted', 'admin', $3::jsonb)",
      [rows[0].id, userId, JSON.stringify({ admin: adminId, months })],
    );
  });
}
