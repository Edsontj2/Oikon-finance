import { expect, test, type Page } from "@playwright/test";
import { dialog, expectSaldos, expectToast, lancar, preencherLancamento, signup, sql } from "./helpers";

async function userAndWallet(email: string) {
  const rows = await sql(
    "SELECT u.id AS uid, a.id AS aid FROM users u JOIN accounts a ON a.user_id = u.id WHERE u.email = $1 ORDER BY a.created_at LIMIT 1",
    [email],
  );
  return rows[0] as { uid: string; aid: string };
}

async function bulk(uid: string, aid: string, n: number, desc: string, date: string, type = "expense") {
  await sql(
    `INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id, created_at)
     SELECT $1, $5, $3 || ' ' || g, 100, $4::date, true, $2, now() - g * interval '1 second' FROM generate_series(1, $6::int) g`,
    [uid, aid, desc, date, type, n],
  );
}

function linhas(page: Page) {
  return page.getByTestId("lancamento");
}

test("janela: erro mantém o que foi digitado; Esc fecha; reabrir começa limpo", async ({ page }) => {
  await signup(page);
  await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await expect(dialog(page)).toHaveCount(1);
  await preencherLancamento(page, { descricao: "Farmácia", valor: "12,3,4" });
  await dialog(page).getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Valor inválido");
  await expect(dialog(page).getByLabel("Descrição")).toHaveValue("Farmácia");
  await expect(dialog(page).getByLabel("Valor (R$)")).toHaveValue("12,3,4");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await expect(dialog(page).getByLabel("Descrição")).toHaveValue("");
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const n = await sql("SELECT count(*)::int AS n FROM transactions WHERE description = 'Farmácia'");
  expect(n[0].n).toBe(0);
});

