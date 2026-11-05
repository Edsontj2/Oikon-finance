import { deviceFrom, json } from "../auth";

/** O app confere se continua vinculado e se a leitura está pausada no site. */
export async function GET(request: Request) {
  const device = await deviceFrom(request);
  if (!device) return json({ error: "Celular não vinculado ou desvinculado." }, 401);
  return json({ ok: true, deviceName: device.name, paused: device.paused });
}
