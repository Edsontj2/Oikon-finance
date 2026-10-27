import { randomUUID } from "node:crypto";
import pg from "pg";
import { createUser } from "@/data/users";
import { runMigrations } from "../../scripts/migrations.mjs";

/** Banco só dos testes de integração (o e2e usa outro, para as duas suítes não se apagarem). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://oikon:oikon@localhost:5432/oikon_test";

/** Banco de teste zerado com todas as migrações. Nunca aponte para o banco de produção. */
export async function freshDb(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client);
  } finally {
    client.release();
  }
  return pool;
}

export function uniqueEmail(prefix = "teste"): string {
  return `${prefix}-${randomUUID()}@teste.com`;
}

export async function newUser(db: pg.Pool, name = "Teste"): Promise<string> {
  return createUser(db, { name, email: uniqueEmail(), password: "senha-segura-123" });
}
