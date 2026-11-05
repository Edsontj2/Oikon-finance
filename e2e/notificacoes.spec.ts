import { expect, test } from "@playwright/test";
import { dialog, expectToast, signup } from "./helpers";

test("app Android: vincular com código, receber notificação, confirmar no site e não duplicar", async ({ page }) => {
  await signup(page);
  await page.goto("/notificacoes");
  await page.getByRole("button", { name: "Gerar código de vínculo" }).click();
  const code = (await page.getByTestId("codigo-celular").locator("strong").textContent())!.replace(/\D/g, "");
  expect(code).toHaveLength(8);

  const link = await page.request.post("/api/app/vincular", { data: { code, deviceName: "Teste" } });
  expect(link.status()).toBe(200);
  const { token } = await link.json();
  expect((await page.request.post("/api/app/vincular", { data: { code, deviceName: "Outro" } })).status()).toBe(400);
  expect((await page.request.get("/api/app/status", { headers: { Authorization: "Bearer errado-errado-errado-errado" } })).status()).toBe(401);

  const batch = { notifications: [{ id: "n_teste_1", package: "com.nu.production", appName: "Nubank", title: "Pix enviado", text: "Você enviou um Pix de R$ 42,00 para Padaria Sol.", postedAt: new Date().toISOString() }] };
  const up = await page.request.post("/api/app/notificacoes", { data: batch, headers: { Authorization: `Bearer ${token}` } });
  expect(await up.json()).toEqual({ accepted: 1, duplicates: 0, invalid: 0 });
  const again = await page.request.post("/api/app/notificacoes", { data: batch, headers: { Authorization: `Bearer ${token}` } });
  expect(await again.json()).toEqual({ accepted: 0, duplicates: 1, invalid: 0 });

  await page.goto("/");
  await expect(page.getByTestId("aviso-notificacoes")).toContainText("1 notificação do banco");
  await page.getByTestId("aviso-notificacoes").click();
  const card = page.getByTestId("notificacao");
  await expect(card).toContainText("Pix enviado · R$");
  await expect(card.getByLabel("Descrição")).toHaveValue("Pix para Padaria Sol");
  await card.getByLabel("Conta ou cartão").selectOption({ label: "Carteira" });
  await card.getByRole("button", { name: "Confirmar e lançar" }).click();
  await expectToast(page, "Lançamento criado.");
  await expect(page.getByTestId("notificacao")).toHaveCount(0);
  await page.goto("/lancamentos");
  await expect(page.getByTestId("lancamento").filter({ hasText: "Pix para Padaria Sol" })).toHaveCount(1);

  await page.goto("/notificacoes");
  await page.getByRole("button", { name: "Desvincular" }).click();
  await expectToast(page, "Celular desvinculado.");
  expect((await page.request.get("/api/app/status", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
  void dialog;
});
