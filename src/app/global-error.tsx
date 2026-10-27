"use client";

/** Último recurso: erro no próprio layout. Precisa ter html/body e estilo próprio. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#101114", color: "#f5f5f5", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
        <main>
          <h1 style={{ fontSize: "1.25rem" }}>Algo deu errado</h1>
          <p style={{ color: "#a7abb3" }}>Não foi possível abrir o OIKON agora.</p>
          <button type="button" onClick={reset} style={{ font: "inherit", padding: "10px 18px", borderRadius: 8, border: 0, background: "#d6a457", color: "#0b0b0d", fontWeight: 600 }}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
