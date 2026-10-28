import { expect, test } from "@playwright/test";
import { dialog, expectToast, lancar, login, logout, preencherLancamento, signup, sql } from "./helpers";

test("duplo clique em 'Salvar lançamento' cria um lançamento só", async ({ page }) => {
  const email = await signup(page);
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await preencherLancamento(page, { descricao: "Padaria", valor: "10,00" });
  await dialog(page).getByRole("button", { name: "Salvar lançamento" }).dblclick();
  await expectToast(page, "Lançamento salvo.");
  await page.waitForTimeout(1000);
  const rows = await sql(
    "SELECT count(*)::int AS n FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.email = $1",
    [email],
  );
  expect(rows[0].n).toBe(1);
  await page.goto("/");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", "-1000");
});

test("depois de sair, o cookie antigo não dá mais acesso", async ({ page, context }) => {
  await signup(page);
  const cookies = await context.cookies();
  await logout(page);
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

test("usuário apagado com a tela aberta: salvar leva ao login, não a erro 500", async ({ page }) => {
  const email = await signup(page);
  await page.goto("/contas");
  await sql("DELETE FROM users WHERE email = $1", [email]);
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog(page).getByLabel("Nome").fill("Nova");
  await dialog(page).getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("muitas tentativas de login com senha errada são bloqueadas", async ({ page }) => {
  const email = await signup(page);
  await logout(page);
  const tryWrongPassword = async () => {
    // Espera o servidor responder antes da próxima tentativa.
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), login(page, email, "senha-errada")]);
    return page.locator(".form-error");
  };
  for (let i = 0; i < 8; i++) await expect(await tryWrongPassword()).toHaveText("E-mail ou senha incorretos.");
  await expect(await tryWrongPassword()).toContainText("Muitas tentativas");
});

test("formulário adulterado: repetir=1000 e valor negativo dão mensagem, nada é lançado", async ({ page }) => {
  await signup(page);
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await preencherLancamento(page, { descricao: "Hack", valor: "10", repetir: 2 });
  await dialog(page)
    .locator("[name=repeat]")
    .evaluate((el: HTMLInputElement) => {
      el.removeAttribute("max");
      el.value = "1000";
    });
  await dialog(page).getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("Repetir deve ser entre 1 e 60 meses.");
  await dialog(page).getByLabel("Repetir todo mês").uncheck();
  await dialog(page).getByLabel("Valor (R$)").fill("R$-5");
  await dialog(page).getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("O valor precisa ser maior que zero.");
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByTestId("lancamento")).toHaveCount(0);
});

test("filtro ?conta= com id de outra pessoa ou inválido não mostra nada dela nem quebra", async ({ page, browser }) => {
  const email = await signup(page, "Ana");
  await lancar(page, { descricao: "Segredo da Ana", valor: "77" });
  const [{ id: contaAna }] = await sql(
    "SELECT a.id FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = $1",
    [email],
  );
  const outra = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const p2 = await outra.newPage();
  await signup(p2, "Bia");
  await p2.goto(`/lancamentos?conta=${contaAna}`);
  await expect(p2.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  await expect(p2.getByText("Segredo da Ana")).toHaveCount(0);
  await p2.goto(`/lancamentos?conta=lixo'--&mes=2026-99&tipo=constructor`);
  await expect(p2.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  await outra.close();
});

test("celular: sem rolagem lateral e campos com 16px (iPhone não dá zoom)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const page = await ctx.newPage();
  await signup(page);
  for (const path of ["/", "/lancamentos", "/contas", "/categorias"]) {
    await page.goto(path);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `rolagem lateral em ${path}`).toBeLessThanOrEqual(390);
  }
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  const sizes = await dialog(page)
    .locator("input:not([type=hidden]):not([type=checkbox]), select")
    .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  await ctx.close();
});

test("pagar antes do vencimento baixa o saldo na hora e os cartões do painel fecham", async ({ page }) => {
  await signup(page);
  const vencimento = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await lancar(page, { tipo: "Entrada", descricao: "Salário", valor: "5000" });
  await lancar(page, { descricao: "Aluguel", valor: "1800", data: vencimento, pago: false });
  await page.getByTestId("lancamento").filter({ hasText: "Aluguel" }).getByRole("button", { name: /pendente · pagar/ }).click();
  await expectToast(page, "Marcado como pago.");
  await page.goto("/");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", "320000");
  await expect(page.getByTestId("saidas-mes")).toHaveAttribute("data-cents", "-180000");
});

test("celular pequeno: 'Salvar lançamento' aparece sem rolar e tocar fora não apaga o que foi digitado", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const page = await ctx.newPage();
  await signup(page);
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await dialog(page).getByLabel("Descrição").fill("Farmácia");
  await expect(dialog(page).getByRole("button", { name: "Salvar lançamento" })).toBeInViewport();
  await page.mouse.click(160, 5);
  await expect(dialog(page).getByLabel("Descrição")).toHaveValue("Farmácia");
  await ctx.close();
});
