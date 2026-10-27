import { LogOut } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { getUserName } from "@/data/users";
import { ToastProvider } from "@/components/toast";
import { Logo } from "../logo";
import { BottomNav, Sidebar } from "./nav";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  const name = (await getUserName(getDb(), userId)) ?? "";
  return (
    <ToastProvider>
      <div className="shell">
        <Sidebar />
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
        <BottomNav />
      </div>
    </ToastProvider>
  );
}
