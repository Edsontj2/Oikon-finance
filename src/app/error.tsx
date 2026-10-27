"use client";

import Link from "next/link";
import { Logo } from "./logo";

/** Erro inesperado numa página: mensagem em português, sem detalhes técnicos. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="auth">
      <Logo size="lg" />
      <div className="auth-box">
        <div className="card">
          <div className="card-header">
            <h1 className="card-title">Algo deu errado</h1>
            <p className="card-sub">Não foi possível carregar esta tela. Seus dados não foram alterados.</p>
          </div>
          <div className="stack-actions">
            <button type="button" className="btn btn-primary" onClick={reset}>Tentar de novo</button>
            <Link href="/" className="btn btn-secondary">Ir para o painel</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
