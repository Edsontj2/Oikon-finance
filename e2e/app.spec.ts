import { expect, test, type Page } from "@playwright/test";

const R = (reais: number) => String(Math.round(reais * 100));

async function signup(page: Page, name: string, email: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.locator("[name=senha]").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
}

type Lancamento = {
  tipo: "Saída (gasto)" | "Entrada (recebimento)" | "Transferência entre contas";
  descricao: string;
  valor: string;
  conta?: string;
  destino?: string;
  categoria?: string;
  pago?: boolean;
  repetir?: number;
};

async function lancar(page: Page, l: Lancamento) {
  await page.goto("/lancamentos");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Salvar lançamento" }) });
  await form.locator("[name=tipo]").selectOption({ label: l.tipo });
  await form.locator("[name=descricao]").fill(l.descricao);
  await form.locator("[name=valor]").fill(l.valor);
  if (l.conta) await form.locator("[name=conta]").selectOption({ label: l.conta });
  if (l.destino) await form.locator("[name=destino]").selectOption({ label: l.destino });
  if (l.categoria) await form.locator("[name=categoria]").selectOption({ label: l.categoria });
  if (l.repetir) await form.locator("[name=repetir]").fill(String(l.repetir));
  if (l.pago === false) await form.locator("[name=pago]").uncheck();
  await form.getByRole("button", { name: "Salvar lançamento" }).click();
  // Espera o servidor responder (sucesso ou erro) antes de seguir.
  await expect(page.locator(".flash")).toBeVisible();
}

async function expectSaldos(page: Page, total: number, contas: Record<string, number>) {
  await page.goto("/");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", R(total));
  for (const [nome, valor] of Object.entries(contas)) {
    await expect(page.getByTestId(`saldo-${nome}`)).toHaveAttribute("data-cents", R(valor));
  }
}

