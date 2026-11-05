import { getDb } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";
import { isValidMonth } from "@/lib/dates";
import { searchTransactions } from "@/data/transactions";
import { transactionTypes } from "@/domain/transactions";

/** Célula de CSV: aspas quando precisa e sem fórmula (texto começando com = + - @ vira texto). */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const amount = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Lançamentos em CSV (separador ;, vírgula decimal: abre direto no Excel em português). */
export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return new Response("Entre novamente.", { status: 401 });
  const mes = new URL(request.url).searchParams.get("mes");
  const month = mes && isValidMonth(mes) ? mes : undefined;
  const db = getDb();
  const rows: string[] = ["Data;Descrição;Tipo;Valor;Situação;Conta;Conta de destino;Categoria"];
  for (let offset = 0; ; offset += 500) {
    const { items } = await searchTransactions(db, userId, { month, limit: 500, offset });
    for (const t of items) {
      const signed = t.type === "income" ? t.amount : -t.amount;
      rows.push(
        [
          t.date.split("-").reverse().join("/"),
          cell(t.description),
          transactionTypes[t.type],
          amount(signed),
          t.paid ? "Pago" : "Pendente",
          cell(t.accountName),
          cell(t.toAccountName ?? ""),
          cell(t.categoryName ?? ""),
        ].join(";"),
      );
    }
    if (items.length < 500 || offset >= 50_000) break;
  }
  return new Response(`﻿${rows.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="oikon-lancamentos-${month ?? "todos"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
