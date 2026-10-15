import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { getUserName } from "@/data/users";
import { sair } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  const name = await getUserName(getDb(), userId);
  return (
    <>
      <header className="topbar">
        <Link href="/" className="logo">Oikon Finance</Link>
        <nav>
          <Link href="/">Painel</Link>
          <Link href="/lancamentos">Lançamentos</Link>
          <Link href="/contas">Contas</Link>
          <Link href="/categorias">Categorias</Link>
        </nav>
        <form action={sair}>
          <span className="muted hide-sm">{name} · </span>
          <button type="submit" className="link">Sair</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
