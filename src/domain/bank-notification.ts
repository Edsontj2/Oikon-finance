/**
 * Leitor de notificações de bancos em português (regras fixas, sem IA). Só extrai o que está
 * escrito: valor, tipo, final do cartão, estabelecimento ou pessoa, parcelas. Nada é inventado;
 * se faltar algo, a confiança cai e a pessoa completa ao confirmar.
 */
import { parseStatementAmount } from "./statement";

export type NotificationKind =
  | "purchase" // compra no cartão ou no débito
  | "pix_out"
  | "pix_in"
  | "transfer_out"
  | "transfer_in"
  | "payment" // boleto, conta, fatura
  | "refund"
  | "declined" // recusada: não é movimentação
  | "ignore"; // aviso, propaganda, segurança

export type ParsedNotification = {
  kind: NotificationKind;
  /** Centavos, positivo. */
  amount: number | null;
  /** Estabelecimento (compra) ou pessoa (Pix). */
  counterpart: string | null;
  last4: string | null;
  installments: number | null;
  debit: boolean;
  institution: string | null;
  /** 0 a 1: o quanto o texto deixa claro o que aconteceu. */
  confidence: number;
};

/** Pacotes dos apps de banco mais comuns no Brasil (para dizer de onde veio). */
export const BANK_APPS: Record<string, string> = {
  "com.nu.production": "Nubank",
  "br.com.intermedium": "Inter",
  "com.c6bank.app": "C6 Bank",
  "com.itau": "Itaú",
  "com.itau.iti": "iti",
  "br.com.bb.android": "Banco do Brasil",
  "com.bradesco": "Bradesco",
  "br.com.bradesco.next": "next",
  "com.santander.app": "Santander",
  "br.com.gabba.Caixa": "Caixa",
  "br.gov.caixa.tem": "Caixa Tem",
  "com.picpay": "PicPay",
  "com.mercadopago.wallet": "Mercado Pago",
  "br.com.original.bank": "Original",
  "com.btg.pactual.banking": "BTG",
  "br.com.uol.ps.myaccount": "PagBank",
  "com.neon": "Neon",
  "br.com.sicoob.app": "Sicoob",
  "br.com.sicredi.app": "Sicredi",
  "com.google.android.apps.messaging": "SMS",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function cleanName(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/\s+/g, " ")
    .replace(/\s*(no valor|valor|de r\$|r\$|em \d+x|as \d{1,2}[:h]\d{2}|às \d{1,2}[:h]\d{2}|hoje|ontem|via pix).*$/i, "")
    .replace(/[.,;:!]+$/, "")
    .trim();
  return s.length >= 2 ? s.slice(0, 60) : null;
}