test("fluxo completo: contas, lançamentos, pendentes, transferência, categorias e painel", async ({ page }) => {
  // Sem login, tudo leva para a tela de entrar.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await signup(page, "Edson", "edson@teste.com");
  await expectSaldos(page, 0, { Carteira: 0 });

  // Nova conta com saldo inicial.
  await page.goto("/contas");
  await page.getByLabel("Nome").fill("Banco");
  await page.locator("[name=tipo]").selectOption({ label: "Conta corrente" });
  await page.locator("[name=saldo_inicial]").fill("1.000,00");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Conta criada.")).toBeVisible();
  await expect(page.getByTestId("contas-total")).toHaveAttribute("data-cents", R(1000));

  // Entrada SOMA.
  await lancar(page, { tipo: "Entrada (recebimento)", descricao: "Salário", valor: "2.500,00", conta: "Banco", categoria: "Salário" });
  await expect(page.getByText("Lançamento salvo.")).toBeVisible();
  await expectSaldos(page, 3500, { Banco: 3500, Carteira: 0 });
  await expect(page.getByTestId("entradas-mes")).toHaveAttribute("data-cents", R(2500));

  // Saída SUBTRAI.
  await lancar(page, { tipo: "Saída (gasto)", descricao: "Supermercado", valor: "350,50", conta: "Banco", categoria: "Mercado" });
  await expectSaldos(page, 3149.5, { Banco: 3149.5 });
  await expect(page.getByTestId("saidas-mes")).toHaveAttribute("data-cents", R(-350.5));
  await expect(page.getByTestId("resultado-mes")).toHaveAttribute("data-cents", R(2149.5));

  // Saída pendente NÃO mexe no saldo até ser marcada como paga.
  await lancar(page, { tipo: "Saída (gasto)", descricao: "Aluguel", valor: "1200", conta: "Banco", pago: false });
  await expectSaldos(page, 3149.5, { Banco: 3149.5 });
  await expect(page.getByTestId("a-pagar")).toHaveAttribute("data-cents", R(1200));

  await page.goto("/lancamentos");
  await page.getByTestId("lancamento").filter({ hasText: "Aluguel" }).getByRole("button", { name: /marcar pago/ }).click();
  await expect(page.getByText("Marcado como pago.")).toBeVisible();
  await expectSaldos(page, 1949.5, { Banco: 1949.5 });
  await expect(page.getByTestId("a-pagar")).toHaveAttribute("data-cents", "0");

  // Transferência: sai do Banco, entra na Carteira, total igual.
  await lancar(page, { tipo: "Transferência entre contas", descricao: "Saque", valor: "500", conta: "Banco", destino: "Carteira" });
  await expectSaldos(page, 1949.5, { Banco: 1449.5, Carteira: 500 });
  await expect(page.getByTestId("saidas-mes")).toHaveAttribute("data-cents", R(-1550.5));

  // Valor inválido mostra erro e não lança nada.
  await lancar(page, { tipo: "Saída (gasto)", descricao: "Errado", valor: "abc" });
  await expect(page.locator(".flash.erro")).toContainText("Valor inválido");
  await expect(page.getByTestId("lancamento").filter({ hasText: "Errado" })).toHaveCount(0);
  await expectSaldos(page, 1949.5, {});

  // Excluir a saída devolve o valor.
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Excluir Supermercado" }).click();
  await expect(page.getByText("Lançamento excluído.")).toBeVisible();
  await expectSaldos(page, 2300, { Banco: 1800 });

  // Repetir todo mês: este mês pago, próximo mês pendente.
  await lancar(page, { tipo: "Saída (gasto)", descricao: "Academia", valor: "100", conta: "Carteira", repetir: 3 });
  await expectSaldos(page, 2200, { Carteira: 400 });
  await page.goto("/lancamentos");
  await page.getByRole("link", { name: "Próximo mês" }).click();
  const proxima = page.getByTestId("lancamento").filter({ hasText: "Academia" });
  await expect(proxima).toHaveCount(1);
  await expect(proxima.getByText("pendente", { exact: true })).toBeVisible();

  // Categoria com limite: painel e página avisam quando passa.
  await page.goto("/categorias");
  await page.getByLabel("Nome").fill("Delivery");
  await page.locator("[name=limite]").fill("50");
  await page.getByRole("button", { name: "Criar categoria" }).click();
  await expect(page.getByText("Categoria criada.")).toBeVisible();
  await lancar(page, { tipo: "Saída (gasto)", descricao: "Pizza", valor: "80", conta: "Carteira", categoria: "Delivery" });
  await page.goto("/categorias");
  await expect(page.getByTestId("categoria").filter({ hasText: "Delivery" }).getByText("acima do limite")).toBeVisible();
  await expectSaldos(page, 2120, { Carteira: 320 });

  // Categoria de entrada em uma saída é recusada.
  await lancar(page, { tipo: "Saída (gasto)", descricao: "Trocado", valor: "10", categoria: "Salário" });
  await expect(page.locator(".flash.erro")).toHaveText("Escolha uma categoria de saída.");

  // Conta com lançamentos não pode ser excluída.
  await page.goto("/contas");
  await page.getByRole("button", { name: "Excluir conta Banco" }).click();
  await expect(page.locator(".flash.erro")).toContainText("Essa conta tem lançamentos");

  // Sair.
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/lancamentos");
  await expect(page).toHaveURL(/\/login$/);
});

test("login errado é recusado e outra pessoa não vê os dados da primeira", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("edson@teste.com");
  await page.locator("[name=senha]").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".flash.erro")).toHaveText("E-mail ou senha incorretos.");

  await page.getByLabel("E-mail").fill("edson@teste.com");
  await page.locator("[name=senha]").fill("senha-segura-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", R(2120));
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await signup(page, "Maria", "maria@teste.com");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", "0");
  await page.goto("/lancamentos");
  await expect(page.getByTestId("lancamento")).toHaveCount(0);
  await page.goto("/contas");
  await expect(page.getByTestId("conta")).toHaveCount(1);
});
