"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import type { MessageLogEntry } from "@/data/assistant/link";
import { FormError } from "@/components/form-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { createWhatsappCode, saveWhatsappSettings, unlinkWhatsapp } from "./actions";

type Link = { phone: string; status: "active" | "paused"; defaultAccountId: string | null; allowEntries: boolean; linkedAt: string };

const statusLabels: Record<string, string> = { processed: "ok", error: "erro", ignored: "ignorada", received: "recebida" };

/** Conectar/desvincular o WhatsApp, preferências do assistente e histórico de mensagens. */
export function WhatsappSettings({
  configured,
  botNumber,
  link,
  accounts,
  messages,
}: {
  configured: boolean;
  botNumber: string | null;
  link: Link | null;
  accounts: AccountOption[];
  messages: MessageLogEntry[];
}) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const save = useServerAction(saveWhatsappSettings);
  const remove = useServerAction(unlinkWhatsapp, () => setConfirmUnlink(false));

  const generate = () =>
    startGenerating(async () => {
      setCodeError(null);
      const result = await createWhatsappCode();
      if (result.ok) setCode({ code: result.code, expiresAt: result.expiresAt });
      else setCodeError(result.message);
    });

  const expires = code ? new Date(code.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const waLink = botNumber && code ? `https://wa.me/${botNumber}?text=${encodeURIComponent(`vincular ${code.code}`)}` : null;

  return (
    <>
      <section className="card" aria-labelledby="wa-title">
        <h2 id="wa-title" className="card-icon-title"><MessageCircle size={18} aria-hidden /> Assistente no WhatsApp</h2>
        <p className="muted">
          Registre gastos, entradas e transferências e consulte saldos por mensagem. Todo lançamento é mostrado para você confirmar
          antes de ser gravado. Nenhum Pix ou pagamento real é feito pelo WhatsApp.
        </p>
        {!configured && (
          <p className="form-error" role="alert">
            A integração ainda não foi configurada no servidor (faltam as chaves da WhatsApp Business Platform).
          </p>
        )}

        {link ? (
          <div className="wa-status">
            <span className={`tag ${link.status === "active" ? "tag-ok" : "tag-pending"}`}>{link.status === "active" ? "conectado" : "pausado"}</span>
            <span>Número {link.phone} · desde {new Date(link.linkedAt).toLocaleDateString("pt-BR")}</span>
          </div>
        ) : (
          <div className="stack">
            <p>Para conectar, gere um código e envie <b>vincular</b> e o código para o número do assistente pelo seu WhatsApp.</p>
            {code ? (
              <div className="installment-preview">
                <strong>vincular {code.code}</strong>
                <span>Vale até {expires}, uma única vez.{botNumber ? ` Número do assistente: +${botNumber}.` : ""}</span>
                {waLink && (
                  <a className="btn btn-primary" href={waLink} target="_blank" rel="noreferrer">Abrir no WhatsApp</a>
                )}
              </div>
            ) : null}
            <FormError message={codeError} />
            <div>
              <button type="button" className="btn btn-secondary" onClick={generate} disabled={generating}>
                {generating ? "Gerando…" : code ? "Gerar outro código" : "Gerar código de vínculo"}
              </button>
            </div>
          </div>
        )}
      </section>

      {link && (
        <section className="card" aria-labelledby="wa-prefs">
          <h2 id="wa-prefs">Preferências</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save.run(new FormData(e.currentTarget));
            }}
          >
            <label className="check">
              <input type="checkbox" name="active" defaultChecked={link.status === "active"} />
              Assistente ativo
              <span className="hint">Desligado, o assistente não responde nem registra nada (pausa a integração).</span>
            </label>
            <label className="check">
              <input type="checkbox" name="allowEntries" defaultChecked={link.allowEntries} />
              Permitir lançamentos por mensagem
              <span className="hint">Desligado, o WhatsApp só responde consultas. Lançamentos sempre pedem confirmação.</span>
            </label>
            <label>
              Conta padrão
              <select name="defaultAccountId" defaultValue={link.defaultAccountId ?? ""}>
                <option value="">Nenhuma (o assistente pergunta)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <span className="hint">Usada quando a mensagem não diz a conta. Transferências sempre precisam de origem e destino.</span>
            </label>
            <FormError message={save.error} />
            <div className="stack-actions">
              <button type="submit" className="btn btn-primary" disabled={save.pending}>{save.pending ? "Salvando…" : "Salvar"}</button>
              <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmUnlink(true)}>Desvincular WhatsApp</button>
            </div>
          </form>
        </section>
      )}

      <section className="card" aria-labelledby="wa-history">
        <h2 id="wa-history">Histórico</h2>
        {messages.length === 0 ? (
          <p className="muted">Nenhuma mensagem ainda.</p>
        ) : (
          <ul className="mini-list">
            {messages.map((m) => (
              <li key={m.id} className="mini-list-block">
                <span className="mini-list-line">
                  <span>{m.body || "—"}</span>
                  <span className={`tag ${m.status === "error" ? "tag-late" : m.status === "processed" ? "tag-ok" : "tag-pending"}`}>{statusLabels[m.status] ?? m.status}</span>
                </span>
                {m.reply && <span className="hint wa-reply">{m.reply}</span>}
                {m.error && <span className="hint hint-error">{m.error}</span>}
                <span className="hint">{new Date(m.receivedAt).toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        title="Desvincular WhatsApp?"
        error={remove.error}
        message="O número deixa de acessar suas finanças. Operações esperando confirmação são canceladas."
      >
        <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => remove.run()}>Desvincular</button>
      </ConfirmDialog>
    </>
  );
}
