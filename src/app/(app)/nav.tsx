"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, CalendarClock, CalendarRange, CreditCard, Ellipsis, FileText, FileUp, HandCoins, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Tags, Target, Wallet } from "lucide-react";

const items = [
  { href: "/", label: "Painel", icon: LayoutDashboard },
  { href: "/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  { href: "/agenda", label: "Agenda", icon: CalendarClock },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/cartoes", label: "Cartões", icon: CreditCard },
  { href: "/dividas", label: "Dívidas", icon: HandCoins },
  { href: "/planejamento", label: "Planejamento", icon: CalendarRange },
  { href: "/metas", label: "Metas", icon: Target },
  { href: "/importar", label: "Importar extrato", icon: FileUp },
  { href: "/relatorio", label: "Relatório", icon: FileText },
  { href: "/categorias", label: "Categorias", icon: Tags },
];

/** Celular: 4 abas principais + "Mais" (o resto). */
const bottomItems = [...items.filter((i) => ["/", "/lancamentos", "/agenda", "/contas"].includes(i.href)), { href: "/mais", label: "Mais", icon: Ellipsis }];
const inMore = ["/cartoes", "/dividas", "/planejamento", "/metas", "/importar", "/relatorio", "/categorias", "/configuracoes", "/mais"];

const PIN_KEY = "oikon:menu-fixo";

/** Menu lateral fixado aberto ou retrátil (padrão). Fica guardado no navegador. */
function usePinnedSidebar() {
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    try {
      setPinned(localStorage.getItem(PIN_KEY) === "1");
    } catch {
      // Sem armazenamento: fica retrátil.
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.sidebar = pinned ? "pinned" : "auto";
  }, [pinned]);
  const toggle = () => {
    setPinned((p) => {
      try {
        localStorage.setItem(PIN_KEY, p ? "0" : "1");
      } catch {
        // Sem armazenamento: vale só nesta visita.
      }
      return !p;
    });
  };
  return { pinned, toggle };
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Barra lateral (computador) e barra de baixo (celular). A aba tocada fica marcada na hora
 * e uma barrinha no topo mostra que a página está carregando, sem esperar o servidor.
 */
export function Navigation() {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  const { pinned, toggle } = usePinnedSidebar();
  // Chegou na página (ou voltou pelo navegador): não há mais nada carregando.
  useEffect(() => setPending(null), [pathname]);

  const current = pending ?? pathname;
  const go = (href: string) => () => {
    if (pathname !== href) setPending(href);
  };

  return (
    <>
      {pending && pending !== pathname && <div className="route-progress" role="progressbar" aria-label="Carregando" />}
      <aside className="sidebar">
        <Link href="/" className="sidebar-brand" aria-label="OIKON Finance" onClick={go("/")}>
          <span className="sidebar-mark">O</span>
          <span className="sidebar-label sidebar-brand-text">OIKON Finance</span>
        </Link>
        <nav className="sidebar-nav">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={go(href)} className={`sidebar-item ${isActive(current, href) ? "active" : ""}`}>
              <Icon size={20} strokeWidth={1.75} aria-hidden />
              <span className="sidebar-label">{label}</span>
            </Link>
          ))}
        </nav>
        <button type="button" className="sidebar-pin" onClick={toggle} aria-pressed={pinned}>
          {pinned ? <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden /> : <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden />}
          <span className="sidebar-label">{pinned ? "Recolher menu" : "Fixar menu aberto"}</span>
        </button>
      </aside>
      <nav className="bottom-nav" aria-label="Navegação">
        {bottomItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={go(href)}
            className={`bottom-item ${(href === "/mais" ? inMore.some((h) => isActive(current, h)) : isActive(current, href)) ? "active" : ""}`}
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
