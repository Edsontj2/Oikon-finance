import type { Metadata } from "next";
import { contactEmail } from "../contact";

export const metadata: Metadata = { title: "Exclusão de dados · OIKON Finance" };
export const dynamic = "force-dynamic";

export default function ExclusaoPage() {
  const email = contactEmail();
  return (
    <>
      <h1>Como excluir seus dados</h1>

      <h2>Desvincular o WhatsApp</h2>
      <ol>
        <li>Entre no OIKON Finance.</li>
        <li>Abra <strong>Configurações</strong> (ícone de engrenagem no topo).</li>
        <li>Em <strong>Assistente no WhatsApp</strong>, toque em <strong>Desvincular</strong>.</li>
      </ol>
      <p>O número deixa de ter acesso na hora e operações pendentes são canceladas.</p>

      <h2>Excluir a conta e todos os dados</h2>
      <p>
        {email ? (
          <>Envie um e-mail para <a href={`mailto:${email}?subject=Excluir%20minha%20conta%20OIKON`}>{email}</a> a partir do e-mail cadastrado, com o assunto “Excluir minha conta”.</>
        ) : (
          <>Envie um pedido a partir do e-mail cadastrado, com o assunto “Excluir minha conta”, para o e-mail de contato do app.</>
        )}{" "}
        Em até 15 dias apagamos o cadastro, contas, cartões, lançamentos, empréstimos, vínculo do WhatsApp, histórico de mensagens e
        registros de auditoria, e confirmamos por e-mail.
      </p>
    </>
  );
}
