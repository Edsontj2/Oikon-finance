import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  applyPaymentEvent, cancelSubscription, currentSubscription, getAccess, getLaunchOffer, grantSubscription, hasFeature,
  pendingCheckout, resumeSubscription, scheduleDowngrade, startCheckout, startTrial, subscriptionHistory, updateLaunchOffer,
  updatePlan, updateSettings,
} from "@/data/subscriptions";
import { aiUsage, consumeAiInteraction, refundAiInteraction } from "@/data/ai-usage";
import { isAdmin } from "@/data/admin";
import { addDays, addMonth } from "@/domain/plans";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
  await db.query("UPDATE app_settings SET value = 'true' WHERE key = 'plans_public'");
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await updateLaunchOffer(db, { enabled: true, slotLimit: 100, priceCents: 1990 }).catch(() => {});
});

const T0 = new Date("2026-11-10T12:00:00Z");
let seq = 0;
const evt = (subscriptionId: string, type: "payment_succeeded" | "payment_failed" | "subscription_canceled", amountCents?: number) => ({
  provider: "teste", eventId: `ev-${++seq}`, type, subscriptionId, amountCents,
});
async function adminId() {
  return newUser(db, "Admin");
}

describe("assinaturas", () => {
  it("com a cobrança desligada, quem não assina continua com tudo; ligada, sem plano não tem recursos pagos", async () => {
    const u = await newUser(db);
    let a = await getAccess(db, u, T0);
    expect(a.enforced).toBe(false);
    expect(hasFeature(a, "transactions")).toBe(true);
    expect(hasFeature(a, "purchase_simulation")).toBe(true);
    expect(a.aiQuota).toBe(0);
    await updateSettings(db, await adminId(), { billingEnforced: true });
    a = await getAccess(db, u, T0);
    expect(hasFeature(a, "transactions")).toBe(false);
    expect(a.trialAvailable).toBe(true);
    await updateSettings(db, await adminId(), { billingEnforced: false });
  });

  it("teste grátis fica indisponível enquanto os planos não forem públicos", async () => {
    const u = await newUser(db);
    await updateSettings(db, await adminId(), { plansPublic: false });
    expect((await getAccess(db, u, T0)).trialAvailable).toBe(false);
    await expect(startTrial(db, u, T0)).rejects.toThrow("não está disponível");
    await updateSettings(db, await adminId(), { plansPublic: true });
  });

  it("teste grátis de 7 dias no Inteligente: um por conta, com franquia própria, e termina sozinho", async () => {
    const u = await newUser(db);
    const trial = await startTrial(db, u, T0);
    expect(trial).toMatchObject({ planId: "inteligente", status: "trialing", trial: true, priceCents: 0 });
    expect(new Date(trial.periodEnd).getTime()).toBe(addDays(T0, 7).getTime());
    await expect(startTrial(db, u, T0)).rejects.toThrow("já tem uma assinatura");
    const a = await getAccess(db, u, T0);
    expect(a.planId).toBe("inteligente");
    expect(a.aiQuota).toBe(30);
    expect(hasFeature(a, "ai_chat")).toBe(true);
    expect(hasFeature(a, "purchase_simulation")).toBe(false);
    expect(await currentSubscription(db, u, addDays(T0, 8))).toBeNull();
    await expect(startTrial(db, u, addDays(T0, 8))).rejects.toThrow("já foi usado");
  });

  it("só fica ativa com pagamento confirmado; o mesmo evento reenviado não repete nada", async () => {
    const u = await newUser(db);
    await startTrial(db, u, T0);
    const { subscription } = await startCheckout(db, u, "premium", T0);
    expect(subscription.status).toBe("pending");
    expect(subscription.priceCents).toBe(3490);
    expect((await currentSubscription(db, u, T0))?.trial).toBe(true); // contratar não ativa nada
    const e = evt(subscription.id, "payment_succeeded", 3490);
    expect(await applyPaymentEvent(db, e, T0)).toBe("applied");
    expect(await applyPaymentEvent(db, e, T0)).toBe("duplicate");
    const sub = (await currentSubscription(db, u, T0))!;
    expect(sub).toMatchObject({ id: subscription.id, planId: "premium", status: "active" });
    expect(new Date(sub.periodEnd).getTime()).toBe(addMonth(T0).getTime());
    const a = await getAccess(db, u, T0);
    expect(a.aiQuota).toBe(1000);
    expect(hasFeature(a, "purchase_simulation")).toBe(true);
    const kinds = (await subscriptionHistory(db, u)).map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(["trial_started", "checkout_started", "replaced", "activated"]));
  });

  it("pagamento com valor menor que o preço não ativa; evento de assinatura inexistente é ignorado", async () => {
    const u = await newUser(db);
    const { subscription } = await startCheckout(db, u, "essencial", T0);
    expect(await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded", 100), T0)).toBe("ignored");
    expect(await currentSubscription(db, u, T0)).toBeNull();
    expect(await applyPaymentEvent(db, evt("00000000-0000-0000-0000-000000000000", "payment_succeeded"), T0)).toBe("ignored");
  });

  it("renovação, atraso com tolerância de 3 dias e expiração por falta de pagamento", async () => {
    const u = await newUser(db);
    const { subscription } = await startCheckout(db, u, "inteligente", T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), T0);
    const end1 = addMonth(T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), addDays(end1, -1));
    let sub = (await currentSubscription(db, u, addDays(end1, 1)))!;
    expect(new Date(sub.periodEnd).getTime()).toBe(addMonth(end1).getTime()); // renovou a partir do fim do período
    const end2 = addMonth(end1);
    sub = (await currentSubscription(db, u, addDays(end2, 1)))!;
    expect(sub.status).toBe("past_due"); // venceu sem pagamento: continua usando na tolerância
    expect(hasFeature(await getAccess(db, u, addDays(end2, 1)), "ai_chat")).toBe(true);
    expect(await currentSubscription(db, u, addDays(end2, 4))).toBeNull(); // passou da tolerância
  });

  it("cancelar mantém o acesso até o fim do período, dá para desfazer e depois termina", async () => {
    const u = await newUser(db);
    const { subscription } = await startCheckout(db, u, "essencial", T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), T0);
    await cancelSubscription(db, u, addDays(T0, 2));
    expect((await currentSubscription(db, u, addDays(T0, 3)))?.cancelAtPeriodEnd).toBe(true);
    await resumeSubscription(db, u, addDays(T0, 3));
    await cancelSubscription(db, u, addDays(T0, 4));
    expect(await currentSubscription(db, u, addDays(addMonth(T0), 1))).toBeNull();
  });

  it("plano menor só no fim do período: na renovação troca o plano e o preço", async () => {
    const u = await newUser(db);
    const { subscription } = await startCheckout(db, u, "premium", T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), T0);
    await expect(startCheckout(db, u, "essencial", T0)).rejects.toThrow("plano menor");
    await scheduleDowngrade(db, u, "essencial", T0);
    expect((await currentSubscription(db, u, T0))?.planId).toBe("premium");
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), addMonth(T0));
    expect(await currentSubscription(db, u, addDays(addMonth(T0), 1))).toMatchObject({ planId: "essencial", priceCents: 1290, pendingPlanId: null });
  });

  it("falha de pagamento deixa em atraso; o gateway cancelando encerra", async () => {
    const u = await newUser(db);
    const { subscription } = await startCheckout(db, u, "essencial", T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_failed"), addDays(T0, 1));
    expect((await currentSubscription(db, u, addDays(T0, 1)))?.status).toBe("past_due");
    await applyPaymentEvent(db, evt(subscription.id, "subscription_canceled"), addDays(T0, 2));
    expect(await currentSubscription(db, u, addDays(T0, 2))).toBeNull();
  });

  it("concessão manual do admin fica ativa e registrada", async () => {
    const u = await newUser(db);
    await grantSubscription(db, await adminId(), u, "premium", 2, T0);
    const sub = (await currentSubscription(db, u, T0))!;
    expect(sub).toMatchObject({ planId: "premium", status: "active" });
    expect(new Date(sub.periodEnd).getTime()).toBe(addMonth(addMonth(T0)).getTime());
    expect((await subscriptionHistory(db, u))[0].kind).toBe("granted");
  });

  it("preço e franquia são configuráveis pelo admin", async () => {
    await updatePlan(db, "inteligente", { aiQuota: 350 });
    const u = await newUser(db);
    await grantSubscription(db, await adminId(), u, "inteligente", 1, T0);
    expect((await getAccess(db, u, T0)).aiQuota).toBe(350);
    await updatePlan(db, "inteligente", { aiQuota: 300 });
    await expect(updatePlan(db, "ouro", { aiQuota: 1 })).rejects.toThrow("Plano inválido");
  });
});

