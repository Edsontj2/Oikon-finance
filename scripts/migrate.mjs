// Atualiza o banco de DATABASE_URL com as migrações pendentes.
// Na Vercel roda antes do build, mas só em produção (ver "vercel-build" no package.json).
import pg from "pg";
import { runMigrations } from "./migrations.mjs";

if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`Ambiente ${process.env.VERCEL_ENV}: migrações não são aplicadas fora de produção.`);
  process.exit(0);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL antes de rodar a migração.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await runMigrations(client, (msg) => console.log(msg));
  console.log("Banco atualizado.");
} finally {
  await client.end();
}
