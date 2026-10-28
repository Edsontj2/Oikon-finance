import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { Logo } from "../logo";
import { Navigation } from "./nav";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { name } = await requireUser();
  return (
    <ToastProvider>
      <div className="shell">
        <Navigation />
        <div className="shell-main">
          <header className="topbar">
            <span className="topbar-logo"><Logo size="sm" /></span>
            <div className="topbar-user">
              <span className="avatar" aria-hidden>{name.trim().charAt(0).toUpperCase()}</span>
              <span className="topbar-name">{name}</span>
              <form action={signOut}>
                <button type="submit" className="btn btn-ghost btn-sm">
                  <LogOut size={16} aria-hidden /> Sair
                </button>
              </form>
            </div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