describe("oferta de lançamento", () => {
  it("R$ 19,90 só no Inteligente, uma vaga por pessoa, mantida na renovação", async () => {
    const u = await newUser(db);
    const before = (await getLaunchOffer(db)).claimed;
    const { subscription, offerApplied } = await startCheckout(db, u, "inteligente", T0, { launchOffer: true });
    expect(offerApplied).toBe(true);
    expect(subscription.priceCents).toBe(1990);
    expect((await getLaunchOffer(db)).claimed).toBe(before + 1);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded", 1990), T0);
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded", 1990), addMonth(T0));
    expect((await currentSubscription(db, u, addDays(addMonth(T0), 1)))?.priceCents).toBe(1990);
    // Premium não tem a oferta.
    const v = await newUser(db);
    expect((await startCheckout(db, v, "premium", T0, { launchOffer: true })).offerApplied).toBe(false);
  });

  it("100 vagas disputadas ao mesmo tempo: nunca passa do limite", async () => {
    const start = (await getLaunchOffer(db)).claimed;
    await updateLaunchOffer(db, { slotLimit: start + 7 });
    const users = await Promise.all(Array.from({ length: 25 }, () => newUser(db)));
    const results = await Promise.all(users.map((u) => startCheckout(db, u, "inteligente", T0, { launchOffer: true })));
    expect(results.filter((r) => r.offerApplied)).toHaveLength(7);
    expect(results.filter((r) => !r.offerApplied).every((r) => r.subscription.priceCents === 2490)).toBe(true);
    const offer = await getLaunchOffer(db);
    expect(offer.claimed).toBe(start + 7);
    expect(offer.available).toBe(0);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM launch_offer_claims");
    expect(rows[0].n).toBe(offer.claimed);
    await expect(updateLaunchOffer(db, { slotLimit: start })).rejects.toThrow("abaixo das vagas");
  });

  it("vaga volta quando a contratação não é paga no prazo ou a assinatura termina", async () => {
    const u = await newUser(db);
    const before = (await getLaunchOffer(db)).claimed;
    await startCheckout(db, u, "inteligente", T0, { launchOffer: true });
    expect((await getLaunchOffer(db)).claimed).toBe(before + 1);
    expect(await pendingCheckout(db, u)).not.toBeNull();
    await currentSubscription(db, u, addDays(T0, 2)); // passou o prazo de 24 h
    expect((await getLaunchOffer(db)).claimed).toBe(before);

    const v = await newUser(db);
    const { subscription } = await startCheckout(db, v, "inteligente", T0, { launchOffer: true });
    await applyPaymentEvent(db, evt(subscription.id, "payment_succeeded"), T0);
    await cancelSubscription(db, v, addDays(T0, 1));
    expect((await getLaunchOffer(db)).claimed).toBe(before + 1); // cancelamento agendado mantém a vaga
    await currentSubscription(db, v, addDays(addMonth(T0), 1));
    expect((await getLaunchOffer(db)).claimed).toBe(before); // terminou: vaga liberada
    // Quem assina de novo paga o preço normal se não reservar outra vaga.
    expect((await startCheckout(db, v, "inteligente", addDays(addMonth(T0), 2))).subscription.priceCents).toBe(2490);
  });
});

