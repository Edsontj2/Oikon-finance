import Link from "next/link";
import { Logo } from "../logo";

/** Páginas públicas (sem login): política de privacidade, termos e exclusão de dados. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="legal">
      <Link href="/" aria-label="OIKON Finance"><Logo /></Link>
      <article className="card legal-body">{children}</article>
      <nav className="legal-nav" aria-label="Documentos">
        <Link href="/privacidade">Privacidade</Link> · <Link href="/termos">Termos de uso</Link> · <Link href="/exclusao-de-dados">Exclusão de dados</Link>
      </nav>
    </main>
  );
}
