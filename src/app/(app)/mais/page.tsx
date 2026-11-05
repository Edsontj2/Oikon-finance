import Link from "next/link";
import { CalendarRange, CreditCard, FileText, FileUp, HandCoins, Settings, Tags, Target } from "lucide-react";

/** No celular, a barra de baixo tem 5 abas; o resto fica aqui. */
export default function MaisPage() {
  const links = [
    { href: "/cartoes", label: "Cartões", icon: CreditCard },
    { href: "/dividas", label: "Dívidas e empréstimos", icon: HandCoins },
    { href: "/planejamento", label: "Planejamento: previsão e orçamento", icon: CalendarRange },
    { href: "/metas", label: "Metas e reserva de emergência", icon: Target },
    { href: "/importar", label: "Importar extrato (OFX ou CSV)", icon: FileUp },
    { href: "/relatorio", label: "Relatório do mês (PDF e CSV)", icon: FileText },
    { href: "/categorias", label: "Categorias", icon: Tags },
    { href: "/configuracoes", label: "Configurações e WhatsApp", icon: Settings },
  ];
  return (
    <>
      <div className="page-head"><h1>Mais</h1></div>
      <ul className="list card more-list">
        {links.map(({ href, label, icon: Icon }) => (
          <li key={href} className="row">
            <Link href={href}><Icon size={20} strokeWidth={1.75} aria-hidden /> {label}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
