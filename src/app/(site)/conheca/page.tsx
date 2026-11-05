import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight, BellRing, CalendarClock, Check, CreditCard, FileDown, FileUp, LineChart, PiggyBank,
  Repeat, ShieldCheck, Smartphone, Target, Wallet,
} from "lucide-react";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { Logo } from "../../logo";
import "./landing.css";

export const metadata: Metadata = {
  title: "OIKON Finance — Controle hoje, liberdade amanhã",
  description:
    "Contas, cartões, contas a pagar, orçamento e metas em um só lugar. O app Android lê as notificações do seu banco e você só confirma.",
  openGraph: {
    title: "OIKON Finance — Controle hoje, liberdade amanhã",
    description: "Suas finanças organizadas sem planilha: o OIKON lê as notificações do banco e você só confirma.",
    type: "website",
    locale: "pt_BR",
  },
};

const APK = "https://github.com/Edsontj2/Oikon-finance/releases/latest/download/oikon.apk";

const features = [
  { icon: Wallet, title: "Contas e saldos", text: "Conta corrente, poupança, carteira e investimentos com o saldo de cada uma e o patrimônio total." },
  { icon: CreditCard, title: "Cartões e faturas", text: "Compras parceladas, limite usado e a fatura de cada mês, com o dia de fechar e de vencer." },
  { icon: Repeat, title: "Contas de todo mês", text: "Aluguel, internet, assinatura: lance uma vez e o OIKON repete todo mês até você parar." },
  { icon: CalendarClock, title: "Agenda do que vence", text: "O que pagar e receber nos próximos dias, com aviso do que está atrasado." },
  { icon: PiggyBank, title: "Orçamento por categoria", text: "Defina quanto quer gastar em cada categoria e veja, durante o mês, se está dentro." },
  { icon: Target, title: "Metas e reserva", text: "Junte dinheiro para um objetivo ou para a reserva de emergência e saiba quando vai chegar lá." },
  { icon: LineChart, title: "Previsão de saldo", text: "Quanto vai sobrar daqui a 7, 15, 30, 60 ou 90 dias, contando contas, faturas e recorrentes." },
  { icon: FileUp, title: "Importar extrato", text: "Traga o extrato OFX ou CSV do banco: o OIKON separa o que é novo do que já foi lançado." },
  { icon: FileDown, title: "Relatório e exportação", text: "Relatório do mês para salvar em PDF e todos os lançamentos em CSV, quando quiser." },
];

const faq = [
  {
    q: "Preciso dar a senha do meu banco?",
    a: "Não. O OIKON nunca pede senha de banco. No Android, o app lê só as notificações que o seu banco já mostra no celular, e só dos apps que você escolher.",
  },
  {
    q: "Ele lança as coisas sozinho?",
    a: "Não. Cada compra ou Pix lido aparece para você confirmar, já com valor, conta e categoria sugeridos. Nada vira lançamento sem o seu toque.",
  },
  {
    q: "Funciona com o meu banco?",
    a: "Funciona com qualquer banco que avise compras e Pix por notificação. Quando um app novo avisa um valor em R$, o OIKON pergunta se você quer integrá-lo.",
  },
  {
    q: "E no iPhone?",
    a: "O OIKON funciona no navegador de qualquer celular ou computador e pode ser instalado na tela inicial. No iPhone a Apple não deixa ler notificações de outros apps, então lá você usa a importação de extrato.",
  },
  {
    q: "Consigo levar meus dados embora?",
    a: "Sim. Você exporta tudo em CSV a qualquer momento e pode pedir a exclusão da conta e de todos os dados.",
  },
];

