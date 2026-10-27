import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_DATABASE_URL } from "./db-url";

export const PASSWORD = "senha-segura-123";

/** Cria uma pessoa nova (cada teste usa a sua, para os testes não dependerem um do outro). */
export async function signup(page: Page, name = "Pessoa"): Promise<string> {
  const email = `e2e-${randomUUID()}@teste.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.locator("[name=senha]").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  return email;
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
