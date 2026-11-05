"use client";

import { Printer } from "lucide-react";
import { getOikonApp } from "@/lib/oikon-app";

/** Abre a impressão (do navegador ou do Android, dentro do app); lá dá para escolher "Salvar como PDF". */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => { const app = getOikonApp(); if (app) app.print(); else window.print(); }}>
      <Printer size={18} aria-hidden /> Salvar em PDF
    </button>
  );
}