export default async function Landing() {
  const logged = Boolean(await verifySession((await cookies()).get(SESSION_COOKIE)?.value));
  const primary = logged ? { href: "/", label: "Abrir meu OIKON" } : { href: "/cadastro", label: "Criar minha conta" };

  return (
    <div className="lp">
      <header className="lp-top">
        <Link href="/conheca" aria-label="OIKON Finance"><Logo size="sm" /></Link>
        <nav className="lp-top-nav" aria-label="Principal">
          <a href="#recursos">Recursos</a>
          <a href="#banco">Notificações do banco</a>
          <a href="#duvidas">Dúvidas</a>
          {logged ? (
            <Link href="/" className="btn btn-primary btn-sm">Abrir</Link>
          ) : (
            <Link href="/login" className="btn btn-secondary btn-sm">Entrar</Link>
          )}
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <p className="lp-kicker">Finanças pessoais, sem planilha</p>
            <h1>Controle hoje, <span>liberdade amanhã.</span></h1>
            <p className="lp-lead">
              Contas, cartões, contas a pagar, orçamento e metas em um só lugar. E no Android, o OIKON lê as notificações
              do seu banco: você só confere e confirma.
            </p>
            <div className="lp-cta">
              <Link href={primary.href} className="btn btn-primary lp-btn-lg">{primary.label} <ArrowRight size={18} aria-hidden /></Link>
              {!logged && <Link href="/login" className="btn btn-secondary lp-btn-lg">Já tenho conta</Link>}
            </div>
            <ul className="lp-checks">
              <li><Check size={16} aria-hidden /> Sem senha de banco</li>
              <li><Check size={16} aria-hidden /> Nada é lançado sem você confirmar</li>
              <li><Check size={16} aria-hidden /> Celular e computador</li>
            </ul>
          </div>

          <div className="lp-phone" aria-hidden>
            <div className="lp-phone-screen">
              <div className="lp-mock-head"><Logo size="sm" /><span className="lp-mock-tag">exemplo</span></div>
              <div className="lp-mock-card">
                <span className="lp-mock-label">Saldo em contas</span>
                <strong className="lp-mock-big">R$ 8.420,15</strong>
                <span className="lp-mock-good">Sobra prevista em 30 dias: R$ 2.310,00</span>
              </div>
              <div className="lp-mock-notify">
                <BellRing size={16} />
                <div>
                  <strong>Compra · R$ 89,90</strong>
                  <span>Nubank · SUPERMERCADO</span>
                </div>
                <span className="lp-mock-btn">Confirmar</span>
              </div>
              <div className="lp-mock-card">
                <span className="lp-mock-label">Orçamento do mês</span>
                <div className="lp-bar"><span style={{ width: "62%" }} /></div>
                <div className="lp-mock-row"><span>Mercado</span><span>R$ 620 de R$ 1.000</span></div>
                <div className="lp-bar"><span className="warn" style={{ width: "88%" }} /></div>
                <div className="lp-mock-row"><span>Lazer</span><span>R$ 264 de R$ 300</span></div>
              </div>
              <div className="lp-mock-card">
                <span className="lp-mock-label">Meta: viagem</span>
                <div className="lp-bar"><span style={{ width: "45%" }} /></div>
                <div className="lp-mock-row"><span>R$ 2.700 de R$ 6.000</span><span>março</span></div>
              </div>
              <div className="lp-mock-card">
                <span className="lp-mock-label">A pagar esta semana</span>
                <div className="lp-mock-row"><span>Internet</span><span>R$ 99,90</span></div>
                <div className="lp-mock-row"><span>Fatura do cartão</span><span>R$ 1.204,33</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-pains" aria-label="Para quem é">
          <div><strong>Chega o fim do mês e o dinheiro sumiu?</strong><span>Veja para onde foi, por categoria, no mês e ao longo do tempo.</span></div>
          <div><strong>Esquece conta e paga juros?</strong><span>A agenda mostra o que vence e o que já atrasou.</span></div>
          <div><strong>Planilha nunca dura duas semanas?</strong><span>O banco avisa, o OIKON lê, você confirma com um toque.</span></div>
        </section>

        <section id="banco" className="lp-section lp-bank">
          <div className="lp-section-head">
            <p className="lp-kicker"><Smartphone size={16} aria-hidden /> App Android</p>
            <h2>O banco avisa. O OIKON anota. Você só confirma.</h2>
            <p>O jeito mais rápido de manter tudo em dia: as compras e os Pix chegam sozinhos, prontos para conferir.</p>
          </div>
          <ol className="lp-steps">
            <li>
              <span className="lp-step-n">1</span>
              <strong>Você compra ou faz um Pix</strong>
              <span>O app do seu banco mostra a notificação de sempre, como &ldquo;Compra de R$ 89,90 aprovada&rdquo;.</span>
            </li>
            <li>
              <span className="lp-step-n">2</span>
              <strong>O OIKON lê e organiza</strong>
              <span>Entende o valor, o tipo, a loja ou a pessoa, o cartão e as parcelas, e sugere a conta e a categoria.</span>
            </li>
            <li>
              <span className="lp-step-n">3</span>
              <strong>Você confere e confirma</strong>
              <span>Um toque e vira lançamento. Se não for movimentação de verdade, é só ignorar.</span>
            </li>
          </ol>
          <ul className="lp-bank-points">
            <li><ShieldCheck size={18} aria-hidden /><span>Lê qualquer banco, mas só os apps que <strong>você</strong> integrar</span></li>
            <li><ShieldCheck size={18} aria-hidden /><span>Só notificações com valor em R$ saem do celular</span></li>
            <li><ShieldCheck size={18} aria-hidden /><span>Sem internet, guarda e envia depois, sem duplicar</span></li>
            <li><ShieldCheck size={18} aria-hidden /><span>Pause ou desconecte o celular quando quiser</span></li>
          </ul>
        </section>

        <section id="recursos" className="lp-section">
          <div className="lp-section-head">
            <p className="lp-kicker">Tudo em um só lugar</p>
            <h2>Do cafezinho à fatura do cartão</h2>
          </div>
          <div className="lp-grid">
            {features.map(({ icon: Icon, title, text }) => (
              <article key={title} className="lp-feature">
                <span className="lp-feature-icon"><Icon size={20} aria-hidden /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section lp-trust">
          <div className="lp-section-head">
            <p className="lp-kicker"><ShieldCheck size={16} aria-hidden /> Seus dados, suas regras</p>
            <h2>Feito para você confiar</h2>
          </div>
          <div className="lp-trust-grid">
            <div><strong>Sem senha de banco</strong><span>O OIKON não acessa sua conta bancária. Ele só lê o que você já recebe no celular.</span></div>
            <div><strong>Você no controle</strong><span>Nada é lançado sem a sua confirmação, e você escolhe quais apps o OIKON pode ler.</span></div>
            <div><strong>Não vendemos seus dados</strong><span>Nada de publicidade com as suas informações. Veja a <Link href="/privacidade">política de privacidade</Link>.</span></div>
            <div><strong>Leve tudo embora</strong><span>Exporte em CSV quando quiser ou peça a <Link href="/exclusao-de-dados">exclusão dos dados</Link>.</span></div>
          </div>
        </section>

        <section className="lp-section lp-platforms">
          <div className="lp-platform">
            <Smartphone size={22} aria-hidden />
            <div>
              <strong>Android</strong>
              <span>O OIKON completo, mais a leitura das notificações do banco.</span>
            </div>
            <a href={APK} className="btn btn-secondary btn-sm">Baixar o app</a>
          </div>
          <div className="lp-platform">
            <Wallet size={22} aria-hidden />
            <div>
              <strong>iPhone e computador</strong>
              <span>Pelo navegador, com opção de instalar na tela inicial. Use a importação de extrato.</span>
            </div>
            <Link href={primary.href} className="btn btn-secondary btn-sm">{logged ? "Abrir" : "Começar"}</Link>
          </div>
        </section>

        <section id="duvidas" className="lp-section lp-faq">
          <div className="lp-section-head"><h2>Dúvidas comuns</h2></div>
          {faq.map(({ q, a }) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>

        <section className="lp-final">
          <h2>Comece hoje. Seu eu do futuro agradece.</h2>
          <p>Leva um minuto para criar a conta e cadastrar a primeira conta bancária.</p>
          <Link href={primary.href} className="btn btn-primary lp-btn-lg">{primary.label} <ArrowRight size={18} aria-hidden /></Link>
        </section>
      </main>

      <footer className="lp-footer">
        <Logo size="sm" />
        <nav aria-label="Documentos">
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/termos">Termos de uso</Link>
          <Link href="/exclusao-de-dados">Exclusão de dados</Link>
          <Link href="/login">Entrar</Link>
        </nav>
      </footer>
    </div>
  );
}
