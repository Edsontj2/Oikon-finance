import Link from "next/link";
import { Flash, type SearchParams } from "../../ui";
import { cadastrar } from "../actions";

export default async function CadastroPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="auth">
      <div className="brand">Oikon Finance</div>
      <div className="card">
        <h1>Criar conta</h1>
        <Flash params={params} />
        <form action={cadastrar} className="stack">
          <label>Nome<input name="nome" autoComplete="name" required /></label>
          <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
          <label>
            Senha
            <input name="senha" type="password" autoComplete="new-password" minLength={8} required />
            <span className="hint">Mínimo de 8 caracteres.</span>
          </label>
          <button type="submit">Criar conta</button>
        </form>
      </div>
      <p className="muted">Já tem conta? <Link href="/login">Entrar</Link></p>
    </main>
  );
}
