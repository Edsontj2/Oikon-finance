import { expect, test } from "@playwright/test";
import { expectToast, lancar, signup } from "./helpers";

const CSV = "Data;Descrição;Valor\n03/11/2026;Mercado;-120,00\n04/11/2026;Conta de luz;-150,00\n05/11/2026;Salário;3.000,00\n";

test("importar CSV: mostra novo e pendente, grava, e reimportar não duplica", async ({ page }) => {
  await signup(page);
  await lancar(page, { descricao: "Luz", valor: "150", conta: "Carteira", data: "2026-11-10", pago: false });
  await page.goto("/importar");
  const file = { name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "latin1") };
  await page.getByLabel("Arquivo (.ofx ou .csv)").setInputFiles(file);
  const linhas = page.getByTestId("linha-extrato");
  await expect(linhas).toHaveCount(3);
  await expect(linhas.filter({ hasText: "Conta de luz" })).toContainText("Confirma um pendente");
  await expect(linhas.filter({ hasText: "Salário" })).toContainText("Novo");
  await page.getByRole("button", { name: /Gravar \(2 novos, 1 a conciliar\)/ }).click();
  await expectToast(page, /Extrato importado: 2 lançados, 1 pendente marcado como pago/);

  await page.getByLabel("Arquivo (.ofx ou .csv)").setInputFiles(file);
  await expect(linhas).toHaveCount(3);
  await expect(linhas.filter({ hasText: "Já importado" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Gravar \(0 novos, 0 a conciliar\)/ })).toBeDisabled();
});

test("desfazer importação: some o que veio do extrato e o pendente volta a ser pendente", async ({ page }) => {
  await signup(page);
  await lancar(page, { descricao: "Luz", valor: "150", conta: "Carteira", data: "2026-11-10", pago: false });
  await page.goto("/importar");
  await page.getByLabel("Arquivo (.ofx ou .csv)").setInputFiles({ name: "extrato-nov.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "latin1") });
  await page.getByRole("button", { name: /Gravar \(2 novos, 1 a conciliar\)/ }).click();
  await expectToast(page, /Extrato importado/);
  const imp = page.getByTestId("importacao");
  await expect(imp).toHaveCount(1);
  await expect(imp).toContainText("extrato-nov.csv · Carteira");
  await expect(imp).toContainText("2 lançados, 1 conciliado");

  await imp.getByRole("button", { name: "Desfazer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer importação" }).click();
  await expectToast(page, "Importação desfeita: 2 lançamentos excluídos, 1 conciliado restaurado.");
  await expect(imp).toContainText("Desfeita");

  await page.goto("/lancamentos?mes=2026-11");
  const linhas = page.getByTestId("lancamento");
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toContainText("Luz");
  await expect(linhas.first()).toContainText("pendente");
});

test("excluir vários lançamentos de uma vez", async ({ page }) => {
  await signup(page);
  for (const [d, v] of [["Café", "8"], ["Pão", "12"], ["Uber", "25"]]) await lancar(page, { descricao: d, valor: v, conta: "Carteira", data: "2026-11-04" });
  await page.getByRole("button", { name: "Selecionar" }).click();
  await expect(page.getByRole("button", { name: "Novo lançamento" })).toHaveCount(0);
  await page.getByLabel("Selecionar Café").check();
  await page.getByLabel("Selecionar Uber").check();
  await expect(page.getByTestId("selecionados")).toHaveText("2 selecionados");
  await page.getByRole("region", { name: "Seleção" }).getByRole("button", { name: "Excluir" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Excluir 2 lançamentos?");
  await dlg.getByRole("button", { name: "Excluir" }).click();
  await expectToast(page, "2 lançamentos excluídos.");
  await expect(page.getByTestId("lancamento")).toHaveCount(1);
  await expect(page.getByTestId("lancamento")).toContainText("Pão");
  await expect(page.getByRole("button", { name: "Novo lançamento" }).first()).toBeVisible();

  // "Selecionar todos" do mês.
  await page.getByRole("button", { name: "Selecionar" }).click();
  await page.getByLabel(/Selecionar todos de/).check();
  await expect(page.getByTestId("selecionados")).toHaveText("1 selecionado");
  await page.getByRole("button", { name: "Cancelar seleção" }).click();
  await expect(page.getByTestId("lancamento")).toHaveCount(1);
});
