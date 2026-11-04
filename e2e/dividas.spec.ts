import { expect, test } from "@playwright/test";
import { dialog, expectToast, signup } from "./helpers";

test("simular, registrar empréstimo e pagar a parcela pela agenda", async ({ page }) => {
  await signup(page);
  await page.goto("/dividas");
  await page.getByLabel("Valor (R$)").fill("10.000");
  await page.getByLabel("Juros ao mês (%)").fill("2");
  await page.getByLabel("Parcelas").fill("12");
  await expect(page.getByTestId("simulacao")).toContainText("945,60");

  await page.getByRole("button", { name: "Registrar com estes dados" }).click();
  await dialog(page).getByLabel("Nome").fill("Consignado");
  await expect(dialog(page).getByLabel("Valor emprestado (R$)")).toHaveValue("10.000,00");
  await dialog(page).getByLabel("O dinheiro caiu em").selectOption({ label: "Carteira" });
  await dialog(page).getByRole("button", { name: "Registrar" }).click();
  await expectToast(page, "Empréstimo registrado");
  await expect(page.getByTestId("emprestimo-saldo-Consignado")).toHaveAttribute("data-cents", "-1000000");
  await expect(page.getByTestId("dividas-devo")).toHaveAttribute("data-cents", "1000000");

  await page.goto("/agenda");
  const month = page.getByTestId(/agenda-(week|month)/).first();
  await expect(month).toContainText("Parcela 1/12 · Consignado");
  await month.getByRole("button", { name: "Pago" }).first().click();
  await expectToast(page, "Marcado como pago");
  await page.goto("/dividas");
  await expect(page.getByText("1/12 parcelas pagas")).toBeVisible();
});

test("celular: menu Mais leva a Cartões, Dívidas e Categorias", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page);
  await page.getByRole("navigation", { name: "Navegação" }).getByRole("link", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Dívidas e empréstimos" }).click();
  await expect(page.getByRole("heading", { name: "Dívidas e empréstimos" })).toBeVisible();
});
