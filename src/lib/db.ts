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

/**
 * Postgres devolve bigint/numeric como texto; aqui viram number. Com o teto de R$ 1 bilhão por
 * valor as somas cabem com folga; se um dia não couberem, é erro e não um saldo arredondado.
 */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Valor fora do intervalo seguro: ${String(value)}`);
  return n;
}
