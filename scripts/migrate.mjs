// Aplica db/schema.sql no banco de DATABASE_URL. Pode rodar várias vezes (IF NOT EXISTS).
// Na Vercel roda antes do build (script "vercel-build").
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL antes de rodar a migração.");
  process.exit(1);
}

// Colunas que o app usa. Se já existir uma tabela com o mesmo nome e outro formato
// (de outro sistema no mesmo banco), paramos em vez de misturar os dados.
const expected = {
  users: ["id", "name", "email", "password_hash"],
  accounts: ["id", "user_id", "name", "type", "initial_balance_cents"],
  categories: ["id", "user_id", "name", "kind", "monthly_limit_cents"],
  transactions: ["id", "user_id", "type", "description", "amount_cents", "date", "paid", "account_id", "to_account_id", "category_id", "series_id"],
};

const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [Object.keys(expected)],
  );
  for (const [table, columns] of Object.entries(expected)) {
    const found = new Set(rows.filter((r) => r.table_name === table).map((r) => r.column_name));
    const missing = columns.filter((c) => !found.has(c));
    if (missing.length) {
      throw new Error(`A tabela "${table}" já existe com outro formato (faltam: ${missing.join(", ")}).`);
    }
  }
  console.log("Banco atualizado.");
} finally {
  await client.end();
}
