import { headers } from "next/headers";

/** IP de quem fez a requisição (na Vercel, x-forwarded-for é preenchido pela própria plataforma). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconhecido";
}
