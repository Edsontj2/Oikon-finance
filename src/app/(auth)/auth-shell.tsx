import { Logo } from "../logo";

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <Logo size="lg" />
      <div className="auth-box">
        <div className="card">
          <div className="card-header">
            <h1 className="card-title">{title}</h1>
            <p className="card-sub">Controle hoje, liberdade amanhã.</p>
          </div>
          <div className="card-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
