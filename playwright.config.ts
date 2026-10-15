import { defineConfig } from "@playwright/test";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://oikon:oikon@localhost:5432/oikon_test";
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { DATABASE_URL, AUTH_SECRET: "segredo-de-teste-e2e-com-mais-de-32-caracteres" },
  },
});
