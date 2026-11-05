import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { listAccountOptions } from "@/data/accounts";
import { listCategoryOptions } from "@/data/categories";
import { listDevices, notificationsPaused } from "@/data/devices";
import { listNotifications } from "@/data/bank-notifications";
import { NotificationsView } from "./notifications-view";

export default async function NotificacoesPage() {
  const userId = await requireUserId();
  const db = getDb();
  const [pending, done, devices, paused, accounts, categories] = await Promise.all([
    listNotifications(db, userId, "pending"),
    listNotifications(db, userId, "done"),
    listDevices(db, userId),
    notificationsPaused(db, userId),
    listAccountOptions(db, userId),
    listCategoryOptions(db, userId),
  ]);
  return <NotificationsView pending={pending} done={done} devices={devices} paused={paused} accounts={accounts.filter((a) => a.type !== "loan")} categories={categories} />;
}
