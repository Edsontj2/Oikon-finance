"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readAllApps, readAppInfo, type OikonApp, type OikonAppEvent, type OikonAppInfo } from "@/lib/oikon-app";
import { generateDeviceCode } from "./actions";

/** Dentro do app Android: ativar e ajustar a leitura deste celular sem digitar código. */
export function ThisPhone({ app }: { app: OikonApp }) {
  const router = useRouter();
  const [info, setInfo] = useState<OikonAppInfo | null>(() => readAppInfo(app));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const refresh = useCallback(() => setInfo(readAppInfo(app)), [app]);

  useEffect(() => {
    const onApp = (e: Event) => {
      const detail = (e as CustomEvent<OikonAppEvent>).detail ?? null;
      if (detail?.error) setMessage({ text: detail.error, bad: true });
      else if (detail?.linked) setMessage({ text: "Pronto! Este celular já está lendo as notificações dos bancos marcados." });
      setBusy(false);
      refresh();
      router.refresh();
    };
    window.addEventListener("oikon-app", onApp);
    return () => window.removeEventListener("oikon-app", onApp);
  }, [refresh, router]);

  async function activate() {
    setBusy(true);
    setMessage(null);
    try {
      const { code } = await generateDeviceCode();
      app.link(code);
    } catch {
      setBusy(false);
      setMessage({ text: "Não deu para ativar agora. Confira a internet e tente de novo.", bad: true });
    }
  }

  if (!info) return null;

  if (!info.linked) {
    return (
      <div className="stack this-phone" data-testid="este-celular">
        <p>Ative para o OIKON ler as notificações dos seus apps de banco neste celular. Nada vira lançamento sem você confirmar aqui.</p>
        <div className="stack-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={activate}>{busy ? "Ativando…" : "Ativar neste celular"}</button>
        </div>
        {message && <p className={message.bad ? "form-error" : "form-ok"} role="status">{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="stack this-phone" data-testid="este-celular">
      {message && <p className={message.bad ? "form-error" : "form-ok"} role="status">{message.text}</p>}
      <ol className="steps steps-done">
        <li className="done">Celular ativado ({info.deviceName}).</li>
        <li className={info.listener ? "done" : undefined}>
          {info.listener ? (
            "Acesso às notificações permitido."
          ) : (
            <>
              Falta permitir o acesso às notificações: toque abaixo, ache <strong>OIKON</strong> e ative.
              <div className="stack-actions">
                <button type="button" className="btn btn-primary" onClick={() => app.openNotificationAccess()}>Permitir acesso às notificações</button>
              </div>
            </>
          )}
        </li>
        <li className={info.apps.some((a) => a.allowed) ? "done" : undefined}>
          Apps integrados: o OIKON percebe qualquer app que avise um valor em R$ e pergunta se você quer integrar. Você decide cada um.
        </li>
      </ol>
      <Apps app={app} info={info} onChange={refresh} />
      <p className="hint">
        {info.pending > 0 ? `${info.pending} esperando envio (sai quando houver internet).` : "Nada esperando envio."}
        {info.lastSync > 0 ? ` Último envio: ${new Date(info.lastSync).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.` : ""}
      </p>
      {info.lastError && <p className="form-error">{info.lastError}</p>}
      <div className="stack-actions">
        <button type="button" className="btn btn-secondary" onClick={() => app.syncNow()}>Enviar agora</button>
        <button type="button" className="btn btn-secondary" onClick={() => app.openSetup()}>Ver o que foi captado</button>
      </div>
    </div>
  );
}

function Apps({ app, info, onChange }: { app: OikonApp; info: OikonAppInfo; onChange: () => void }) {
  const [all, setAll] = useState<{ pkg: string; label: string }[] | null>(null);
  const [search, setSearch] = useState("");
  const ask = info.apps.filter((a) => a.state === "ask");
  const decided = info.apps.filter((a) => a.state !== "ask");
  const set = (pkg: string, on: boolean) => { app.setApp(pkg, on); onChange(); };
  const known = new Set(info.apps.map((a) => a.pkg));
  const term = search.trim().toLowerCase();
  const others = (all ?? []).filter((a) => !known.has(a.pkg) && (!term || a.label.toLowerCase().includes(term)));

  return (
    <div className="stack">
      {ask.length > 0 && (
        <div className="stack" aria-label="Apps novos">
          {ask.map((a) => (
            <div key={a.pkg} className="app-ask" data-testid="app-novo">
              <span><strong>{a.label}</strong> avisou {a.detected === 1 ? "1 valor" : `${a.detected} valores`} em R$. Integrar ao OIKON?</span>
              <div className="stack-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => set(a.pkg, true)}>Integrar</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => set(a.pkg, false)}>Não integrar</button>
              </div>
            </div>
          ))}
          <p className="hint">Até você decidir, o que chegou desses apps fica só no celular. Integrando, já vem para confirmar.</p>
        </div>
      )}
      {decided.length > 0 && (
        <div className="bank-apps" aria-label="Apps integrados">
          {decided.map((a) => (
            <label key={a.pkg} className="check">
              <input type="checkbox" checked={a.allowed} onChange={(e) => set(a.pkg, e.target.checked)} />
              {a.label}
            </label>
          ))}
        </div>
      )}
      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !all) setAll(readAllApps(app)); }}>
        <summary>Integrar outro app</summary>
        <div className="stack">
          <input type="search" placeholder="Buscar app pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar app" />
          {all && others.length === 0 && <p className="hint">Nenhum app encontrado.</p>}
          <ul className="list">
            {others.slice(0, 50).map((a) => (
              <li key={a.pkg} className="mini-list-line device-row">
                <span>{a.label}</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => set(a.pkg, true)}>Integrar</button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
