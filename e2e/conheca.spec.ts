import { expect, test } from "@playwright/test";
import { signup } from "./helpers";

test("página de vendas: aberta sem login, leva ao cadastro; logado, leva ao painel; no app vai ao login", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/conheca$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Controle hoje");
  await expect(page.getByRole("heading", { name: "O banco avisa. O OIKON anota. Você só confirma." })).toBeVisible();
  await page.getByText("Preciso dar a senha do meu banco?").click();
  await expect(page.getByText("O OIKON nunca pede senha de banco.")).toBeVisible();
  await page.getByRole("link", { name: "Criar minha conta" }).first().click();
  await expect(page).toHaveURL(/\/cadastro$/);

  await signup(page);
  await page.goto("/conheca");
  await page.getByRole("link", { name: "Abrir meu OIKON" }).first().click();
  await expect(page).toHaveURL(/\/$/);

  // Dentro do app Android, quem não está logado vai direto para o login.
  const app = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 14) OikonAndroid/3" });
  const appPage = await app.newPage();
  await appPage.goto("/");
  await expect(appPage).toHaveURL(/\/login$/);
  await app.close();
});

test("página de vendas cabe no celular sem rolar para o lado", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/conheca");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(0);
});
