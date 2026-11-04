import { expect, test } from "@playwright/test";
import { dialog, expectToast, signup, sql } from "./helpers";

test("cartão: configurar fechamento e limite, ver a fatura fechada e pagá-la pela conta", async ({ page }) => {
  // Fecha dia 1 e vence dia 28: uma compra do mês passado está na fatura fechada deste mês.
  test.skip(new Date().getDate() > 27, "depende de hoje estar entre o fechamento e o vencimento");
  const email = await signup(page);
  await page.goto("/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog(page).getByLabel("Nome").fill("Visa Roxo");
  await dialog(page).getByLabel("Tipo").selectOption({ label: "Cartão de crédito" });
  await dialog(page).getByRole("button", { name: "Criar conta" }).click();
  await expectToast(page, "Conta criada");

  await page.goto("/cartoes");
  await expect(page.getByText("Cadastre fechamento e vencimento")).toBeVisible();
  await page.getByRole("link", { name: "Abrir cartão Visa Roxo" }).click();
  await page.getByRole("button", { name: "Configurar" }).click();
  await dialog(page).getByLabel("Limite total (R$)").fill("2.000,00");
  await dialog(page).getByLabel("Dia de fechamento").fill("1");
  await dialog(page).getByLabel("Dia de vencimento").fill("28");
  await dialog(page).getByLabel("Final").fill("4321");
  await dialog(page).getByRole("button", { name: "Salvar" }).click();
  await expectToast(page, "Cartão atualizado");

  await sql(
    `INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id)
     SELECT u.id, 'expense', 'Compra do mês passado', 45000, (date_trunc('month', current_date) - interval '10 days')::date, true, a.id
       FROM users u JOIN accounts a ON a.user_id = u.id AND a.name = 'Visa Roxo' WHERE u.email = $1`,
    [email],
  );
  await page.reload();
  await expect(page.getByTestId("fatura-restante")).toHaveAttribute("data-cents", "45000");
  await expect(page.getByTestId("cartao-disponivel")).toHaveAttribute("data-cents", "155000");

  await page.getByRole("button", { name: "Pagar fatura" }).click();
  await expect(dialog(page).getByLabel("Valor (R$)")).toHaveValue("450,00");
  await dialog(page).getByRole("button", { name: "Registrar pagamento" }).click();
  await expectToast(page, "Pagamento registrado");
  await expect(page.getByTestId("cartao-deve")).toHaveAttribute("data-cents", "0");
  await expect(page.getByText("Paga", { exact: true })).toBeVisible();
});
