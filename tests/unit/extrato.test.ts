import { describe, expect, it } from "vitest";
import { parseCsv, parseOfx, parseStatement, parseStatementAmount, parseStatementDate } from "@/domain/statement";

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261103120000[-3:BRT]
<TRNAMT>-89.90
<FITID>A1
<MEMO>Compra no débito SUPERMERCADO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261105
<TRNAMT>2500.00
<FITID>A2
<NAME>PIX RECEBIDO
<MEMO>Maria
</STMTTRN>
<STMTTRN>
<DTPOSTED>20261105
<TRNAMT>0.00
<FITID>A3
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("leitura de extrato", () => {
  it("OFX: data, valor com sinal, FITID e descrição; valor zero é ignorado", () => {
    const p = parseStatement(OFX);
    expect(p.format).toBe("ofx");
    expect(p.lines).toEqual([
      { ref: "ofx:A1", date: "2026-11-03", description: "Compra no débito SUPERMERCADO", amount: 8990, type: "expense" },
      { ref: "ofx:A2", date: "2026-11-05", description: "PIX RECEBIDO Maria", amount: 250000, type: "income" },
    ]);
    expect(p.skipped).toBe(1);
  });

  it("CSV com ponto e vírgula, valor brasileiro, linha de saldo e duas linhas iguais no mesmo dia", () => {
    const csv = "Data;Histórico;Valor\n03/11/2026;Café;-5,00\n03/11/2026;Café;-5,00\n04/11/2026;Salário;3.900,00\n;SALDO DO DIA;4.000,00\n";
    const p = parseCsv(csv);
    expect(p.lines.map((l) => [l.date, l.description, l.amount, l.type])).toEqual([
      ["2026-11-03", "Café", 500, "expense"],
      ["2026-11-03", "Café", 500, "expense"],
      ["2026-11-04", "Salário", 390000, "income"],
    ]);
    expect(p.lines[0].ref).not.toBe(p.lines[1].ref);
    expect(parseCsv(csv).lines.map((l) => l.ref)).toEqual(p.lines.map((l) => l.ref)); // estável: reimportar casa
    expect(p.skipped).toBe(1);
  });

  it("CSV de fatura (gastos positivos), débito/crédito separados e colunas que faltam", () => {
    const fatura = parseCsv("date,title,amount\n2026-11-01,Padaria,12.50\n2026-11-02,Pagamento recebido,-300.00\n", true);
    expect(fatura.lines.map((l) => [l.description, l.amount, l.type])).toEqual([["Padaria", 1250, "expense"], ["Pagamento recebido", 30000, "income"]]);
    const dc = parseCsv("Data,Descrição,Débito,Crédito\n05/11/26,Luz,150.00,\n06/11/26,Reembolso,,40.00\n");
    expect(dc.lines.map((l) => [l.date, l.amount, l.type])).toEqual([["2026-11-05", 15000, "expense"], ["2026-11-06", 4000, "income"]]);
    expect(parseCsv("Nome;Coisa\nx;y\n").errors[0]).toContain("colunas de data e valor");
  });

  it("valores e datas em vários formatos", () => {
    expect(parseStatementAmount("R$ -1.234,56")).toBe(-123456);
    expect(parseStatementAmount("(50,00)")).toBe(-5000);
    expect(parseStatementAmount("1,234.56")).toBe(123456);
    expect(parseStatementAmount("12.5")).toBe(1250);
    expect(parseStatementAmount("abc")).toBeNull();
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("2026-11-05T10:00:00")).toBe("2026-11-05");
    expect(parseOfx("<STMTTRN><DTPOSTED>x<TRNAMT>1</STMTTRN>").errors).toHaveLength(1);
  });
});
