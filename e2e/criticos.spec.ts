import { expect, test } from "@playwright/test";
import { signup, sql } from "./helpers";

test("duplo clique em 'Salvar lançamento' cria um lançamento só", async ({ page }) => {
  const email = await signup(page);
  await page.goto("/lancamentos");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Salvar lançamento" }) });
  await form.locator("[name=descricao]").fill("Padaria");
  await form.locator("[name=valor]").fill("10,00");
  await form.getByRole("button", { name: "Salvar lançamento" }).dblclick();
  await expect(page.locator(".flash")).toBeVisible();
  await page.waitForTimeout(1000);
  const rows = await sql(
    "SELECT count(*)::int AS n FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.email = $1",
    [email],
  );
  expect(rows[0].n).toBe(1);
});

test("depois de sair, o cookie antigo não dá mais acesso", async ({ page, context }) => {
  await signup(page);
  const cookies = await context.cookies();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await context.addCookies(cookies);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("usuário apagado volta para o login em vez de ficar preso", async ({ page }) => {
  const email = await signup(page);
  await sql("DELETE FROM users WHERE email = $1", [email]);
  await page.goto("/contas");
  await expect(page).toHaveURL(/\/login$/);
});

test("muitas tentativas de login com senha errada são bloqueadas", async ({ page }) => {
  const email = await signup(page);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const tryWrongPassword = async () => {
    await page.getByLabel("E-mail").fill(email);
    await page.locator("[name=senha]").fill("senha-errada");
    // Espera o servidor responder antes da próxima tentativa.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Entrar" }).click(),
    ]);
    return page.locator(".flash.erro");
  };
  for (let i = 0; i < 8; i++) await expect(await tryWrongPassword()).toHaveText("E-mail ou senha incorretos.");
  await expect(await tryWrongPassword()).toContainText("Muitas tentativas");
});
