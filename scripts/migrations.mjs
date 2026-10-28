// Aplica as migrações de db/migrations em ordem, uma vez cada, registrando em schema_migrations.
// Usado pelo script de deploy (scripts/migrate.mjs) e pelos testes.
import { readdir, readFile } from "node:fs/promises";

const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);
// Trava para duas execuções simultâneas não aplicarem a mesma migração. É uma trava de
// transação (some no COMMIT/ROLLBACK), então funciona também pela conexão com pooler do Neon.
const LOCK_ID = 4815162342;

/** @param {import("pg").ClientBase} client */
export async function runMigrations(client, log = () => {}) {
  await inLockedTransaction(client, async () => {
    await assertNoForeignTables(client);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
    try {
      const applied = await inLockedTransaction(client, async () => {
        // Conferido já com a trava: outra execução pode ter aplicado enquanto esperávamos.
        const { rows } = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
        if (rows.length) return false;
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        return true;
      });
      if (applied) log(`aplicada ${version}`);
    } catch (err) {
      throw new Error(`Falha na migração ${version}: ${err.message}`);
    }
  }
}

/** Roda `fn` numa transação com a trava; não espera para sempre por tabelas ocupadas. */
async function inLockedTransaction(client, fn) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
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
