import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccount, listAccounts } from "@/data/accounts";
import { updateCardSettings } from "@/data/cards";
import { createTransaction, listTransactions } from "@/data/transactions";
import { authenticateDevice, createDeviceLinkCode, redeemDeviceCode, revokeDevice, setNotificationsPaused } from "@/data/devices";
import { confirmNotification, ignoreNotification, ingestNotifications, listNotifications } from "@/data/bank-notifications";
import { freshDb, newUser } from "./setup";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.end();
});

const R = (reais: number) => Math.round(reais * 100);
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

async function setup() {
  const userId = await newUser(db);
  const nubank = (await createAccount(db, userId, { name: "Conta Nubank", type: "checking", initialBalance: R(1000), institution: "Nubank" } as never))!;
  const card = (await createAccount(db, userId, { name: "Cartão roxo", type: "credit_card", initialBalance: 0 }))!;
  await updateCardSettings(db, userId, card, { creditLimit: R(5000), closingDay: 3, dueDay: 10, payerAccountId: nubank, brand: null, last4: "4589" });
  const { code } = await createDeviceLinkCode(db, userId);
  const linked = (await redeemDeviceCode(db, code, "Galaxy"))!;
  const device = (await authenticateDevice(db, linked.token))!;
  return { userId, nubank, card, code, token: linked.token, device };
}

describe("app de notificações", () => {
  it("vínculo: código vale uma vez, token autentica, desvincular corta o acesso", async () => {
    const s = await setup();
    expect(s.device).toMatchObject({ userId: s.userId, name: "Galaxy", paused: false });
    expect(await redeemDeviceCode(db, s.code, "Outro")).toBeNull();
    expect(await redeemDeviceCode(db, "abc", "x")).toBeNull();
    expect(await authenticateDevice(db, "token-falso-com-mais-de-vinte-caracteres")).toBeNull();
    await revokeDevice(db, s.userId, s.device.deviceId);
    expect(await authenticateDevice(db, s.token)).toBeNull();
  });

  it("recebe, sugere conta pelo final do cartão e pelo banco, descarta recusada e não duplica no reenvio", async () => {
    const s = await setup();
    const batch = [
      { id: "n1", package: "com.nu.production", appName: "Nubank", title: "Compra aprovada", text: "Compra aprovada no cartão final 4589 no valor de R$ 89,90 em SUPERMERCADO.", postedAt: at(10) },
      { id: "n2", package: "com.nu.production", text: "Você enviou um Pix de R$ 150,00 para João Silva.", postedAt: at(5) },
      { id: "n3", package: "com.nu.production", text: "Compra de R$ 300,00 recusada no cartão final 4589", postedAt: at(3) },
      { id: "../x", package: "com.nu.production", text: "R$ 1,00", postedAt: at(1) },
    ];
    expect(await ingestNotifications(db, s.device, batch)).toEqual({ accepted: 3, toConfirm: 2, duplicates: 0, invalid: 1 });
    expect(await ingestNotifications(db, s.device, batch)).toEqual({ accepted: 0, toConfirm: 0, duplicates: 3, invalid: 1 });
    const pending = await listNotifications(db, s.userId);
    expect(pending.map((n) => [n.parsed.kind, n.suggestion.accountId, n.suggestion.accountSure, n.suggestion.description])).toEqual([
      ["pix_out", s.nubank, true, "Pix para João Silva"],
      ["purchase", s.card, true, "SUPERMERCADO"],
    ]);
    expect((await listNotifications(db, s.userId, "done")).map((n) => n.status)).toEqual(["discarded"]);
  });

  it("confirmar lança uma vez só; ignorar resolve; pausado recusa envio; outro usuário não mexe", async () => {
    const s = await setup();
    await ingestNotifications(db, s.device, [
      { id: "a", package: "com.nu.production", text: "Você enviou um Pix de R$ 150,00 para João Silva.", postedAt: at(5) },
      { id: "b", package: "com.nu.production", text: "Você recebeu um Pix de R$ 40,00 de Ana", postedAt: at(4) },
    ]);
    const [b, a] = await listNotifications(db, s.userId);
    const input = { type: "expense" as const, description: a.suggestion.description, amount: a.parsed.amount!, date: a.postedAt, accountId: a.suggestion.accountId! };
    const other = await setup();
    await expect(confirmNotification(db, other.userId, a.id, input)).rejects.toThrow("não encontrada");
    await confirmNotification(db, s.userId, a.id, input);
    await expect(confirmNotification(db, s.userId, a.id, input)).rejects.toThrow("já foi resolvida");
    await ignoreNotification(db, s.userId, b.id);
    expect(await listNotifications(db, s.userId)).toHaveLength(0);
    const tx = await listTransactions(db, s.userId, { month: a.postedAt.slice(0, 7) });
    expect(tx.filter((t) => t.description === "Pix para João Silva")).toHaveLength(1);
    expect((await listAccounts(db, s.userId)).find((x) => x.id === s.nubank)!.balance).toBe(R(1000 - 150));

    await setNotificationsPaused(db, s.userId, true);
    const paused = (await authenticateDevice(db, s.token))!;
    await expect(ingestNotifications(db, paused, [])).rejects.toThrow("pausada");
  });

  it("avisa quando parece já lançado à mão", async () => {
    const s = await setup();
    await createTransaction(db, s.userId, { type: "expense", description: "Mercado", amount: R(89.9), date: new Date().toISOString().slice(0, 10), paid: true, accountId: s.card });
    await ingestNotifications(db, s.device, [{ id: "z", package: "com.nu.production", text: "Compra aprovada no cartão final 4589 no valor de R$ 89,90 em SUPERMERCADO", postedAt: at(1) }]);
    const [n] = await listNotifications(db, s.userId);
    expect(n.similar?.description).toBe("Mercado");
  });
});
