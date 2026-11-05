"use client";

import { CreditCard } from "lucide-react";
import type { Access, LaunchOffer, Plan, Subscription } from "@/data/subscriptions";
import { PLAN_RANK, type PlanId } from "@/domain/plans";
import { PlanCards } from "@/components/plan-cards";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cancelAction, checkoutAction, downgradeAction, resumeAction, startTrialAction } from "./actions";

const statusLabel: Record<Subscription["status"], string> = {
  trialing: "Teste grátis", pending: "Aguardando pagamento", active: "Ativa", past_due: "Pagamento em atraso", canceled: "Cancelada", expired: "Encerrada",
};
const eventLabel: Record<string, string> = {
  trial_started: "Teste grátis iniciado", trial_ended: "Teste grátis terminou", trial_canceled: "Teste cancelado",
  checkout_started: "Contratação iniciada", checkout_expired: "Contratação expirou sem pagamento", checkout_replaced: "Contratação substituída",
  checkout_canceled: "Contratação cancelada", activated: "Assinatura ativada", renewed: "Renovada", renewed_downgraded: "Renovada com o plano novo",
  renewal_missing: "Renovação não paga", payment_failed: "Pagamento recusado", expired_unpaid: "Encerrada por falta de pagamento",
  cancel_scheduled: "Cancelamento agendado", cancel_reverted: "Cancelamento desfeito", canceled_at_period_end: "Cancelada no fim do período",
  canceled_by_provider: "Cancelada pelo meio de pagamento", downgrade_scheduled: "Troca de plano agendada", replaced: "Substituída pelo plano novo",
  granted: "Liberada pela equipe OIKON", payment_amount_mismatch: "Pagamento com valor diferente",
};

type AccessView = Omit<Access, "features"> & { features: never[] };

export function SubscriptionView({ access, plans, offer, pending, history, billingReady }: {
  access: AccessView; plans: Plan[]; offer: LaunchOffer; pending: Subscription | null;
  history: { kind: string; at: string; planId: PlanId }[]; billingReady: boolean;
}) {
  const trial = useServerAction(startTrialAction);
  const checkout = useServerAction(checkoutAction);
  const cancel = useServerAction(cancelAction);
  const resume = useServerAction(resumeAction);
  const downgrade = useServerAction(downgradeAction);
  const sub = access.subscription;
  const planName = (id: PlanId | null) => plans.find((p) => p.id === id)?.name ?? "";
  const paid = sub && !sub.trial;

  function action(plan: Plan, offerPrice: number | null) {
    if (paid && sub.planId === plan.id) return <span className="tag">Seu plano atual</span>;
    if (paid && PLAN_RANK[plan.id] < PLAN_RANK[sub.planId]) {
      if (sub.pendingPlanId === plan.id) return <span className="tag">Troca agendada</span>;
      return <button type="button" className="btn btn-secondary" disabled={downgrade.pending} onClick={() => downgrade.run(plan.id)}>Trocar no fim do período</button>;
    }
    if (!billingReady) return <span className="hint">Contratação online em breve.</span>;
    return (
      <button type="button" className={`btn ${plan.id === "inteligente" ? "btn-primary" : "btn-secondary"}`} disabled={checkout.pending} onClick={() => checkout.run(plan.id, offerPrice !== null)}>
        {paid ? "Mudar para este plano" : `Assinar por ${formatMoney(offerPrice ?? plan.priceCents)}/mês`}
      </button>
    );
  }

  return (
    <>
      <div className="page-head"><h1>Assinatura</h1></div>

      <section className="card stack" aria-labelledby="atual-title">
        <h2 id="atual-title" className="card-icon-title"><CreditCard size={18} aria-hidden /> Seu plano</h2>
        {sub ? (
          <div className="plan-status" data-testid="plano-atual">
            <strong>{planName(sub.planId)}{sub.trial ? " (teste grátis)" : ""} · {statusLabel[sub.status]}</strong>
            <span className="hint">
              {sub.trial ? `Teste até ${formatDate(sub.periodEnd.slice(0, 10))}.` :
                sub.cancelAtPeriodEnd ? `Cancelada: você usa até ${formatDate(sub.periodEnd.slice(0, 10))}.` :
                sub.status === "past_due" ? "O último pagamento não foi confirmado. Regularize para não perder o acesso." :
                `${formatMoney(sub.priceCents)}/mês${sub.launchOffer ? " (oferta de lançamento)" : ""} · renova em ${formatDate(sub.periodEnd.slice(0, 10))}.`}
              {sub.pendingPlanId ? ` A partir da renovação: ${planName(sub.pendingPlanId)}.` : ""}
            </span>
            {access.aiQuota > 0 && <span className="hint">OIKON IA: {access.aiUsed} de {access.aiQuota} interações usadas este mês.</span>}
            <div className="stack-actions">
              {sub.cancelAtPeriodEnd ? (
                <button type="button" className="btn btn-secondary" disabled={resume.pending} onClick={() => resume.run()}>Desfazer cancelamento</button>
              ) : (
                <button type="button" className="btn btn-danger-ghost" disabled={cancel.pending} onClick={() => cancel.run()}>{sub.trial ? "Encerrar teste" : "Cancelar assinatura"}</button>
              )}
            </div>
          </div>
        ) : (
          <div className="plan-status" data-testid="plano-atual">
            <strong>Sem assinatura</strong>
            <span className="hint">
              {access.enforced ? "Escolha um plano para usar os recursos do OIKON." : "Durante o lançamento, os recursos do OIKON continuam liberados. Os planos abaixo começam a valer quando a cobrança for ativada."}
            </span>
            {access.trialAvailable && (
              <div className="stack-actions">
                <button type="button" className="btn btn-primary" disabled={trial.pending} onClick={() => trial.run()}>Começar {access.trialDays} dias grátis do Inteligente</button>
              </div>
            )}
          </div>
        )}
        {pending && <p className="hint">Há uma contratação de {planName(pending.planId)} aguardando a confirmação do pagamento.</p>}
        <FormError message={trial.error ?? cancel.error ?? resume.error ?? downgrade.error ?? checkout.error} />
      </section>

      <section aria-labelledby="planos-title" className="stack">
        <h2 id="planos-title" className="list-group-title">Planos</h2>
        <PlanCards plans={plans} offer={offer} action={action} />
      </section>

      {history.length > 0 && (
        <details className="card">
          <summary>Histórico da assinatura</summary>
          <ul className="list">
            {history.map((h, i) => (
              <li key={i} className="mini-list-line"><span>{eventLabel[h.kind] ?? h.kind} · {planName(h.planId)}</span><span className="hint">{formatDate(h.at.slice(0, 10))}</span></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
