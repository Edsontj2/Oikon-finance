import { Pool } from "pg";

/** Qualquer coisa que execute SQL: o Pool da aplicação ou um client de teste. */
export type Db = Pick<Pool, "query">;

let pool: Pool | undefined;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL não configurada");
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

/** Postgres devolve bigint/numeric como texto; aqui viram number (centavos cabem com folga). */
export function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}
