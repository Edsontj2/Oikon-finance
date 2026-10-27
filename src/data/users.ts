import bcrypt from "bcryptjs";
import type { Db } from "@/lib/db";
import { UserError, pgCode } from "./errors";
import { LIMITS, requiredText } from "@/domain/limits";

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

export type NewUser = { name: string; email: string; password: string };

/** Valida o cadastro e devolve os dados limpos. */
export function validateNewUser(input: NewUser): NewUser {
  const name = requiredText(input.name, LIMITS.userName, "Informe seu nome.", "O nome");
  const email = normalizeEmail(input.email ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > LIMITS.email) {
    throw new UserError("E-mail inválido.");
  }
  const password = input.password ?? "";
  if (password.length < LIMITS.passwordMin || !/\S/.test(password)) {
    throw new UserError(`A senha precisa ter pelo menos ${LIMITS.passwordMin} caracteres.`);
  }
  if (Buffer.byteLength(password, "utf8") > LIMITS.passwordMaxBytes) {
    throw new UserError(`A senha pode ter no máximo ${LIMITS.passwordMaxBytes} caracteres.`);
  }
  return { name, email, password };
}

/**
 * Cria o usuário com uma conta "Carteira" e categorias básicas, tudo num único comando:
 * ou cria tudo, ou não cria nada. Devolve o id.
 */
export async function createUser(db: Db, input: NewUser): Promise<string> {
  const user = validateNewUser(input);
  const hash = await bcrypt.hash(user.password, 10);
  try {
    const { rows } = await db.query<{ id: string }>(
      `WITH new_user AS (
         INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id
       ), wallet AS (
         INSERT INTO accounts (user_id, name, type) SELECT id, 'Carteira', 'cash' FROM new_user
       ), default_categories AS (
         INSERT INTO categories (user_id, name, kind)
         SELECT new_user.id, c.name, c.kind
           FROM new_user, unnest($4::text[], $5::text[]) AS c(name, kind)
       )
       SELECT id FROM new_user`,
      [user.name, user.email, hash, defaultCategories.map((c) => c[0]), defaultCategories.map((c) => c[1])],
    );
    return rows[0].id;
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Já existe uma conta com esse e-mail.");
    throw err;
  }
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