export function parseBankNotification(input: { packageName: string; title?: string | null; text: string }): ParsedNotification {
  const raw = `${input.title ?? ""}\n${input.text}`.trim();
  const n = norm(raw);
  const institution = BANK_APPS[input.packageName] ?? null;
  const amountMatch = raw.match(/R\$\s*-?\s*([\d.]+,\d{2}|\d+(?:\.\d{2})?)/i);
  const amount = amountMatch ? Math.abs(parseStatementAmount(amountMatch[1]) ?? 0) || null : null;
  const last4 = n.match(/(?:final|terminad[oa] em|cartao(?: de credito| de debito)?(?: virtual)?(?: com final)?)\s*(?:n[oº.]*\s*)?\*{0,4}\s*(\d{4})\b/)?.[1] ?? null;
  const installments = Number(n.match(/\b(?:em\s*)?(\d{1,2})\s*x\b/)?.[1] ?? n.match(/(\d{1,2}) parcelas/)?.[1] ?? 0) || null;
  const debit = /\bdebito\b/.test(n);
  const base = { amount, last4, installments: installments && installments > 1 ? installments : null, debit, institution };

  if (/(recusad|negad|nao aprovad|nao autorizad|nao foi aprovad|bloquead)/.test(n)) return { ...base, kind: "declined", counterpart: null, confidence: 0.9 };
  if (!amount) return { ...base, kind: "ignore", counterpart: null, confidence: 0.9 };

  let kind: NotificationKind | null = null;
  let counterpart: string | null = null;
  // Primeiro trecho depois da palavra que não seja o próprio valor ("de R$ 10,00 de MARIA" -> MARIA).
  const after = (re: RegExp) => {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of raw.matchAll(global)) {
      if (/^R\$/i.test(m[1])) continue;
      const name = cleanName(m[1]);
      if (name) return name;
    }
    return null;
  };

  if (/(estorno|estornad|reembols|devolucao|cancelamento da compra)/.test(n)) {
    kind = "refund";
    counterpart = after(/(?:de|em|da compra em)\s+([A-Z0-9][^\n.]{1,60})/);
  } else if (/(recebeu|recebido|recebida|caiu na sua conta|credito em conta|deposito)/.test(n) && /pix/.test(n)) {
    kind = "pix_in";
    counterpart = after(/\bde\s+([A-ZÀ-Ú][^\n.]{1,60})/);
  } else if (/pix/.test(n) && /(enviou|enviado|enviada|fez um|realizou|realizado|realizada|pagamento|pagou|transferiu)/.test(n)) {
    kind = "pix_out";
    counterpart = after(/\bpara\s+([A-ZÀ-Ú0-9][^\n.]{1,60})/);
  } else if (/(transferencia|ted|doc)\b/.test(n) && /(recebeu|recebida|recebido)/.test(n)) {
    kind = "transfer_in";
    counterpart = after(/\bde\s+([A-ZÀ-Ú][^\n.]{1,60})/);
  } else if (/(transferencia|ted|doc)\b/.test(n) && /(enviou|enviada|realizada|realizou|efetuada)/.test(n)) {
    kind = "transfer_out";
    counterpart = after(/\bpara\s+([A-ZÀ-Ú0-9][^\n.]{1,60})/);
  } else if (/(pagamento (da |de )?fatura|fatura (foi )?paga|boleto (foi )?pago|pagamento de boleto|conta paga|pagamento realizado|pagamento efetuado)/.test(n)) {
    kind = "payment";
    counterpart = after(/(?:pagamento d[eao]|boleto d[eao]|para)\s+([A-ZÀ-Ú0-9][^\n.]{1,60})/);
  } else if (/(compra|comprou|transacao aprovada|aprovad[ao] (no|em)|gasto|debito de|pagamento aprovado)/.test(n)) {
    kind = "purchase";
    counterpart = after(/\b(?:em|no estabelecimento|na loja|no|na)\s+([A-Z0-9][A-Z0-9*&'\-. ]{1,60})/) ?? after(/\b(?:em|no estabelecimento)\s+([^\n]{2,60})/i);
  }
  if (!kind) return { ...base, kind: "ignore", counterpart: null, confidence: 0.4 };
  let confidence = 0.6 + (counterpart ? 0.15 : 0) + (last4 || kind !== "purchase" ? 0.1 : 0);
  if (/(promoc|oferta|ganhe|cashback de ate|aproveite|limite pre-aprovado|emprestimo pre)/.test(n)) confidence -= 0.4;
  return { ...base, kind, counterpart, confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)) };
}

/** Saída (gasto/envio) ou entrada, para virar lançamento. */
export function notificationDirection(kind: NotificationKind): "income" | "expense" | null {
  if (kind === "pix_in" || kind === "transfer_in" || kind === "refund") return "income";
  if (kind === "purchase" || kind === "pix_out" || kind === "transfer_out" || kind === "payment") return "expense";
  return null;
}

export const notificationKindLabel: Record<NotificationKind, string> = {
  purchase: "Compra",
  pix_out: "Pix enviado",
  pix_in: "Pix recebido",
  transfer_out: "Transferência enviada",
  transfer_in: "Transferência recebida",
  payment: "Pagamento",
  refund: "Estorno",
  declined: "Recusada",
  ignore: "Aviso",
};
