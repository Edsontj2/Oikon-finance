import { getDb } from "@/lib/db";
import { UserError } from "@/data/errors";
import { ingestNotifications } from "@/data/bank-notifications";
import { allowAttempt } from "@/data/rate-limit";
import { deviceFrom, json } from "../auth";

/** Lote de notificações do celular. Reenviar o mesmo lote é seguro (não duplica). */
export async function POST(request: Request) {
  const device = await deviceFrom(request);
  if (!device) return json({ error: "Celular não vinculado ou desvinculado." }, 401);
  if (!(await allowAttempt(getDb(), `device-upload:${device.deviceId}`, { limit: 120, windowSeconds: 60 * 60 }))) {
    return json({ error: "Envios demais. Tente mais tarde." }, 429);
  }
  const body = await request.json().catch(() => null);
  try {
    return json(await ingestNotifications(getDb(), device, body?.notifications));
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, device.paused ? 423 : 400);
    console.error(err);
    return json({ error: "Erro ao receber. Tente de novo." }, 500);
  }
}
