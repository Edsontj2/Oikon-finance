import { expect, test } from "@playwright/test";
import { lancar, signup } from "./helpers";

test("relatório do mês mostra o resumo e exporta CSV sem fórmulas", async ({ page }) => {
  await signup(page);
  await lancar(page, { descricao: "Salário", tipo: "Entrada", valor: "3000", conta: "Carteira" });
  await lancar(page, { descricao: "=HYPERLINK(1)", valor: "45,50", conta: "Carteira", categoria: "Mercado" });
  await page.goto("/relatorio");
  await expect(page.getByRole("heading", { name: /Relatório financeiro/ })).toBeVisible();
  await expect(page.locator(".report")).toContainText("Resultado");
  await expect(page.locator(".report")).toContainText("2.954,50");
  await expect(page.locator(".report")).toContainText("Mercado");

  const res = await page.request.get(`/api/exportar?mes=${new Date().toISOString().slice(0, 7)}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("oikon-lancamentos-");
  const csv = await res.text();
  expect(csv).toContain("Data;Descrição;Tipo;Valor");
  expect(csv).toContain("'=HYPERLINK(1);Saída;-45,50;Pago;Carteira;;Mercado");
  expect(csv).toContain("Salário;Entrada;3000,00;Pago");

  await page.context().clearCookies();
  const anon = await page.request.get("/api/exportar", { maxRedirects: 0 });
  expect(anon.status()).not.toBe(200);
});
