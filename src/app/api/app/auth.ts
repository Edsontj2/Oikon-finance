import { getDb } from "@/lib/db";
import { authenticateDevice, type DeviceAuth } from "@/data/devices";

/** Celular autenticado pelo token (Authorization: Bearer ...). */
export async function deviceFrom(request: Request): Promise<DeviceAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return authenticateDevice(getDb(), token);
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
}
