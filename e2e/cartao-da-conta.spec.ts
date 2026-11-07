import { expect, test } from "@playwright/test";
import { dialog, expectToast, signup, sql } from "./helpers";

test("conta corrente com cartão: criar junto e pagar a fatura com o saldo da conta", async ({ page }) => {
  // Fecha dia 1 e vence dia 28: uma compra do mês passado está na fatura fechada deste mês.
  test.skip(new Date().getDate() > 27, "depende de hoje estar entre o fechamento e o vencimento");
  const email = await signup(page);
  await page.goto("/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog(page).getByLabel("Nome").fill("Banco Verde");
  await dialog(page).getByLabel("Saldo inicial (R$)").fill("1.000,00");
  await dialog(page).getByLabel("Esta conta também tem cartão de crédito").check();
  await dialog(page).getByLabel("Limite do cartão (R$)").fill("2.000,00");
  await dialog(page).getByLabel("Dia de fechamento").fill("1");
  await dialog(page).getByLabel("Dia de vencimento").fill("28");
  await dialog(page).getByRole("button", { name: "Criar conta" }).click();
  await expectToast(page, "Conta e cartão de crédito criados");
  await expect(page.getByText("Cartão da conta Banco Verde")).toBeVisible();

  await sql(
    `INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id)
     SELECT u.id, 'expense', 'Compra do mês passado', 30000, (date_trunc('month', current_date) - interval '10 days')::date, true, a.id
       FROM users u JOIN accounts a ON a.user_id = u.id AND a.name = 'Cartão Banco Verde' WHERE u.email = $1`,
    [email],
  );

  await page.getByRole("button", { name: "Editar conta Banco Verde" }).click();
  await dialog(page).getByRole("link", { name: "Cartão, conciliação e histórico" }).click();
  await expect(page.getByTestId("cartao-conta-fatura")).toHaveAttribute("data-cents", "30000");
  await expect(page.getByLabel("Valor a pagar (R$)")).toHaveValue("300,00");
  await page.getByRole("button", { name: "Pagar com o saldo desta conta" }).click();
  await expectToast(page, "Pagamento registrado");
  await expect(page.getByTestId("conta-saldo")).toHaveAttribute("data-cents", "70000");
  await expect(page.getByTestId("cartao-conta-fatura")).toHaveAttribute("data-cents", "0");

  await page.getByRole("button", { name: "Desligar cartão da conta" }).click();
  await expectToast(page, "Cartão desligado da conta");
  await expect(page.getByRole("button", { name: "Adicionar cartão de crédito" })).toBeVisible();
  await page.getByRole("button", { name: "Ligar à conta" }).click();
  await expectToast(page, "Cartão ligado à conta");
  await expect(page.getByTestId("cartao-da-conta")).toContainText("Cartão Banco Verde");
});
