import { expect, test } from "@playwright/test";
import { R, dialog, expectSaldos, expectToast, lancar, login, logout, signup } from "./helpers";

test("fluxo completo: contas, lançamentos, pendentes, transferência, categorias e painel", async ({ page }) => {
  // Sem login, tudo leva para a tela de entrar.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await signup(page, "Edson");
  await expectSaldos(page, 0, { Carteira: 0 });
  // Usuário novo não vê "-R$ 0,00".
  await expect(page.getByTestId("saidas-mes")).not.toContainText("-");

  // Nova conta com saldo inicial, pela janela.
  await page.goto("/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog(page).getByLabel("Nome").fill("Banco");
  await dialog(page).getByLabel("Tipo").selectOption({ label: "Conta corrente" });
  await dialog(page).getByLabel("Saldo inicial (R$)").fill("1.000,00");
  await expect(dialog(page).getByText("= R$ 1.000,00")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Criar conta" }).click();
  await expectToast(page, "Conta criada.");
  await expect(page.getByTestId("contas-total")).toHaveAttribute("data-cents", R(1000));

  // Entrada SOMA.
  await lancar(page, { tipo: "Entrada", descricao: "Salário", valor: "2.500,00", conta: "Banco", categoria: "Salário" });
  await expectSaldos(page, 3500, { Banco: 3500, Carteira: 0 });
  await expect(page.getByTestId("entradas-mes")).toHaveAttribute("data-cents", R(2500));

  // Saída SUBTRAI.
  await lancar(page, { tipo: "Saída", descricao: "Supermercado", valor: "350,50", conta: "Banco", categoria: "Mercado" });
  await expectSaldos(page, 3149.5, { Banco: 3149.5 });
  await expect(page.getByTestId("saidas-mes")).toHaveAttribute("data-cents", R(-350.5));
  await expect(page.getByTestId("resultado-mes")).toHaveAttribute("data-cents", R(2149.5));

  // Saída pendente NÃO mexe no saldo até ser marcada como paga.
  await lancar(page, { descricao: "Aluguel", valor: "1200", conta: "Banco", pago: false });
  await expectSaldos(page, 3149.5, { Banco: 3149.5 });
  await expect(page.getByTestId("a-pagar")).toHaveAttribute("data-cents", R(1200));

  await page.goto("/lancamentos");
  await page.getByTestId("lancamento").filter({ hasText: "Aluguel" }).getByRole("button", { name: /pendente · pagar/ }).click();
  await expectToast(page, "Marcado como pago.");
  await expectSaldos(page, 1949.5, { Banco: 1949.5 });
  await expect(page.getByTestId("a-pagar")).toHaveCount(0);

  // Transferência: sai do Banco, entra na Carteira, total igual e não conta como gasto.
  await lancar(page, { tipo: "Transferência", descricao: "Saque", valor: "500", conta: "Banco", destino: "Carteira" });
  await expectSaldos(page, 1949.5, { Banco: 1449.5, Carteira: 500 });
  await expect(page.getByTestId("saidas-mes")).toHaveAttribute("data-cents", R(-1550.5));

  // Valor inválido: a janela avisa, mantém o que foi digitado e não lança nada.
  await lancar(page, { descricao: "Errado", valor: "abc" }, "Valor inválido");
  await expect(dialog(page).getByLabel("Descrição")).toHaveValue("Errado");
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByTestId("lancamento").filter({ hasText: "Errado" })).toHaveCount(0);
  await expectSaldos(page, 1949.5, {});

  // Editar muda o valor e o saldo acompanha.
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Editar Supermercado" }).click();
  await dialog(page).getByLabel("Valor (R$)").fill("300");
  await dialog(page).getByRole("button", { name: "Salvar alterações" }).click();
  await expectToast(page, "Lançamento atualizado.");
  await expectSaldos(page, 2000, { Banco: 1500 });

  // Excluir (com confirmação) devolve o valor.
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Editar Supermercado" }).click();
  await dialog(page).getByRole("button", { name: "Excluir lançamento" }).click();
  await expect(dialog(page)).toContainText("Isso não pode ser desfeito");
  await dialog(page).getByRole("button", { name: "Excluir", exact: true }).click();
  await expectToast(page, "Lançamento excluído.");
  await expectSaldos(page, 2300, { Banco: 1800 });

  // Repetir todo mês: este mês pago, os próximos pendentes.
  await lancar(page, { descricao: "Academia", valor: "100", conta: "Carteira", repetir: 3 });
  await expectSaldos(page, 2200, { Carteira: 400 });
  await page.goto("/lancamentos");
  const academia = page.getByTestId("lancamento").filter({ hasText: "Academia" });
  await expect(academia).toHaveCount(3);
  await expect(academia.getByRole("button", { name: /pendente · pagar/ })).toHaveCount(2);

  // Categoria com limite: a página avisa quando passa.
  await page.goto("/categorias");
  await page.getByRole("button", { name: "Nova categoria" }).click();
  await dialog(page).getByLabel("Nome").fill("Delivery");
  await dialog(page).getByLabel("Limite mensal (R$)").fill("50");
  await dialog(page).getByRole("button", { name: "Criar categoria" }).click();
  await expectToast(page, "Categoria criada.");
  await lancar(page, { descricao: "Pizza", valor: "80", conta: "Carteira", categoria: "Delivery" });
  await page.goto("/categorias");
  await expect(page.getByTestId("categoria").filter({ hasText: "Delivery" }).getByText("acima do limite")).toBeVisible();
  await expectSaldos(page, 2120, { Carteira: 320 });
  await expect(page.locator(".insights")).toContainText("Delivery passou do limite");

  // Conta com lançamentos não pode ser excluída: a confirmação explica e não oferece "Excluir".
  await page.goto("/contas");
  await page.getByRole("button", { name: "Editar conta Banco" }).click();
  await dialog(page).getByRole("button", { name: "Excluir conta" }).click();
  await expect(dialog(page)).toContainText("lançamento(s)");
  await expect(dialog(page).getByRole("button", { name: "Excluir", exact: true })).toHaveCount(0);

  // Sair.
  await page.goto("/");
  await logout(page);
  await page.goto("/lancamentos");
  await expect(page).toHaveURL(/\/login$/);
});

test("login errado é recusado e outra pessoa não vê os dados da primeira", async ({ page }) => {
  const email = await signup(page, "Ana");
  await lancar(page, { descricao: "Segredo da Ana", valor: "77" });
  await logout(page);

  await login(page, email, "senha-errada");
  await expect(page.locator(".form-error")).toHaveText("E-mail ou senha incorretos.");
  await login(page, email);
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", R(-77));
  await logout(page);

  await signup(page, "Maria");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", "0");
  await page.goto("/lancamentos");
  await expect(page.getByTestId("lancamento")).toHaveCount(0);
  await page.goto("/contas");
  await expect(page.getByTestId("conta")).toHaveCount(1);
});
