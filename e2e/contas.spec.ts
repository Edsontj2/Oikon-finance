import { expect, test } from "@playwright/test";
import { dialog, expectToast, signup } from "./helpers";

test("conta: instituição, ícone, cheque especial, conciliação com ajuste e histórico", async ({ page }) => {
  await signup(page);
  await page.goto("/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog(page).getByLabel("Nome").fill("Banco Azul");
  await dialog(page).getByLabel("Instituição (opcional)").fill("Banco Azul S.A.");
  await dialog(page).getByLabel("Saldo inicial (R$)").fill("1.000,00");
  await dialog(page).getByLabel("Cheque especial (R$, opcional)").fill("500");
  await dialog(page).getByRole("radio", { name: "Banco digital" }).check();
  await dialog(page).getByRole("button", { name: "Criar conta" }).click();
  await expectToast(page, "Conta criada");
  await expect(page.getByText("Banco Azul S.A.")).toBeVisible();

  await page.getByRole("button", { name: "Editar conta Banco Azul" }).click();
  await dialog(page).getByRole("link", { name: /onciliação e histórico|Conciliar e histórico/ }).click();
  await expect(page.getByTestId("conta-saldo")).toHaveAttribute("data-cents", "100000");

  await page.getByLabel("Saldo no extrato (R$)").fill("987,65");
  await page.getByRole("button", { name: "Conciliar" }).click();
  await expectToast(page, "Conciliação registrada");
  await expect(page.getByTestId("conta-saldo")).toHaveAttribute("data-cents", "98765");
  await expect(page.getByTestId("conciliacoes")).toContainText("ajuste");
  await expect(page.getByText(/Ajuste de conciliação.*criado/)).toBeVisible();

  await page.getByRole("button", { name: "Arquivar conta" }).click();
  await expect(page.getByText("Só dá para arquivar com o saldo zerado")).toBeVisible();
});
