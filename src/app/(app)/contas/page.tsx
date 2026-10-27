import Link from "next/link";
import { SubmitButton } from "../../submit-button";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { accountTypes, listAccounts } from "@/data/accounts";
import { Flash, Money, type SearchParams } from "../../ui";
import { criarConta, excluirConta } from "../actions";

export default async function ContasPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const accounts = await listAccounts(getDb(), userId);
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const projected = accounts.reduce((s, a) => s + a.projectedBalance, 0);

  return (
    <>
      <h1>Contas</h1>
      <Flash params={params} />

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Conta</th>
              <th className="num">Saldo atual</th>
              <th className="num hide-sm">Com pendentes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} data-testid="conta">
                <td>
                  <Link href={`/lancamentos?conta=${a.id}`}>{a.name}</Link>
                  <div className="hint">{accountTypes[a.type]}</div>
                </td>
                <td className="num"><Money cents={a.balance} testId={`conta-saldo-${a.name}`} /></td>
                <td className="num hide-sm"><Money cents={a.projectedBalance} /></td>
                <td className="actions">
                  <form action={excluirConta}>
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="link danger" aria-label={`Excluir conta ${a.name}`}>excluir</button>
                  </form>
                </td>
              </tr>
            ))}
            <tr>
              <th>Total</th>
              <th className="num"><Money cents={total} testId="contas-total" /></th>
              <th className="num hide-sm"><Money cents={projected} /></th>
              <th />
            </tr>
          </tbody>
        </table>
        <p className="hint">
          Saldo atual = saldo inicial + entradas recebidas − saídas pagas ± transferências.
          No cartão de crédito, o saldo negativo é o que você deve.
        </p>
      </section>

      <section className="card">
        <h2>Nova conta</h2>
        <form action={criarConta} className="stack">
          <input type="hidden" name="chave" value={randomUUID()} />
          <div className="fields">
            <label>Nome<input name="nome" required maxLength={60} placeholder="Ex.: Nubank" /></label>
            <label>
              Tipo
              <select name="tipo" defaultValue="checking">
                {Object.entries(accountTypes).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Saldo inicial (R$)
              <input name="saldo_inicial" inputMode="decimal" placeholder="0,00" />
              <span className="hint">Use negativo (ex.: -350,00) para fatura de cartão em aberto.</span>
            </label>
          </div>
          <div><SubmitButton>Criar conta</SubmitButton></div>
        </form>
      </section>
    </>
  );
}
