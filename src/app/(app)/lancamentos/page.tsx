import { getDb } from "@/lib/db";
import { SubmitButton } from "../../submit-button";
import { randomUUID } from "node:crypto";
import { requireUserId } from "@/lib/auth";
import { currentMonth, formatDate, isValidMonth, today } from "@/lib/dates";
import { listAccounts } from "@/data/accounts";
import { listCategories } from "@/data/categories";
import { monthSummary } from "@/data/dashboard";
import { MAX_REPEAT, listTransactions, transactionTypes } from "@/data/transactions";
import { Flash, Money, MonthNav, param, type SearchParams } from "../../ui";
import { alternarPago, criarLancamento, excluirLancamento } from "../actions";
import { signedAmount } from "./amount";

export default async function LancamentosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const db = getDb();
  const mes = param(params, "mes");
  const month = mes && isValidMonth(mes) ? mes : currentMonth();
  const todayStr = today();

  const [accounts, categories, summary] = await Promise.all([
    listAccounts(db, userId),
    listCategories(db, userId, month),
    monthSummary(db, userId, month),
  ]);
  const contaParam = param(params, "conta");
  const accountFilter = accounts.some((a) => a.id === contaParam) ? contaParam : undefined;
  const transactions = await listTransactions(db, userId, { month, accountId: accountFilter });

  const back = `/lancamentos?mes=${month}${accountFilter ? `&conta=${accountFilter}` : ""}`;
  const defaultDate = todayStr.startsWith(month) ? todayStr : `${month}-01`;

  return (
    <>
      <h1>Lançamentos</h1>
      <Flash params={params} />
      <MonthNav month={month} path="/lancamentos" extra={accountFilter ? `&conta=${accountFilter}` : ""} />

      <div className="grid">
        <div className="card stat">
          <div className="label">Entradas recebidas</div>
          <div className="value"><Money cents={summary.income} /></div>
          <div className="hint">+ <Money cents={summary.pendingIncome} /> a receber</div>
        </div>
        <div className="card stat">
          <div className="label">Saídas pagas</div>
          <div className="value"><Money cents={-summary.expense} /></div>
          <div className="hint"><Money cents={summary.pendingExpense} /> a pagar</div>
        </div>
        <div className="card stat">
          <div className="label">Resultado</div>
          <div className="value"><Money cents={summary.income - summary.expense} signed /></div>
        </div>
      </div>

      <details className="card" open>
        <summary><h2 style={{ display: "inline" }}>Novo lançamento</h2></summary>
        {accounts.length === 0 ? (
          <p className="muted">Crie uma conta antes de lançar.</p>
        ) : (
          <form action={criarLancamento} className="stack" style={{ marginTop: "1rem" }}>
            <input type="hidden" name="voltar" value={back} />
            <input type="hidden" name="chave" value={randomUUID()} />
            <div className="fields">
              <label>
                Tipo
                <select name="tipo" defaultValue="expense">
                  <option value="expense">Saída (gasto)</option>
                  <option value="income">Entrada (recebimento)</option>
                  <option value="transfer">Transferência entre contas</option>
                </select>
              </label>
              <label>Descrição<input name="descricao" required maxLength={120} /></label>
              <label>Valor (R$)<input name="valor" inputMode="decimal" placeholder="0,00" required /></label>
              <label>Data<input name="data" type="date" defaultValue={defaultDate} required /></label>
            </div>
            <div className="fields">
              <label>
                Conta
                <select name="conta" required>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>
                Categoria
                <select name="categoria" defaultValue="">
                  <option value="">Sem categoria</option>
                  <optgroup label="Saídas">
                    {categories.filter((c) => c.kind === "expense").map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Entradas">
                    {categories.filter((c) => c.kind === "income").map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                </select>
                <span className="hint">Não usada em transferências.</span>
              </label>
              <label>
                Conta de destino
                <select name="destino" defaultValue="">
                  <option value="">—</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span className="hint">Só para transferências.</span>
              </label>
              <label>
                Repetir todo mês
                <input name="repetir" type="number" min={1} max={MAX_REPEAT} defaultValue={1} />
                <span className="hint">1 = só este mês. Os meses seguintes ficam pendentes.</span>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" name="pago" defaultChecked /> Já foi pago / recebido
            </label>
            <div><SubmitButton>Salvar lançamento</SubmitButton></div>
          </form>
        )}
      </details>

      <section className="card">
        <form method="get" className="fields" style={{ marginBottom: ".75rem" }}>
          <input type="hidden" name="mes" value={month} />
          <label>
            Filtrar por conta
            <select name="conta" defaultValue={accountFilter ?? ""}>
              <option value="">Todas as contas</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}><button type="submit" className="link">Filtrar</button></div>
        </form>

        {transactions.length === 0 ? (
          <p className="muted">Nenhum lançamento neste mês.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="hide-sm">Data</th>
                <th>Descrição</th>
                <th className="num">Valor</th>
                <th className="num">Situação</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const late = !t.paid && t.date < todayStr;
                return (
                  <tr key={t.id} data-testid="lancamento">
                    <td className="hide-sm">{formatDate(t.date)}</td>
                    <td>
                      {t.description}
                      <div className="hint">
                        {transactionTypes[t.type]} · {t.accountName}
                        {t.toAccountName && ` → ${t.toAccountName}`}
                        {t.categoryName && ` · ${t.categoryName}`}
                        {t.seriesId && " · mensal"}
                      </div>
                    </td>
                    <td className="num">
                      <Money cents={signedAmount(t)} signed={t.type !== "transfer"} />
                    </td>
                    <td className="actions">
                      <form action={alternarPago}>
                        <input type="hidden" name="voltar" value={back} />
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="pago" value={String(!t.paid)} />
                        {t.paid ? (
                          <button type="submit" className="link" title="Voltar para pendente">
                            <span className="tag">pago</span>
                          </button>
                        ) : (
                          <button type="submit" className="link" title="Marcar como pago">
                            <span className={`tag ${late ? "atrasado" : "pendente"}`}>
                              {late ? "atrasado" : "pendente"}
                            </span>{" "}
                            marcar pago
                          </button>
                        )}
                      </form>
                      <form action={excluirLancamento}>
                        <input type="hidden" name="voltar" value={back} />
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="link danger" aria-label={`Excluir ${t.description}`}>
                          excluir
                        </button>
                        {t.seriesId && (
                          <button type="submit" name="escopo" value="futuros" className="link danger">
                            excluir este e próximos
                          </button>
                        )}
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
