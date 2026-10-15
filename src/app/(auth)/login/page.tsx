import Link from "next/link";
import { Flash, type SearchParams } from "../../ui";
import { entrar } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="auth">
      <div className="brand">Oikon Finance</div>
      <div className="card">
        <h1>Entrar</h1>
        <Flash params={params} />
        <form action={entrar} className="stack">
          <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
          <label>Senha<input name="senha" type="password" autoComplete="current-password" required /></label>
          <button type="submit">Entrar</button>
        </form>
      </div>
      <p className="muted">Ainda não tem conta? <Link href="/cadastro">Criar conta</Link></p>
    </main>
  );
}
