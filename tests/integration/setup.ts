import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createUser } from "@/data/users";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://oikon:oikon@localhost:5432/oikon_test";

/** Banco de teste zerado com o schema atual. Nunca aponte para o banco de produção. */
export async function freshDb(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
  await pool.query("DROP TABLE IF EXISTS transactions, categories, accounts, users CASCADE");
  await pool.query(schema);
  return pool;
}

export async function newUser(db: pg.Pool, name = "Teste"): Promise<string> {
  return createUser(db, { name, email: `${randomUUID()}@teste.com`, password: "senha-segura-123" });
}
