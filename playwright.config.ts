import { defineConfig } from "@playwright/test";
import { E2E_DATABASE_URL as DATABASE_URL } from "./e2e/db-url";

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
    env: {
      DATABASE_URL,
      AUTH_SECRET: "segredo-de-teste-e2e-com-mais-de-32-caracteres",
      SIGNUP_LIMIT_PER_IP: "1000",
    },
  },
});
