import { Check, Sparkles } from "lucide-react";
import { PLAN_COPY, type PlanId } from "@/domain/plans";
import type { LaunchOffer, Plan } from "@/data/subscriptions";
import { formatMoney } from "@/lib/money";

/** Cartões dos três planos (página de vendas e área de assinatura). Preços vêm do banco. */
export function PlanCards({ plans, offer, action }: {
  plans: Plan[];
  offer: LaunchOffer;
  /** O botão de cada cartão (contratar, teste, plano atual...). */
  action: (plan: Plan, offerPrice: number | null) => React.ReactNode;
}) {
  return (
    <div className="plan-grid">
      {plans.filter((p) => p.active).map((p) => {
        const offerPrice = offer.available > 0 && offer.planId === p.id ? offer.priceCents : null;
        const popular = p.id === "inteligente";
        const copy = PLAN_COPY[p.id as PlanId];
        return (
          <article key={p.id} className={`plan-card${popular ? " plan-popular" : ""}`} data-testid={`plano-${p.id}`}>
            {popular && <span className="plan-badge"><Sparkles size={14} aria-hidden /> Mais popular</span>}
            <h3>{p.name}</h3>
            <p className="plan-tagline">{copy.tagline}</p>
            <div className="plan-price">
              {offerPrice !== null ? (
                <>
                  <s className="plan-old">{formatMoney(p.priceCents)}</s>
                  <strong>{formatMoney(offerPrice)}</strong><span>/mês</span>
                </>
              ) : (
                <><strong>{formatMoney(p.priceCents)}</strong><span>/mês</span></>
              )}
            </div>
            {offerPrice !== null && (
              <p className="plan-offer">Oferta de lançamento: restam {offer.available} {offer.available === 1 ? "vaga" : "vagas"}. O preço fica enquanto a assinatura estiver ativa.</p>
            )}
            <ul className="plan-items">
              {copy.items.map((i) => <li key={i}><Check size={16} aria-hidden /> {i}</li>)}
              {p.aiQuota > 0 ? <li><Check size={16} aria-hidden /> {p.aiQuota.toLocaleString("pt-BR")} interações de IA por mês</li> : <li className="plan-no">Sem assistente de IA</li>}
            </ul>
            <div className="plan-action">{action(p, offerPrice)}</div>
          </article>
        );
      })}
    </div>
  );
}
