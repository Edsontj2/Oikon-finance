import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { SubmitButton } from "../../submit-button";
import { Flash, type SearchParams } from "../../ui";
import { cadastrar } from "../actions";
import { AuthShell } from "../auth-shell";

export default async function CadastroPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (await getCurrentUserId()) redirect("/");
  return (
    <AuthShell title="Criar conta">
      <Flash params={params} />
      <form action={cadastrar} className="stack">
        <label>Nome<input name="nome" autoComplete="name" required /></label>
        <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
        <label>
          Senha
          <input name="senha" type="password" autoComplete="new-password" minLength={8} required />
          <span className="hint">Mínimo de 8 caracteres.</span>
        </label>
        <SubmitButton className="btn btn-block" pendingLabel="Criando…">Criar conta</SubmitButton>
      </form>
      <p className="auth-foot">Já tem conta? <Link href="/login">Entrar</Link></p>
    </AuthShell>
  );
}
