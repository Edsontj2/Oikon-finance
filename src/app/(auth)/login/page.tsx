import Link from "next/link";
import { Flash, type SearchParams } from "../../ui";
import { entrar } from "../actions";
import { AuthShell } from "../auth-shell";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <AuthShell title="Entrar">
      <Flash params={params} />
      <form action={entrar} className="stack">
        <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
        <label>Senha<input name="senha" type="password" autoComplete="current-password" required /></label>
        <button type="submit" className="btn btn-block">Entrar</button>
      </form>
      <p className="auth-foot">Ainda não tem conta? <Link href="/cadastro">Criar conta</Link></p>
    </AuthShell>
  );
}
