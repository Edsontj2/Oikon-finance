import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/** Zera o banco de teste antes do teste no navegador. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://oikon:oikon@localhost:5432/oikon_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP TABLE IF EXISTS transactions, categories, accounts, users CASCADE");
    await client.query(await readFile(path.resolve(__dirname, "../db/schema.sql"), "utf8"));
  } finally {
    await client.end();
  }
}
