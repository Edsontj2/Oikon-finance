import { expect, test } from "@playwright/test";
import { dialog, expectToast, lancar, signup } from "./helpers";

test("subcategoria, orçamento do mês, previsão de saldo e meta com valor guardado", async ({ page }) => {
  await signup(page);
  // Categoria principal com limite e uma subcategoria dentro.
  await page.goto("/categorias");
  await page.getByRole("button", { name: "Nova categoria" }).click();
  await dialog(page).getByLabel("Nome").fill("Comida");
  await dialog(page).getByLabel("Limite mensal (R$)").fill("500");
  await dialog(page).getByRole("button", { name: "Criar categoria" }).click();
  await expectToast(page, "Categoria criada.");
  await page.getByRole("button", { name: "Nova categoria" }).click();
  await dialog(page).getByLabel("Nome").fill("Restaurante");
  await dialog(page).getByLabel("Dentro de (opcional)").selectOption({ label: "Comida" });
  await dialog(page).getByRole("button", { name: "Criar categoria" }).click();
  await expectToast(page, "Categoria criada.");

  await lancar(page, { descricao: "Salário", tipo: "Entrada", valor: "3000", conta: "Carteira" });
  await lancar(page, { descricao: "Jantar", valor: "420", conta: "Carteira", categoria: "Comida › Restaurante" });

  await page.goto("/planejamento");
  const linha = page.getByTestId("orcamento-linha").filter({ hasText: "Comida" }).first();
  await expect(linha).toContainText("84% do limite");
  await expect(page.getByTestId("orcamento-planejado")).toHaveAttribute("data-cents", "50000");
  await expect(page.getByTestId("previsao-hoje")).toHaveAttribute("data-cents", "258000");
  await expect(page.getByTestId("previsao-30")).toContainText("2.580,00");

  await page.goto("/metas");
  await page.getByRole("button", { name: "Nova meta" }).click();
  await dialog(page).getByLabel("Nome").fill("Viagem");
  await dialog(page).getByLabel("Quanto quer juntar (R$)").fill("6000");
  await dialog(page).getByRole("button", { name: "Criar meta" }).click();
  await expectToast(page, "Meta criada.");
  await page.getByTestId("meta").filter({ hasText: "Viagem" }).getByRole("button", { name: "Guardar" }).click();
  await dialog(page).getByLabel("Valor (R$)").fill("1500");
  await dialog(page).getByRole("button", { name: "Guardar" }).click();
  await expectToast(page, "Valor guardado.");
  await expect(page.getByTestId("meta-guardado-Viagem")).toHaveAttribute("data-cents", "150000");
  await expect(page.getByTestId("meta").filter({ hasText: "Viagem" })).toContainText("25%");

  // Painel: panorama com dinheiro nas contas e previsão.
  await page.goto("/");
  await expect(page.getByTestId("saldo-disponivel")).toHaveAttribute("data-cents", "258000");
  await expect(page.getByRole("heading", { name: /Evolução do patrimônio/ })).toBeVisible();
});

test("todo mês: dezembro mostra o previsto (um só), o total a pagar e dá para pagar adiantado", async ({ page }) => {
  await signup(page);
  await lancar(page, { descricao: "Internet", valor: "100", conta: "Carteira", pago: false, repetir: true });
  await page.goto("/lancamentos?mes=2026-12");
  await expect(page.getByTestId("lancamento-previsto")).toHaveCount(1);
  await expect(page.getByTestId("lancamento-previsto")).toContainText("Internet");
  await expect(page.getByTestId("mes-a-pagar")).toHaveAttribute("data-cents", "-10000");
  await page.goto("/lancamentos?mes=2027-01");
  await expect(page.getByTestId("lancamento-previsto")).toHaveCount(1);

  await page.goto("/lancamentos?mes=2026-12");
  await page.getByRole("button", { name: "Previsto: Internet" }).click();
  await dialog(page).getByRole("button", { name: "Pagar agora" }).click();
  await expectToast(page, /Pago agora/);
  await expect(page.getByTestId("lancamento-previsto")).toHaveCount(0);
  await page.goto("/lancamentos?mes=2027-01");
  await expect(page.getByTestId("lancamento-previsto")).toHaveCount(1);
});
