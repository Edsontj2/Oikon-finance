import pg from "pg";
import { E2E_DATABASE_URL } from "./db-url";

/** Zera o banco do e2e (separado do banco dos testes de integração) e aplica as migrações. */
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    // .mjs precisa de import dinâmico aqui (o Playwright carrega este arquivo como CommonJS).
    const { runMigrations } = await import("../scripts/migrations.mjs");
    await runMigrations(client);
  } finally {
    await client.end();
  }
}
