import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { currentMonth, formatMonth } from "@/lib/dates";
import { listCategories, type Category } from "@/data/categories";
import { Flash, Money, type SearchParams } from "../../ui";
import { criarCategoria, excluirCategoria } from "../actions";

function CategoryTable({ title, items }: { title: string; items: Category[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Categoria</th>
            <th className="num">No mês</th>
            {title === "Saídas" && <th className="num">Limite mensal</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} data-testid="categoria">
              <td>{c.name}</td>
              <td className="num">
                <Money cents={c.monthTotal} />
                {c.monthlyLimit !== null && c.monthTotal > c.monthlyLimit && (
                  <div><span className="tag atrasado">acima do limite</span></div>
                )}
              </td>
              {title === "Saídas" && (
                <td className="num">{c.monthlyLimit ? <Money cents={c.monthlyLimit} /> : <span className="muted">—</span>}</td>
              )}
              <td className="actions">
                <form action={excluirCategoria}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="link danger" aria-label={`Excluir categoria ${c.name}`}>excluir</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function CategoriasPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const month = currentMonth();
  const categories = await listCategories(getDb(), userId, month);

  return (
    <>
      <h1>Categorias</h1>
      <Flash params={params} />
      <p className="muted">Totais de {formatMonth(month)} (pagos e pendentes).</p>

      <CategoryTable title="Saídas" items={categories.filter((c) => c.kind === "expense")} />
      <CategoryTable title="Entradas" items={categories.filter((c) => c.kind === "income")} />

      <section className="card">
        <h2>Nova categoria</h2>
        <form action={criarCategoria} className="stack">
          <div className="fields">
            <label>Nome<input name="nome" required maxLength={60} /></label>
            <label>
              Tipo
              <select name="tipo" defaultValue="expense">
                <option value="expense">Saída</option>
                <option value="income">Entrada</option>
              </select>
            </label>
            <label>
              Limite mensal (R$)
              <input name="limite" inputMode="decimal" placeholder="opcional" />
              <span className="hint">Só para saídas. O painel avisa quando passar.</span>
            </label>
          </div>
          <div><button type="submit">Criar categoria</button></div>
        </form>
      </section>
    </>
  );
}
