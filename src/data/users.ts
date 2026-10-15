import bcrypt from "bcryptjs";
import type { Db } from "@/lib/db";
import { UserError, pgCode } from "./errors";

const defaultCategories: Array<[string, "income" | "expense"]> = [
  ["Salário", "income"],
  ["Outras entradas", "income"],
  ["Moradia", "expense"],
  ["Mercado", "expense"],
  ["Transporte", "expense"],
  ["Saúde", "expense"],
  ["Lazer", "expense"],
  ["Contas da casa", "expense"],
  ["Outras saídas", "expense"],
];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Cria o usuário com uma conta "Carteira" e categorias básicas. Devolve o id. */
export async function createUser(
  db: Db,
  input: { name: string; email: string; password: string },
): Promise<string> {
  const hash = await bcrypt.hash(input.password, 10);
  let userId: string;
  try {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [input.name.trim(), normalizeEmail(input.email), hash],
    );
    userId = rows[0].id;
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Já existe uma conta com esse e-mail.");
    throw err;
  }
  await db.query(
    "INSERT INTO accounts (user_id, name, type) VALUES ($1, 'Carteira', 'cash')",
    [userId],
  );
  await db.query(
    `INSERT INTO categories (user_id, name, kind)
     SELECT $1, name, kind FROM unnest($2::text[], $3::text[]) AS c(name, kind)`,
    [userId, defaultCategories.map((c) => c[0]), defaultCategories.map((c) => c[1])],
  );
  return userId;
}

let dummyHash: string | undefined;

/** Devolve o id do usuário se e-mail e senha conferirem. */
export async function authenticate(db: Db, email: string, password: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = $1",
    [normalizeEmail(email)],
  );
  if (!rows[0]) {
    // Compara mesmo assim para o tempo de resposta não revelar se o e-mail existe.
    dummyHash ??= await bcrypt.hash("oikon-dummy", 10);
    await bcrypt.compare(password, dummyHash);
    return null;
  }
  return (await bcrypt.compare(password, rows[0].password_hash)) ? rows[0].id : null;
}

export async function getUserName(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [userId]);
  return rows[0]?.name ?? null;
}
