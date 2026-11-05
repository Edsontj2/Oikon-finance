"use client";

import { useState, useTransition } from "react";
import { BellRing, Smartphone } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import { sortedCategoryOptions, type CategoryOption } from "@/domain/categories";
import { notificationKindLabel } from "@/domain/bank-notification";
import type { TransactionType } from "@/domain/transactions";
import type { BankNotification } from "@/data/bank-notifications";
import type { Device } from "@/data/devices";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { useOikonApp } from "@/lib/oikon-app";
import { confirmBankNotification, generateDeviceCode, ignoreBankNotification, pauseNotifications, unlinkDevice } from "./actions";
import { ThisPhone } from "./this-phone";

const statusLabel: Record<BankNotification["status"], string> = { pending: "Pendente", confirmed: "Lançada", ignored: "Ignorada", discarded: "Sem movimentação" };

export function NotificationsView({ pending, done, devices, paused, accounts, categories }: {
  pending: BankNotification[]; done: BankNotification[]; devices: Device[]; paused: boolean; accounts: AccountOption[]; categories: CategoryOption[];
}) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [generating, start] = useTransition();
  const unlink = useServerAction(unlinkDevice);
  const pause = useServerAction(pauseNotifications);
  const active = devices.filter((d) => !d.revokedAt);
  const app = useOikonApp();

  return (
    <>
      <div className="page-head"><h1>Notificações do banco</h1></div>

      <section className="card stack" aria-labelledby="celular-title">
        <h2 id="celular-title" className="card-icon-title"><Smartphone size={18} aria-hidden /> {app ? "Este celular" : "App no celular (Android)"}</h2>
        {app ? (
          <ThisPhone app={app} />
        ) : (
          <>
            <p className="muted">
              Instale o app OIKON no Android: é o OIKON completo e, além disso, lê as notificações dos apps de banco que você escolher
              (compra aprovada, Pix enviado ou recebido). Nada é lançado sozinho: cada uma aparece aqui para você confirmar. No iPhone a
              Apple não permite ler notificações de outros apps; use <a href="/importar">Importar extrato</a>.
            </p>
            <ol className="steps">
              <li><a href="https://github.com/Edsontj2/Oikon-finance/releases/latest/download/oikon.apk">Baixe o app (APK)</a> no celular Android e instale (permita &quot;instalar apps desconhecidos&quot; para o navegador).</li>
              <li>Abra o app e entre com seu e-mail e senha.</li>
              <li>Em <strong>Mais → Notificações do banco</strong>, toque em <strong>Ativar neste celular</strong> e permita o acesso às notificações.</li>
            </ol>
            <details>
              <summary>Vincular com código (versão antiga do app)</summary>
              <div className="stack-actions">
                <button type="button" className="btn btn-secondary" disabled={generating} onClick={() => start(async () => setCode(await generateDeviceCode()))}>
                  {code ? "Gerar outro código" : "Gerar código de vínculo"}
                </button>
                {code && (
                  <span className="link-code" data-testid="codigo-celular" aria-live="polite">
                    <strong>{code.code.replace(/(\d{4})(\d{4})/, "$1 $2")}</strong>
                    <span className="hint"> vale 10 minutos, uma vez</span>
                  </span>
                )}
              </div>
            </details>
          </>
        )}
        {active.length > 0 && (
          <ul className="list" aria-label="Celulares vinculados">
            {active.map((d) => (
              <li key={d.id} className="mini-list-line device-row">
                <span>{d.name}<span className="hint"> · vinculado em {formatDate(d.createdAt.slice(0, 10))}{d.lastSeenAt ? ` · último envio ${formatDate(d.lastSeenAt.slice(0, 10))}` : ""}</span></span>
                <button type="button" className="btn btn-sm btn-danger-ghost" disabled={unlink.pending} onClick={() => unlink.run(d.id)}>Desvincular</button>
              </li>
            ))}
          </ul>
        )}
        <label className="check">
          <input type="checkbox" checked={paused} disabled={pause.pending} onChange={(e) => pause.run(e.target.checked)} />
          Pausar a leitura (o celular para de enviar até você reativar)
        </label>
        <FormError message={unlink.error ?? pause.error} />
      </section>

      <section aria-labelledby="pendentes-title">
        <h2 id="pendentes-title" className="list-group-title card-icon-title"><BellRing size={16} aria-hidden /> Aguardando confirmação ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="card empty"><p>Nenhuma notificação para confirmar.</p></div>
        ) : (
          pending.map((n) => <PendingCard key={n.id} n={n} accounts={accounts} categories={categories} />)
        )}
      </section>

      {done.length > 0 && (
        <details className="card">
          <summary>Histórico ({done.length})</summary>
          <ul className="list">
            {done.map((n) => (
              <li key={n.id} className="import-line">
                <span className="mini-list-line"><span>{n.appName ?? n.package} · {formatDate(n.postedAt)}</span><span className="tag">{statusLabel[n.status]}</span></span>
                <span className="hint">{n.title ? `${n.title} — ` : ""}{n.body}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function PendingCard({ n, accounts, categories }: { n: BankNotification; accounts: AccountOption[]; categories: CategoryOption[] }) {
  const s = n.suggestion;
  const [type, setType] = useState<TransactionType>(s.type ?? "expense");
  const [accountId, setAccountId] = useState(s.accountId ?? "");
  const confirm = useServerAction(confirmBankNotification);
  const ignore = useServerAction(ignoreBankNotification);
  const account = accounts.find((a) => a.id === accountId);
  const options = sortedCategoryOptions(categories).filter((c) => c.kind === (type === "income" ? "income" : "expense"));
  return (
    <form className="card stack notification-card" data-testid="notificacao" onSubmit={(e) => { e.preventDefault(); confirm.run(new FormData(e.currentTarget)); }}>
      <input type="hidden" name="id" value={n.id} />
      <div className="mini-list-line">
        <strong>{notificationKindLabel[n.parsed.kind]}{n.parsed.amount ? ` · ${formatMoney(n.parsed.amount)}` : ""}</strong>
        <span className="hint">{n.appName ?? n.package} · {formatDate(n.postedAt)}</span>
      </div>
      <blockquote className="notification-text">{n.title ? <strong>{n.title}: </strong> : null}{n.body}</blockquote>
      {n.similar && <p className="tag tag-pending">Parece já lançado: &quot;{n.similar.description}&quot; em {formatDate(n.similar.date)}</p>}
      {!s.accountSure && <p className="hint">Confira a conta: não deu para saber com certeza{n.parsed.last4 ? ` (cartão final ${n.parsed.last4} não cadastrado)` : ""}.</p>}
      <div className="fields">
        <label>
          Tipo
          <select name="type" value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
            <option value="expense">Saída</option>
            <option value="income">Entrada</option>
            <option value="transfer">Transferência entre minhas contas</option>
          </select>
        </label>
        <label>
          Descrição
          <input name="description" required maxLength={120} defaultValue={s.description} />
        </label>
      </div>
      <div className="fields">
        <MoneyInput name="amount" label="Valor (R$)" required defaultCents={n.parsed.amount} />
        <label>
          Data
          <input name="date" type="date" required defaultValue={n.postedAt} />
        </label>
      </div>
      <div className="fields">
        <label>
          {type === "transfer" ? "De" : "Conta ou cartão"}
          <select name="accountId" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="" disabled>Escolha</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {type === "transfer" ? (
          <label>
            Para
            <select name="toAccountId" required defaultValue="">
              <option value="" disabled>Escolha</option>
              {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ) : (
          <label>
            Categoria
            <select name="categoryId" key={type} defaultValue={s.categoryId ?? ""}>
              <option value="">Sem categoria</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {type === "expense" && account?.type === "credit_card" && (
        <label>
          Parcelas
          <input name="installments" type="number" inputMode="numeric" min={1} max={60} defaultValue={s.installments ?? 1} />
          <span className="hint">O valor informado é o total da compra.</span>
        </label>
      )}
      <FormError message={confirm.error ?? ignore.error} />
      <div className="stack-actions">
        <button type="submit" className="btn btn-primary" disabled={confirm.pending}>{confirm.pending ? "Lançando…" : "Confirmar e lançar"}</button>
        <button type="button" className="btn btn-secondary" disabled={ignore.pending} onClick={() => ignore.run(n.id)}>Ignorar</button>
      </div>
    </form>
  );
}
