import { expect, test } from "@playwright/test";
import { expectToast, signup, sql } from "./helpers";

test("planos ficam escondidos até serem liberados pelo administrador", async ({ page }) => {
  await page.goto("/conheca");
  await expect(page.getByTestId("plano-inteligente")).toHaveCount(0);
  await signup(page);
  await expect(page.getByTestId("aviso-teste")).toHaveCount(0);
});

test("planos: página de vendas mostra os três preços e a área de assinatura inicia o teste grátis", async ({ page }) => {
  await sql("UPDATE app_settings SET value = 'true' WHERE key = 'plans_public'");
  await page.goto("/conheca");
  await expect(page.getByTestId("plano-essencial")).toContainText("R$ 12,90");
  await expect(page.getByTestId("plano-inteligente")).toContainText("Mais popular");
  await expect(page.getByTestId("plano-inteligente")).toContainText("R$ 19,90"); // oferta de lançamento com vagas
  await expect(page.getByTestId("plano-inteligente")).toContainText("R$ 24,90");
  await expect(page.getByTestId("plano-premium")).toContainText("R$ 34,90");
  await expect(page.getByTestId("plano-premium")).toContainText("1.000 interações de IA");

  await signup(page);
  await expect(page.getByTestId("aviso-teste")).toBeVisible();
  await page.goto("/assinatura");
  await expect(page.getByTestId("plano-atual")).toContainText("Sem assinatura");
  // Sem gateway de pagamento configurado, não há botão de pagar (nada fictício).
  await expect(page.getByRole("button", { name: /Assinar por/ })).toHaveCount(0);
  await expect(page.getByText("Contratação online em breve.").first()).toBeVisible();

  await page.getByRole("button", { name: /dias grátis do Inteligente/ }).click();
  await expectToast(page, "Teste grátis iniciado");
  await expect(page.getByTestId("plano-atual")).toContainText("OIKON Inteligente (teste grátis) · Teste grátis");
  await expect(page.getByTestId("plano-atual")).toContainText("0 de 30 interações");
  await page.goto("/");
  await expect(page.getByTestId("aviso-teste")).toHaveCount(0);

  await page.goto("/assinatura");
  await page.getByRole("button", { name: "Encerrar teste" }).click();
  await expectToast(page, "Cancelamento registrado");
  await expect(page.getByTestId("plano-atual")).toContainText("Sem assinatura");
  await expect(page.getByRole("button", { name: /dias grátis/ })).toHaveCount(0); // teste é um só
  await sql("UPDATE app_settings SET value = 'false' WHERE key = 'plans_public'");
});
