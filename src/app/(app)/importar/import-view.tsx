"use client";

import { useState, useTransition } from "react";
import { FileUp, History } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import { sortedCategoryOptions, type CategoryOption } from "@/domain/categories";
import { MAX_STATEMENT_BYTES, parseStatement } from "@/domain/statement";
import type { ImportPreviewLine } from "@/data/statement-import";
import { formatDate } from "@/lib/dates";
import { Money } from "@/components/money";
import { FormError } from "@/components/form-error";
import { useToast } from "@/components/toast";
import { importStatement, previewStatement, undoStatementImport } from "./actions";
import type { StatementImport } from "@/data/statement-import";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";

type Action = "create" | "reconcile" | "skip";
type Row = ImportPreviewLine & { action: Action; chosenCategory: string };

const statusLabel: Record<ImportPreviewLine["status"], string> = {
  new: "Novo",
  pending: "Confirma um pendente",
  duplicate: "Já lançado",
  imported: "Já importado",
};

/** Lê o arquivo como UTF-8; se não for, como Latin-1 (comum em extratos de bancos brasileiros). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

export function ImportView({ accounts, categories, defaultAccountId, imports }: { accounts: AccountOption[]; categories: CategoryOption[]; defaultAccountId: string; imports: StatementImport[] }) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const account = accounts.find((a) => a.id === accountId);
  const [positiveIsExpense, setPositiveIsExpense] = useState(account?.type === "credit_card");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const options = sortedCategoryOptions(categories);

  const onFile = (file: File | undefined) => {
    setError(null);
    setRows(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_STATEMENT_BYTES) return setError("Arquivo grande demais (máximo 1 MB). Exporte um período menor.");
    if (/\.xlsx?$/i.test(file.name)) return setError("Planilha do Excel: abra no Excel ou no Google Planilhas e salve como CSV.");
    start(async () => {
      const parsed = parseStatement(await readText(file), positiveIsExpense);
      if (!parsed.lines.length) return setError(parsed.errors[0] ?? "Não encontrei lançamentos no arquivo.");
      const result = await previewStatement(accountId, parsed.lines);
      if (!result.ok) return setError(result.message);
      setNotes([
        `${parsed.format.toUpperCase()}: ${parsed.lines.length} lançamentos lidos.`,
        ...(parsed.skipped ? [`${parsed.skipped} linhas de saldo ou valor zero ignoradas.`] : []),
        ...parsed.errors.slice(0, 5),
      ]);
      setRows(
        result.lines.map((l) => ({
          ...l,
          action: l.status === "new" ? "create" : l.status === "pending" ? "reconcile" : "skip",
          chosenCategory: l.categoryId ?? "",
        })),
      );
    });
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toCreate = rows?.filter((r) => r.action === "create") ?? [];
  const toReconcile = rows?.filter((r) => r.action === "reconcile") ?? [];

  const confirm = () =>
    start(async () => {
      if (!rows) return;
      const result = await importStatement(
        accountId,
        rows.map((r) => ({ ref: r.ref, date: r.date, description: r.description, amount: r.amount, type: r.type, action: r.action, matchId: r.match?.id ?? null, categoryId: r.chosenCategory || null })),
        fileName,
      );
      if (!result.ok) return setError(result.message);
      toast(result.message);
      setRows(null);
      setNotes([]);
    });

  return (
    <>
      <div className="page-head"><h1>Importar extrato</h1></div>
      <section className="card stack">
        <p className="muted">
          Envie o extrato do banco em <strong>OFX</strong> (o mais confiável) ou <strong>CSV</strong>. Antes de gravar, mostramos o que é novo, o que já está
          lançado e o que confirma um pendente. Importar o mesmo arquivo de novo não duplica nada.
        </p>
        <div className="fields">
          <label>
            Conta do extrato
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setRows(null); setPositiveIsExpense(accounts.find((a) => a.id === e.target.value)?.type === "credit_card"); }}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            Arquivo (.ofx ou .csv)
            <input type="file" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" disabled={pending || !accountId} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={positiveIsExpense} onChange={(e) => setPositiveIsExpense(e.target.checked)} />
          No CSV, gastos aparecem com valor positivo (comum em faturas de cartão)
        </label>
        {pending && <p className="muted">Lendo o extrato…</p>}
        <FormError message={error} />
        {notes.length > 0 && <ul className="hint">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </section>

      {rows && (
        <section className="card" aria-labelledby="previa-title">
          <h2 id="previa-title" className="card-icon-title"><FileUp size={18} aria-hidden /> Conferir antes de gravar</h2>
          <ul className="list">
            {rows.map((r, i) => (
              <li key={r.ref} className="import-line" data-testid="linha-extrato">
                <div className="mini-list-line">
                  <span>
                    <strong>{r.description}</strong>
                    <span className="hint"> {formatDate(r.date)} · <span className={`tag ${r.status === "new" ? "tag-ok" : r.status === "pending" ? "tag-pending" : ""}`}>{statusLabel[r.status]}</span></span>
                  </span>
                  <Money cents={r.type === "income" ? r.amount : -r.amount} signed />
                </div>
                {r.match && <span className="hint">Lançado como &quot;{r.match.description}&quot; em {formatDate(r.match.date)}</span>}
                <div className="fields">
                  <select aria-label={`O que fazer com ${r.description}`} value={r.action} onChange={(e) => update(i, { action: e.target.value as Action })}>
                    {r.status === "pending" && <option value="reconcile">Marcar o pendente como pago</option>}
                    {r.status !== "imported" && <option value="create">{r.status === "new" ? "Lançar" : "Lançar mesmo assim"}</option>}
                    <option value="skip">Ignorar</option>
                  </select>
                  {r.action === "create" && (
                    <select aria-label={`Categoria de ${r.description}`} value={r.chosenCategory} onChange={(e) => update(i, { chosenCategory: e.target.value })}>
                      <option value="">Sem categoria</option>
                      {options.filter((c) => c.kind === r.type).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="modal-actions import-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setRows(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={pending || toCreate.length + toReconcile.length === 0} onClick={confirm}>
              {pending ? "Gravando…" : `Gravar (${toCreate.length} novos, ${toReconcile.length} a conciliar)`}
            </button>
          </div>
        </section>
      )}
      <ImportHistory imports={imports} />
    </>
  );
}

/** Importações feitas: dá para desfazer uma inteira (apaga o que criou e devolve os conciliados). */
function ImportHistory({ imports }: { imports: StatementImport[] }) {
  const [undoing, setUndoing] = useState<StatementImport | null>(null);
  const undo = useServerAction(undoStatementImport, () => setUndoing(null));
  if (!imports.length) return null;
  return (
    <section className="card stack" aria-labelledby="importacoes-title">
      <h2 id="importacoes-title" className="card-icon-title"><History size={18} aria-hidden /> Importações feitas</h2>
      <ul className="list">
        {imports.map((i) => (
          <li key={i.id} className="mini-list-line device-row" data-testid="importacao">
            <span>
              {i.fileName ?? "Extrato"} · {i.accountName}
              <span className="hint">
                {" "}· {formatDate(i.createdAt.slice(0, 10))} · {i.created} lançado{i.created === 1 ? "" : "s"}
                {i.reconciled ? `, ${i.reconciled} conciliado${i.reconciled === 1 ? "" : "s"}` : ""}
              </span>
            </span>
            {i.undoneAt ? (
              <span className="tag">Desfeita</span>
            ) : (
              <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setUndoing(i)}>Desfazer</button>
            )}
          </li>
        ))}
      </ul>
      <p className="hint">Importações feitas antes desta opção existir não aparecem aqui; os lançamentos delas podem ser excluídos em Lançamentos → Selecionar.</p>
      <ConfirmDialog
        open={undoing !== null}
        onClose={() => setUndoing(null)}
        title="Desfazer esta importação?"
        message={undoing ? `${undoing.created} lançamento${undoing.created === 1 ? "" : "s"} criado${undoing.created === 1 ? "" : "s"} pelo extrato ${undoing.created === 1 ? "será excluído" : "serão excluídos"}${undoing.reconciled ? ` e ${undoing.reconciled} conciliado${undoing.reconciled === 1 ? "" : "s"} ${undoing.reconciled === 1 ? "volta" : "voltam"} a ser como eram antes` : ""}. Os saldos voltam ao que eram antes da importação.` : ""}
        error={undo.error}
      >
        <button type="button" className="btn btn-danger" disabled={undo.pending} onClick={() => undoing && undo.run(undoing.id)}>
          {undo.pending ? "Desfazendo…" : "Desfazer importação"}
        </button>
      </ConfirmDialog>
    </section>
  );
}
