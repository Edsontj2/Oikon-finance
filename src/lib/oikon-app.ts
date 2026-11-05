"use client";

import { useEffect, useState } from "react";

/** Funções do celular que o app Android do OIKON expõe para a página (window.OikonApp). */
export type OikonApp = {
  info(): string;
  link(code: string): void;
  unlink(): void;
  setApp(pkg: string, enabled: boolean): void;
  allApps(): string;
  setPaused(paused: boolean): void;
  openNotificationAccess(): void;
  openSetup(): void;
  syncNow(): void;
  print(): void;
};

export type OikonAppInfo = {
  linked: boolean;
  deviceName: string;
  listener: boolean;
  paused: boolean;
  pending: number;
  lastSync: number;
  lastError: string | null;
  apps: OikonAppEntry[];
};

/** "ask": o app avisou valores e espera a pessoa decidir se integra. */
export type OikonAppEntry = { pkg: string; label: string; state: "on" | "off" | "ask"; allowed: boolean; detected: number; known: boolean };

/** Detalhe do evento "oikon-app" que o app dispara quando algo muda no celular. */
export type OikonAppEvent = { linked?: boolean; error?: string; synced?: boolean } | null;

export function getOikonApp(): OikonApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { OikonApp?: OikonApp }).OikonApp ?? null;
}

export function readAppInfo(app: OikonApp): OikonAppInfo | null {
  try {
    const info = JSON.parse(app.info()) as Partial<OikonAppInfo>;
    return typeof info.linked === "boolean" ? (info as OikonAppInfo) : null;
  } catch {
    return null;
  }
}

/** O app do OIKON, se a página estiver aberta dentro dele (só depois de montar, para não divergir do servidor). */
export function useOikonApp(): OikonApp | null {
  const [app, setApp] = useState<OikonApp | null>(null);
  useEffect(() => setApp(getOikonApp()), []);
  return app;
}

export function readAllApps(app: OikonApp): { pkg: string; label: string }[] {
  try {
    const list = JSON.parse(app.allApps()) as { pkg: string; label: string }[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
