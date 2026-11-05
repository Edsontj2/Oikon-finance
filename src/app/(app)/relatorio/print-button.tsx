"use client";

import { Printer } from "lucide-react";

/** Abre a impressão do navegador; lá dá para escolher "Salvar como PDF". */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      <Printer size={18} aria-hidden /> Salvar em PDF
    </button>
  );
}
