"use client";

import Link from "next/link";
import { LIMITS } from "@/domain/limits";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { signIn, signUp } from "./actions";

export function LoginForm() {
  const { run, pending, error } = useServerAction(signIn);
  return (
    <>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(new FormData(e.currentTarget));
        }}
      >
        <label>E-mail<input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={LIMITS.email} /></label>
        <label>Senha<input name="password" type="password" autoComplete="current-password" required maxLength={200} /></label>
        <FormError message={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
      <p className="auth-foot">Ainda não tem conta? <Link href="/cadastro">Criar conta</Link></p>
    </>
  );
}

export function SignupForm() {
  const { run, pending, error } = useServerAction(signUp);
  return (
    <>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(new FormData(e.currentTarget));
        }}
      >
        <label>Nome<input name="name" autoComplete="name" required maxLength={LIMITS.userName} /></label>
        <label>E-mail<input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={LIMITS.email} /></label>
        <label>
          Senha
          <input name="password" type="password" autoComplete="new-password" minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMaxBytes} required />
          <span className="hint">De {LIMITS.passwordMin} a {LIMITS.passwordMaxBytes} caracteres.</span>
        </label>
        <FormError message={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Criando…" : "Criar conta"}
        </button>
      </form>
      <p className="auth-foot">Já tem conta? <Link href="/login">Entrar</Link></p>
      <p className="auth-foot">Ao criar a conta você concorda com os <Link href="/termos">Termos</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.</p>
    </>
  );
}