test("excluir pede confirmação; Cancelar e Esc não apagam; 'Este e os próximos' apaga a série a partir dali", async ({ page }) => {
  await signup(page);
  await lancar(page, { descricao: "Streaming", valor: "30,00", data: "2026-08-10", repetir: 4 });
  await expect(linhas(page)).toHaveCount(4);
  // Abre a parcela de setembro (2ª mais antiga)
  await page.getByRole("button", { name: "Editar Streaming" }).nth(2).click();
  await dialog(page).getByRole("button", { name: "Excluir lançamento" }).click();
  await expect(dialog(page)).toContainText("Excluir lançamento?");
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(4);

  await page.getByRole("button", { name: "Editar Streaming" }).nth(2).click();
  await dialog(page).getByRole("button", { name: "Excluir lançamento" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(linhas(page)).toHaveCount(4);

  await page.getByRole("button", { name: "Editar Streaming" }).nth(2).click();
  await expect(dialog(page).getByLabel("Data")).toHaveValue("2026-09-10");
  await dialog(page).getByRole("button", { name: "Excluir lançamento" }).click();
  await dialog(page).getByRole("button", { name: "Este e os próximos" }).click();
  await expectToast(page, "Lançamentos excluídos.");
  await expect(linhas(page)).toHaveCount(1);
  await expect(linhas(page).first()).toContainText("10/08/2026");
  await expectSaldos(page, -30, { Carteira: -30 });
});

test("editar valor e tipo de um lançamento pago pela janela atualiza o painel", async ({ page }) => {
  await signup(page);
  await lancar(page, { descricao: "Conserto", valor: "100,00" });
  await page.getByRole("button", { name: "Editar Conserto" }).click();
  await dialog(page).getByLabel("Valor (R$)").fill("250,00");
  await dialog(page).getByRole("radio", { name: "Entrada" }).click();
  await dialog(page).getByRole("button", { name: "Salvar alterações" }).click();
  await expectToast(page, "Lançamento atualizado.");
  await expectSaldos(page, 250, { Carteira: 250 });
  await expect(page.getByTestId("entradas-mes")).toHaveAttribute("data-cents", "25000");
  await expect(page.getByTestId("saidas-mes")).toHaveAttribute("data-cents", "0");
});

test("/lancamentos: ?tipo, ?busca, ?conta, ?mes e parâmetros inválidos", async ({ page }) => {
  const email = await signup(page);
  const { uid, aid } = await userAndWallet(email);
  await bulk(uid, aid, 2, "Mercado", "2026-10-05");
  await bulk(uid, aid, 1, "Salário", "2026-10-01", "income");
  await bulk(uid, aid, 1, "Mercado antigo", "2026-07-01");

  await page.goto("/lancamentos?tipo=income");
  await expect(linhas(page)).toHaveCount(1);
  await expect(page.getByLabel("Tipo")).toHaveValue("income");
  await page.goto("/lancamentos?busca=mercado");
  await expect(linhas(page)).toHaveCount(3);
  await page.goto("/lancamentos?busca=mercado&mes=2026-10");
  await expect(linhas(page)).toHaveCount(2);
  await page.goto(`/lancamentos?conta=${aid}&mes=2026-07`);
  await expect(linhas(page)).toHaveCount(1);
  // inválidos são ignorados (lista tudo, sem erro)
  await page.goto("/lancamentos?tipo=xpto&mes=2026-13&conta=00000000-0000-0000-0000-000000000000&mostrar=abc");
  await expect(linhas(page)).toHaveCount(4);
  await page.goto("/lancamentos?busca=nada-disso");
  await expect(page.getByText("Nenhum lançamento com esses filtros.")).toBeVisible();
});

test("/lancamentos: resumo só aparece quando bate com a lista (mês sem outros filtros)", async ({ page }) => {
  const email = await signup(page);
  const { uid, aid } = await userAndWallet(email);
  const outra = await sql(
    "INSERT INTO accounts (user_id, name, type, initial_balance_cents) VALUES ($1, 'Banco', 'checking', 0) RETURNING id",
    [uid],
  );
  await bulk(uid, aid, 1, "Na carteira", "2026-10-05"); // R$ 1,00
  await bulk(uid, outra[0].id, 3, "No banco", "2026-10-05"); // R$ 3,00
  await page.goto(`/lancamentos?mes=2026-10&conta=${aid}`);
  await expect(linhas(page)).toHaveCount(1);
  await expect(page.locator(".summary")).toHaveCount(0);
  await page.goto("/lancamentos?mes=2026-10");
  await expect(linhas(page)).toHaveCount(4);
  const saidas = page.locator(".summary").getByText("Saídas").locator("..").locator(".money");
  await expect(saidas).toHaveAttribute("data-cents", "-400");
});

test("/lancamentos: 'Mostrar mais' traz o resto sem repetir nem perder (mesma data)", async ({ page }) => {
  const email = await signup(page);
  const { uid, aid } = await userAndWallet(email);
  await bulk(uid, aid, 57, "Item", "2026-10-10");
  await page.goto("/lancamentos?mes=2026-10");
  await expect(linhas(page)).toHaveCount(50);
  await expect(page.getByText("50 de 57 lançamentos")).toBeVisible();
  await page.getByRole("link", { name: "Mostrar mais" }).click();
  await expect(page).toHaveURL(/mostrar=100/);
  await expect(page).toHaveURL(/mes=2026-10/);
  await expect(linhas(page)).toHaveCount(57);
  await expect(page.getByRole("link", { name: "Mostrar mais" })).toHaveCount(0);
  const titles = await page.locator("[data-testid=lancamento] .row-title").allInnerTexts();
  expect(new Set(titles).size).toBe(57);
});

test("isolamento pela tela: ação com id de lançamento de outra pessoa não altera nada", async ({ page, browser }) => {
  const emailA = await signup(page);
  await lancar(page, { descricao: "Segredo A", valor: "40,00", pago: false });
  const [{ id }] = await sql("SELECT t.id FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.email = $1", [emailA]);

  const ctxB = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const pageB = await ctxB.newPage();
  await signup(pageB);
  await lancar(pageB, { descricao: "Meu B", valor: "1,00", pago: false });
  // Troca o id do lançamento de B pelo de A antes de clicar em "pagar" e em salvar edição.
  await pageB.route("**/lancamentos**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postData() ?? "";
      const ids = await sql("SELECT t.id FROM transactions t WHERE t.description = 'Meu B'");
      await route.continue({ postData: body.split(ids[0].id).join(id) });
    } else await route.continue();
  });
  await pageB.getByTitle("Marcar como pago").click();
  await expect(pageB.locator(".row-error")).toContainText("Lançamento não encontrado.");
  await pageB.getByRole("button", { name: "Editar Meu B" }).click();
  await dialog(pageB).getByRole("button", { name: "Excluir lançamento" }).click();
  await dialog(pageB).getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(dialog(pageB).getByRole("alert")).toContainText("Lançamento não encontrado.");
  await ctxB.close();
  const [a] = await sql("SELECT paid, amount_cents::int AS v FROM transactions WHERE id = $1", [id]);
  expect(a).toEqual({ paid: false, v: 4000 });
});
