// Aplica as migrações de db/migrations em ordem, uma vez cada, registrando em schema_migrations.
// Usado pelo script de deploy (scripts/migrate.mjs) e pelos testes.
import { readdir, readFile } from "node:fs/promises";

const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);
// Trava para duas execuções simultâneas não aplicarem a mesma migração.
const LOCK_ID = 4815162342;

/** @param {import("pg").ClientBase} client */
export async function runMigrations(client, log = () => {}) {
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
  try {
    await assertNoForeignTables(client);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (done.has(version)) continue;
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        log(`aplicada ${version}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migração ${version}: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
  }
}

/**
 * O banco de produção é compartilhado com o app antigo. Se existir uma tabela "users"
 * de outro sistema, paramos antes de misturar dados.
 */
async function assertNoForeignTables(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = current_schema() AND t.table_name = 'users'
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                         WHERE c.table_schema = t.table_schema AND c.table_name = 'users'
                           AND c.column_name = 'password_hash')`,
  );
  if (rows.length) throw new Error('Já existe uma tabela "users" de outro sistema neste banco.');
}
