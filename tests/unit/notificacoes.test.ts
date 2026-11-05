import { describe, expect, it } from "vitest";
import { parseBankNotification as p } from "@/domain/bank-notification";

describe("leitor de notificações de banco", () => {
  it("compra no cartão com final, valor e estabelecimento", () => {
    expect(p({ packageName: "com.nu.production", title: "Compra aprovada", text: "Compra aprovada no cartão final 4589 no valor de R$ 89,90 em SUPERMERCADO BOM PRECO." })).toMatchObject({
      kind: "purchase", amount: 8990, last4: "4589", counterpart: "SUPERMERCADO BOM PRECO", institution: "Nubank", debit: false,
    });
    const parcelada = p({ packageName: "com.itau", text: "Compra de R$ 2.400,00 em 10x aprovada no cartão final 1234 em MAGAZINE LOJA" });
    expect(parcelada).toMatchObject({ kind: "purchase", amount: 240000, installments: 10, last4: "1234" });
    expect(p({ packageName: "br.com.intermedium", text: "Compra no débito de R$ 15,00 em PADARIA SOL" })).toMatchObject({ kind: "purchase", debit: true, amount: 1500 });
  });

  it("Pix enviado e recebido, sem inventar que é salário", () => {
    expect(p({ packageName: "com.nu.production", text: "Você enviou um Pix de R$ 150,00 para João Silva." })).toMatchObject({ kind: "pix_out", amount: 15000, counterpart: "João Silva" });
    const recebido = p({ packageName: "com.nu.production", title: "Pix recebido", text: "Você recebeu um Pix de R$ 2.500,00 de MARIA SOUZA" });
    expect(recebido).toMatchObject({ kind: "pix_in", amount: 250000, counterpart: "MARIA SOUZA" });
    expect(p({ packageName: "com.picpay", text: "Você recebeu um Pix de R$ 2.500,00." })).toMatchObject({ kind: "pix_in", counterpart: null });
  });

  it("recusada, aviso de segurança e propaganda não viram movimentação", () => {
    expect(p({ packageName: "com.c6bank.app", text: "Compra de R$ 300,00 recusada no cartão final 7777" }).kind).toBe("declined");
    expect(p({ packageName: "com.nu.production", text: "Novo acesso à sua conta em outro aparelho." }).kind).toBe("ignore");
    const promo = p({ packageName: "com.nu.production", text: "Aproveite! Empréstimo pré-aprovado de R$ 5.000,00 para você" });
    expect(promo.confidence).toBeLessThan(0.5);
  });

  it("estorno e pagamento de fatura", () => {
    expect(p({ packageName: "com.nu.production", text: "Estorno de R$ 49,90 da compra em LOJA X" })).toMatchObject({ kind: "refund", amount: 4990 });
    expect(p({ packageName: "com.itau", text: "Pagamento de fatura de R$ 1.234,56 realizado" })).toMatchObject({ kind: "payment", amount: 123456 });
  });

  it("app de qualquer banco: lê do mesmo jeito e usa o nome do app como banco", () => {
    expect(p({ packageName: "br.com.bancoxyz.mobile", appName: "Banco XYZ", text: "Compra aprovada de R$ 25,00 em PADARIA" })).toMatchObject({
      kind: "purchase", amount: 2500, institution: "Banco XYZ", counterpart: "PADARIA",
    });
    expect(p({ packageName: "br.com.bancoxyz.mobile", text: "Pix recebido de R$ 10,00 de Ana" }).institution).toBeNull();
    expect(p({ packageName: "com.nu.production", appName: "Nu", text: "Pix recebido de R$ 10,00 de Ana" }).institution).toBe("Nubank");
  });
});
