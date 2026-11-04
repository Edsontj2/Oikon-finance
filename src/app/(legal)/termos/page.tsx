import type { Metadata } from "next";
import Link from "next/link";
import { contactEmail } from "../contact";

export const metadata: Metadata = { title: "Termos de uso · OIKON Finance" };
export const dynamic = "force-dynamic";

export default function TermosPage() {
  const email = contactEmail();
  return (
    <>
      <h1>Termos de uso</h1>
      <p className="muted">Última atualização: 4 de novembro de 2026</p>
      <ul>
        <li>O OIKON Finance é uma ferramenta de organização financeira pessoal. Ele não movimenta dinheiro, não faz Pix e não é um banco.</li>
        <li>Os valores, previsões e simulações (por exemplo, de empréstimos) são calculados a partir do que você registra e são estimativas; confira sempre com seu banco e seus contratos.</li>
        <li>Você é responsável pelos dados que registra e por manter sua senha em segredo.</li>
        <li>O assistente no WhatsApp só grava lançamentos depois da sua confirmação; você pode desvincular o número a qualquer momento.</li>
        <li>Seus dados são tratados conforme a <Link href="/privacidade">Política de Privacidade</Link>.</li>
      </ul>
      {email && <p>Contato: <a href={`mailto:${email}`}>{email}</a>.</p>}
    </>
  );
}
