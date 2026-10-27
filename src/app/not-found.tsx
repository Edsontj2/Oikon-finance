import Link from "next/link";
import { Logo } from "./logo";

export default function NotFound() {
  return (
    <div className="auth">
      <Logo size="lg" />
      <div className="auth-box">
        <div className="card">
          <div className="card-header">
            <h1 className="card-title">Página não encontrada</h1>
            <p className="card-sub">O endereço que você abriu não existe.</p>
          </div>
          <Link href="/" className="btn btn-primary btn-block">Ir para o painel</Link>
        </div>
      </div>
    </div>
  );
}
