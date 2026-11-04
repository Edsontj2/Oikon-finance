import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { signup, sql } from "./helpers";

const SECRET = "segredo-do-app-e2e";
const PHONE = "5511955554444";

function payload(id: string, text: string) {
  return JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: PHONE, type: "text", text: { body: text } }] } }] }] });
}

async function post(request: APIRequestContext, body: string, secret = SECRET) {
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return request.post("/api/whatsapp/webhook", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": signature } });
}

/** A resposta é gravada junto com a mensagem (o envio real vai para a Meta). */
async function replyTo(id: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const rows = await sql("SELECT reply FROM whatsapp_messages WHERE id = $1 AND status <> 'received'", [id]);
    if (rows[0]) return rows[0].reply ?? "";
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`sem resposta para ${id}`);
}

test("webhook: verificação da Meta e assinatura obrigatória", async ({ request }) => {
  const ok = await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token-de-verificacao-e2e&hub.challenge=42");
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("42");
  expect((await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42")).status()).toBe(403);
  expect((await post(request, payload(randomUUID(), "oi"), "chave-errada")).status()).toBe(401);
});

test("vincular pelo app e lançar pelo WhatsApp, com confirmação e sem duplicar no reenvio", async ({ page, request }) => {
  const email = await signup(page);
  await page.goto("/configuracoes");
  await page.getByRole("button", { name: "Gerar código de vínculo" }).click();
  const code = ((await page.locator(".installment-preview strong").textContent()) ?? "").replace(/\D/g, "");
  expect(code).toHaveLength(6);

  const link = randomUUID();
  expect((await post(request, payload(link, `vincular ${code}`))).status()).toBe(200);
  expect(await replyTo(link)).toContain("vinculado");

  const expense = randomUUID();
  await post(request, payload(expense, "Gastei 50 reais no mercado na Carteira"));
  expect(await replyTo(expense)).toContain("Confirme o lançamento");

  const confirm = randomUUID();
  await post(request, payload(confirm, "sim"));
  expect(await replyTo(confirm)).toContain("Despesa registrada");
  // A Meta reenvia o mesmo webhook: não grava de novo.
  await post(request, payload(confirm, "sim"));
  await new Promise((r) => setTimeout(r, 800));

  const rows = await sql("SELECT count(*)::int AS n FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.email = $1", [email]);
  expect(rows[0].n).toBe(1);
  await page.goto("/");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", "-5000");

  await page.goto("/configuracoes");
  await expect(page.getByText("conectado")).toBeVisible();
  await expect(page.getByText("Gastei 50 reais no mercado na Carteira")).toBeVisible();
});
