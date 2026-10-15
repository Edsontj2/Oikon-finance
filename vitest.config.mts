import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // Os testes de integração compartilham um banco; rodar um arquivo por vez evita interferência.
    fileParallelism: false,
    env: { AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres!!" },
  },
});
