import type { Metadata } from "next";
import Link from "next/link";
import { contactEmail } from "../contact";

export const metadata: Metadata = { title: "Política de Privacidade · OIKON Finance" };
export const dynamic = "force-dynamic";

export default function PrivacidadePage() {
  const email = contactEmail();
  return (
    <>
      <h1>Política de Privacidade</h1>
      <p className="muted">Última atualização: 4 de novembro de 2026</p>

      <h2>O que é o OIKON Finance</h2>
      <p>
        Um aplicativo de controle financeiro pessoal. Você registra suas contas, cartões, lançamentos, dívidas e metas, e pode
        usar um assistente no WhatsApp para consultar e registrar lançamentos por mensagem.
      </p>

      <h2>Quais dados coletamos</h2>
      <ul>
        <li><strong>Cadastro:</strong> nome, e-mail e senha (a senha é guardada apenas como hash; ninguém consegue lê-la).</li>
        <li><strong>Dados financeiros que você informa:</strong> contas, saldos, cartões, lançamentos, categorias, empréstimos e conciliações.</li>
        <li>
          <strong>WhatsApp (só se você vincular):</strong> o número de telefone vinculado, o texto das mensagens que você envia ao
          assistente e as respostas, para processar o pedido e mostrar o histórico a você.
        </li>
        <li><strong>Registros técnicos:</strong> data e hora de acesso e de alterações (auditoria), para segurança e para você conferir o que mudou.</li>
      </ul>
      <p>Não coletamos localização, contatos, fotos nem dados bancários de login. Nenhum Pix ou pagamento real é feito pelo app.</p>

      <h2>Para que usamos</h2>
      <ul>
        <li>Mostrar seus saldos, relatórios e previsões.</li>
        <li>Responder às suas mensagens no WhatsApp e registrar lançamentos que você confirmar.</li>
        <li>Proteger sua conta (sessão, limite de tentativas, auditoria).</li>
      </ul>
      <p>Não vendemos, alugamos nem usamos seus dados para publicidade.</p>

      <h2>Com quem os dados são compartilhados</h2>
      <p>Apenas com os serviços necessários para o app funcionar, que tratam os dados em nosso nome:</p>
      <ul>
        <li>Vercel (hospedagem do aplicativo);</li>
        <li>Neon (banco de dados PostgreSQL);</li>
        <li>Meta / WhatsApp Business Platform (entrega das mensagens do assistente, se você vincular o WhatsApp).</li>
      </ul>

      <h2>Por quanto tempo guardamos</h2>
      <p>Enquanto sua conta existir. Ao excluir a conta, os dados financeiros, o vínculo do WhatsApp e o histórico de mensagens são apagados.</p>

      <h2>Seus direitos (LGPD)</h2>
      <p>
        Você pode acessar e corrigir seus dados no próprio app, desvincular o WhatsApp a qualquer momento em Configurações e pedir a
        exclusão de tudo. Veja como em <Link href="/exclusao-de-dados">Exclusão de dados</Link>.
      </p>

      <h2>Contato</h2>
      <p>{email ? <>Dúvidas ou pedidos: <a href={`mailto:${email}`}>{email}</a>.</> : "Dúvidas ou pedidos: pelo e-mail de contato informado na página do app."}</p>
    </>
  );
}
