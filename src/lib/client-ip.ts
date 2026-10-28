import { headers } from "next/headers";

/**
 * IP de quem fez a requisição. Na Vercel, x-vercel-forwarded-for e x-forwarded-for são
 * preenchidos pela própria plataforma (o valor enviado pelo navegador é descartado).
 * Fora dela, só é confiável atrás de um proxy que faça o mesmo.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-vercel-forwarded-for") || h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconhecido";
}