describe("franquia de IA", () => {
  it("compartilhada entre app e WhatsApp e atômica: 20 pedidos simultâneos com franquia 10 = 10 aceitos", async () => {
    const u = await newUser(db);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => consumeAiInteraction(db, u, i % 2 ? "app" : "whatsapp", 10, T0)));
    expect(results.filter((r) => r !== null)).toHaveLength(10);
    const usage = await aiUsage(db, u, T0);
    expect(usage.interactions).toBe(10);
    expect(usage.app + usage.whatsapp).toBe(10);
    expect(await consumeAiInteraction(db, u, "app", 10, T0)).toBeNull();
    await refundAiInteraction(db, u, "app", T0);
    expect(await consumeAiInteraction(db, u, "app", 10, T0)).toBe(10);
    // Mês novo: franquia renovada.
    expect(await consumeAiInteraction(db, u, "app", 10, new Date("2026-12-02T12:00:00Z"))).toBe(1);
    // Sem franquia (plano Essencial), nada passa.
    expect(await consumeAiInteraction(db, u, "app", 0, T0)).toBeNull();
  });

  it("uso de uma pessoa não conta para outra", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    await consumeAiInteraction(db, a, "app", 5, T0);
    expect((await aiUsage(db, b, T0)).interactions).toBe(0);
  });
});

describe("administrador", () => {
  it("só quem tem papel admin ou e-mail autorizado", async () => {
    const u = await newUser(db);
    expect(await isAdmin(db, u)).toBe(false);
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [u]);
    expect(await isAdmin(db, u)).toBe(true);
    const v = await newUser(db);
    const { rows } = await db.query("SELECT email FROM users WHERE id = $1", [v]);
    process.env.OIKON_ADMIN_EMAILS = ` outro@x.com, ${rows[0].email.toUpperCase()} `;
    expect(await isAdmin(db, v)).toBe(true);
    delete process.env.OIKON_ADMIN_EMAILS;
    expect(await isAdmin(db, v)).toBe(false);
  });
});
