import { expect, test } from "@playwright/test";
import { dialog, expectToast, signup } from "./helpers";

test("app Android: vincular com código, receber notificação, confirmar no site e não duplicar", async ({ page }) => {
  await signup(page);
  await page.goto("/notificacoes");
  await page.getByText("Vincular com código").click();
  await page.getByRole("button", { name: "Gerar código de vínculo" }).click();
  const code = (await page.getByTestId("codigo-celular").locator("strong").textContent())!.replace(/\D/g, "");
  expect(code).toHaveLength(8);

  const link = await page.request.post("/api/app/vincular", { data: { code, deviceName: "Teste" } });
  expect(link.status()).toBe(200);
  const { token } = await link.json();
  expect((await page.request.post("/api/app/vincular", { data: { code, deviceName: "Outro" } })).status()).toBe(400);
  expect((await page.request.get("/api/app/status", { headers: { Authorization: "Bearer errado-errado-errado-errado" } })).status()).toBe(401);

  const batch = { notifications: [{ id: "n_teste_1", package: "com.nu.production", appName: "Nubank", title: "Pix enviado", text: "Você enviou um Pix de R$ 42,00 para Padaria Sol.", postedAt: new Date().toISOString() }] };
  const up = await page.request.post("/api/app/notificacoes", { data: batch, headers: { Authorization: `Bearer ${token}` } });
  expect(await up.json()).toEqual({ accepted: 1, toConfirm: 1, duplicates: 0, invalid: 0 });
  const again = await page.request.post("/api/app/notificacoes", { data: batch, headers: { Authorization: `Bearer ${token}` } });
  expect(await again.json()).toEqual({ accepted: 0, toConfirm: 0, duplicates: 1, invalid: 0 });

  await page.goto("/");
  await expect(page.getByTestId("aviso-notificacoes")).toContainText("1 notificação do banco");
  await page.getByTestId("aviso-notificacoes").click();
  const card = page.getByTestId("notificacao");
  await expect(card).toContainText("Pix enviado · R$");
  await expect(card.getByLabel("Descrição")).toHaveValue("Pix para Padaria Sol");
  await card.getByLabel("Conta ou cartão").selectOption({ label: "Carteira" });
  await card.getByRole("button", { name: "Confirmar e lançar" }).click();
  await expectToast(page, "Lançamento criado.");
  await expect(page.getByTestId("notificacao")).toHaveCount(0);
  await page.goto("/lancamentos");
  await expect(page.getByTestId("lancamento").filter({ hasText: "Pix para Padaria Sol" })).toHaveCount(1);

  await page.goto("/notificacoes");
  await page.getByRole("button", { name: "Desvincular" }).click();
  await expectToast(page, "Celular desvinculado.");
  expect((await page.request.get("/api/app/status", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
  void dialog;
});

test("dentro do app: ativar neste celular sem digitar código, permissões e PDF pelo Android", async ({ page }) => {
  await signup(page);
  // Simula a ponte do app Android (window.OikonApp) e guarda as chamadas.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const state = { linked: false, listener: false, apps: [{ pkg: "com.nu.production", label: "Nubank", allowed: true }, { pkg: "com.itau", label: "Itaú", allowed: false }] };
    const calls: unknown[][] = [];
    w.__calls = calls;
    w.__state = state;
    w.OikonApp = {
      info: () => JSON.stringify({ ...state, deviceName: "Pixel", paused: false, pending: 0, lastSync: 0, lastError: null }),
      link: (code: string) => calls.push(["link", code]),
      unlink: () => calls.push(["unlink"]),
      setApp: (pkg: string, on: boolean) => { calls.push(["setApp", pkg, on]); state.apps = state.apps.map((a) => (a.pkg === pkg ? { ...a, allowed: on } : a)); },
      setPaused: () => {},
      openNotificationAccess: () => calls.push(["access"]),
      openSetup: () => calls.push(["setup"]),
      syncNow: () => calls.push(["sync"]),
      print: () => calls.push(["print"]),
    };
  });
  await page.goto("/notificacoes");
  await expect(page.getByRole("heading", { name: "Este celular" })).toBeVisible();
  await expect(page.getByText("Baixe o app (APK)")).toHaveCount(0);
  await page.getByRole("button", { name: "Ativar neste celular" }).click();

  // O app recebe um código novo de 8 dígitos e vincula com ele, como faria o celular.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls.length)).toBe(1);
  const [kind, code] = await page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls[0]);
  expect(kind).toBe("link");
  expect(String(code)).toMatch(/^\d{8}$/);
  expect((await page.request.post("/api/app/vincular", { data: { code, deviceName: "Pixel" } })).status()).toBe(200);
  await page.evaluate(() => {
    (window as unknown as { __state: { linked: boolean } }).__state.linked = true;
    window.dispatchEvent(new CustomEvent("oikon-app", { detail: { linked: true } }));
  });
  await expect(page.getByText("Pronto! Este celular já está lendo")).toBeVisible();
  await expect(page.getByRole("list", { name: "Celulares vinculados" })).toContainText("Pixel");

  await page.getByRole("button", { name: "Permitir acesso às notificações" }).click();
  await page.getByRole("checkbox", { name: "Itaú" }).check();
  await expect(page.getByRole("checkbox", { name: "Itaú" })).toBeChecked();
  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls);
  expect(calls).toContainEqual(["access"]);
  expect(calls).toContainEqual(["setApp", "com.itau", true]);

  // Voltou das configurações do Android com a permissão dada.
  await page.evaluate(() => {
    (window as unknown as { __state: { listener: boolean } }).__state.listener = true;
    window.dispatchEvent(new Event("oikon-app"));
  });
  await expect(page.getByText("Acesso às notificações permitido.")).toBeVisible();

  await page.goto("/relatorio");
  await page.getByRole("button", { name: "Salvar em PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls)).toContainEqual(["print"]);
});
