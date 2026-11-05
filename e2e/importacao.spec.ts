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
