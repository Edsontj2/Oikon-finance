import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { PwaRegister } from "./pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "OIKON Finance",
  description: "Controle hoje, liberdade amanhã.",
  applicationName: "OIKON Finance",
  appleWebApp: { capable: true, title: "OIKON", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Ocupa a tela inteira no celular (inclusive atrás do recorte); o CSS respeita as áreas seguras.
  viewportFit: "cover",
  themeColor: "#101114",
  colorScheme: "dark",
};

// Toda página é gerada na hora: a política de segurança (CSP) usa um código novo a cada acesso.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
