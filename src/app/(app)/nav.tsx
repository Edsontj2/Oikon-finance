"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, LayoutDashboard, Tags, Wallet } from "lucide-react";

const items = [
  { href: "/", label: "Painel", icon: LayoutDashboard },
  { href: "/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/categorias", label: "Categorias", icon: Tags },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Barra lateral (computador): só ícones, abre ao passar o mouse. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/" className="sidebar-brand" aria-label="OIKON Finance">
        <span className="sidebar-mark">O</span>
        <span className="sidebar-label sidebar-brand-text">OIKON Finance</span>
      </Link>
      <nav className="sidebar-nav">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`sidebar-item ${isActive(pathname, href) ? "active" : ""}`}>
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span className="sidebar-label">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/** Barra de navegação de baixo (celular). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Navegação">
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className={`bottom-item ${isActive(pathname, href) ? "active" : ""}`}>
          <Icon size={20} strokeWidth={1.75} aria-hidden />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
