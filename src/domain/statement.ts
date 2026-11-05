/**
 * Leitura de extratos bancários (OFX e CSV), sem banco de dados. Só extrai o que está no arquivo:
 * data, descrição, valor e o identificador do banco (FITID) quando existe. Nada é inventado.
 */
import { isValidDate } from "@/lib/dates";
import { parseMoney } from "@/lib/money";

export type StatementLine = {
  /** Identificador estável da linha: FITID do OFX ou um resumo da linha (para não importar duas vezes). */
  ref: string;
  date: string;
  description: string;
  /** Centavos, positivo. */
  amount: number;
  /** Entrada (crédito na conta) ou saída (débito). */
  type: "income" | "expense";
};

export type ParsedStatement = { format: "ofx" | "csv"; lines: StatementLine[]; skipped: number; errors: string[] };

export const MAX_STATEMENT_BYTES = 1_000_000;
export const MAX_STATEMENT_LINES = 2_000;

/** Hash curto e estável (FNV-1a 32 bits, em hexadecimal). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

/** Valor do extrato: "-12.30", "1.234,56", "R$ -50,00", "(50,00)". */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) (negative = true), (s = s.slice(1, -1));
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) (negative = !negative), (s = s.slice(1));
  if (s.endsWith("-")) (negative = !negative), (s = s.slice(0, -1));
  // "1,234.56" (padrão americano): troca para o brasileiro.
  if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, "").replace(".", ",");
  // "1234.5": um decimal só com ponto.
  if (/^\d+\.\d$/.test(s)) s = s.replace(".", ",");
  const cents = parseMoney(s);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

/** "05/11/2026", "05/11/26", "2026-11-05", "20261105..." -> "2026-11-05". */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  // OFX: 20261103 ou 20261103120000[-3:BRT]
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d|\[|\.|$)/);
  if (m) return valid(`${m[1]}-${m[2]}-${m[3]}`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(`${m[1]}-${m[2]}-${m[3]}`);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return valid(`${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  return null;
}
const valid = (d: string) => (isValidDate(d) ? d : null);

function lineOf(date: string, description: string, signed: number, ref: string | null, seen: Map<string, number>): StatementLine {
  const base = ref ?? `h${hash(`${date}|${signed}|${description.toLowerCase()}`)}`;
  // Duas linhas iguais no mesmo dia (dois cafés de R$ 5): a segunda ganha um sufixo.
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return {
    ref: n > 1 ? `${base}#${n}` : base,
    date,
    description: description || (signed > 0 ? "Entrada" : "Saída"),
    amount: Math.abs(signed),
    type: signed > 0 ? "income" : "expense",
  };
}

/** OFX 1.x (SGML, sem tags de fechamento) e 2.x (XML). */
export function parseOfx(text: string): ParsedStatement {
  const lines: StatementLine[] = [];
  const errors: string[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const tag = (name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
    const date = parseStatementDate(tag("DTPOSTED"));
    const amount = parseStatementAmount(tag("TRNAMT"));
    if (!date || amount === null) {
      errors.push(`Linha sem data ou valor válido: ${clean(tag("MEMO") || tag("NAME")) || "(sem descrição)"}`);
      continue;
    }
    if (amount === 0) {
      skipped++;
      continue;
    }
    const memo = clean(tag("MEMO"));
    const name = clean(tag("NAME"));
    const description = clean(name && memo && !memo.includes(name) ? `${name} ${memo}` : memo || name);
    const fitid = tag("FITID");
    lines.push(lineOf(date, description, amount, fitid ? `ofx:${fitid}` : null, seen));
  }
  return { format: "ofx", lines, skipped, errors };
}

/** Separa uma linha de CSV respeitando aspas. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * CSV com cabeçalho. Reconhece colunas de data, descrição e valor (ou débito e crédito separados),
 * com nomes comuns dos bancos ("Data", "Descrição", "Histórico", "Valor", "title", "amount"...).
 * `cardStatement`: na fatura de cartão os gastos vêm positivos; aí positivo é saída.
 */
export function parseCsv(text: string, cardStatement = false): ParsedStatement {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (rows.length < 2) return { format: "csv", lines: [], skipped: 0, errors: ["O arquivo não tem linhas de lançamento."] };
  const first = rows[0];
  const sep = [";", ",", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const header = splitCsvLine(first, sep).map(norm);
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iDate = find("data", "date", "dt");
  const iDesc = find("descricao", "historico", "lancamento", "description", "title", "estabelecimento", "memo", "detalhe");
  const iAmount = find("valor", "amount", "value", "quantia");
  const iDebit = find("debito", "saida", "debit");
  const iCredit = find("credito", "entrada", "credit");
  const iId = find("identificador", "id", "fitid");
  if (iDate < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) {
    return { format: "csv", lines: [], skipped: 0, errors: ["Não encontrei as colunas de data e valor. A primeira linha precisa ter os nomes das colunas (ex.: Data;Descrição;Valor)."] };
  }
  const lines: StatementLine[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const cols = splitCsvLine(row, sep);
    const date = parseStatementDate(cols[iDate] ?? "");
    let signed: number | null = null;
    if (iAmount >= 0) {
      signed = parseStatementAmount(cols[iAmount] ?? "");
      if (signed !== null && cardStatement) signed = -signed;
    } else {
      const debit = cols[iDebit]?.trim() ? parseStatementAmount(cols[iDebit]) : 0;
      const credit = cols[iCredit]?.trim() ? parseStatementAmount(cols[iCredit]) : 0;
      if (debit !== null && credit !== null) signed = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    const description = clean(iDesc >= 0 ? cols[iDesc] ?? "" : "");
    if (!date || signed === null) {
      // Linhas de saldo e totais costumam vir sem data: só ignora.
      if (/saldo|total/i.test(row)) skipped++;
      else errors.push(`Linha ignorada (data ou valor inválido): ${clean(row).slice(0, 60)}`);
      continue;
    }
    if (signed === 0 || /^saldo/i.test(description)) {
      skipped++;
      continue;
    }
    const id = iId >= 0 ? cols[iId]?.trim() : "";
    lines.push(lineOf(date, description, signed, id ? `csv:${id}` : null, seen));
  }
  return { format: "csv", lines, skipped, errors: errors.slice(0, 20) };
}

/** Detecta o formato pelo conteúdo. */
export function parseStatement(text: string, cardStatement = false): ParsedStatement {
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text.slice(0, 5000)) || /<STMTTRN>/i.test(text)) return parseOfx(text);
  return parseCsv(text, cardStatement);
}
