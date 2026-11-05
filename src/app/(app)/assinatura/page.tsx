import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { getBillingProvider } from "@/lib/billing";
import { getAccess, getLaunchOffer, listPlans, pendingCheckout, subscriptionHistory } from "@/data/subscriptions";
import { SubscriptionView } from "./subscription-view";

export const metadata = { title: "Assinatura · OIKON Finance" };

export default async function AssinaturaPage() {
  const userId = await requireUserId();
  const db = getDb();
  const access = await getAccess(db, userId);
  const [plans, offer, pending, history] = await Promise.all([listPlans(db), getLaunchOffer(db), pendingCheckout(db, userId), subscriptionHistory(db, userId, 10)]);
  return (
    <SubscriptionView
      access={{ ...access, features: [] }}
      plans={plans}
      offer={offer}
      pending={pending}
      history={history}
      billingReady={getBillingProvider() !== null}
    />
  );
}
