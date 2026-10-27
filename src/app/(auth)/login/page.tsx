import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { SubmitButton } from "../../submit-button";
import { Flash, type SearchParams } from "../../ui";
import { entrar } from "../actions";
import { AuthShell } from "../auth-shell";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (await getCurrentUserId()) redirect("/");
  return (
    <AuthShell title="Entrar">
      <Flash params={params} />
      <form action={entrar} className="stack">
        <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
        <label>Senha<input name="senha" type="password" autoComplete="current-password" required /></label>
        <SubmitButton className="btn btn-block" pendingLabel="Entrando…">Entrar</SubmitButton>
      </form>
      <p className="auth-foot">Ainda não tem conta? <Link href="/cadastro">Criar conta</Link></p>
    </AuthShell>
  );
}
