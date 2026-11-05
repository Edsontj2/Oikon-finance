import { getDb } from "@/lib/db";
import { redeemDeviceCode } from "@/data/devices";
import { allowAttempt } from "@/data/rate-limit";
import { clientIp, json } from "../auth";

/** O app manda o código de 8 dígitos gerado no site e recebe o token do celular (uma vez). */
export async function POST(request: Request) {
  const db = getDb();
  if (!(await allowAttempt(db, `device-link:${clientIp(request)}`, { limit: 10, windowSeconds: 15 * 60 }))) {
    return json({ error: "Muitas tentativas. Espere alguns minutos." }, 429);
  }
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  const name = typeof body?.deviceName === "string" ? body.deviceName : "Celular";
  const result = await redeemDeviceCode(db, code, name);
  if (!result) return json({ error: "Código inválido ou vencido. Gere outro no site: Notificações → Vincular celular." }, 400);
  return json({ token: result.token });
}
