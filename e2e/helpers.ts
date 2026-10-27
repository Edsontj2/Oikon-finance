import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_DATABASE_URL } from "./db-url";

export const PASSWORD = "senha-segura-123";
export const R = (reais: number) => String(Math.round(reais * 100));

/** Cria uma pessoa nova (cada teste usa a sua, para os testes não dependerem um do outro). */
export async function signup(page: Page, name = "Pessoa", email = `e2e-${randomUUID()}@teste.com`): Promise<string> {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  return email;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** A janela aberta no momento. */
export function dialog(page: Page) {
  return page.locator("dialog[open]");
}

/** Espera a mensagem de confirmação (toast) aparecer. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator(".toast").filter({ hasText: text }).last()).toBeVisible();
}

export type Lancamento = {
  tipo?: "Saída" | "Entrada" | "Transferência";
  descricao: string;
  valor: string;
  conta?: string;
  destino?: string;
  categoria?: string;
  data?: string;
  pago?: boolean;
  repetir?: number;
};

/** Preenche o formulário de lançamento da janela aberta (não envia). */
export async function preencherLancamento(page: Page, l: Lancamento) {
  const d = dialog(page);
  if (l.tipo) await d.getByRole("radio", { name: l.tipo }).click();
  await d.getByLabel("Descrição").fill(l.descricao);
  await d.getByLabel("Valor (R$)").fill(l.valor);
  if (l.data) await d.getByLabel("Data").fill(l.data);
  if (l.conta) await d.locator("[name=accountId]").selectOption({ label: l.conta });
  if (l.destino) await d.locator("[name=toAccountId]").selectOption({ label: l.destino });
  if (l.categoria) await d.locator("[name=categoryId]").selectOption({ label: l.categoria });
  if (l.pago !== undefined) await d.locator("[name=paid]").setChecked(l.pago);
  if (l.repetir) {
    await d.getByLabel("Repetir todo mês").check();
    await d.getByLabel("Por quantos meses?").fill(String(l.repetir));
  }
}

/** Abre "Novo lançamento", preenche e salva. Com `erro`, espera a mensagem e deixa a janela aberta. */
export async function lancar(page: Page, l: Lancamento, erro?: string | RegExp) {
  if (!/\/lancamentos/.test(page.url())) await page.goto("/lancamentos");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click();
  await preencherLancamento(page, l);
  await dialog(page).getByRole("button", { name: "Salvar lançamento" }).click();
  if (erro) {
    await expect(dialog(page).getByRole("alert")).toContainText(erro);
  } else {
    await expectToast(page, "Lançamento salvo.");
    await expect(dialog(page)).toHaveCount(0);
  }
}

export async function expectSaldos(page: Page, total: number, contas: Record<string, number>) {
  await page.goto("/");
  await expect(page.getByTestId("saldo-total")).toHaveAttribute("data-cents", R(total));
  for (const [nome, valor] of Object.entries(contas)) {
    await expect(page.getByTestId(`saldo-${nome}`)).toHaveAttribute("data-cents", R(valor));
  }
}

export async function sql(query: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(query, params)).rows;
  } finally {
    await client.end();
  }
}
