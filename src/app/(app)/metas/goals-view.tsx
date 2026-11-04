"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ShieldCheck, Target } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import { emergencyTarget, goalKinds, goalStatusLabel, type GoalKind } from "@/domain/goals";
import type { Goal } from "@/data/goals";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { LIMITS } from "@/domain/limits";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { moveSaved, removeGoal, saveGoal } from "./actions";

type Editing = { goal?: Goal; kind: GoalKind };

export function GoalsView({ goals, accounts, averageExpense, today }: { goals: Goal[]; accounts: AccountOption[]; averageExpense: number; today: string }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [moving, setMoving] = useState<{ goal: Goal; direction: "in" | "out" } | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const remove = useServerAction(removeGoal, () => setDeleting(null));
  const hasEmergency = goals.some((g) => g.kind === "emergency");
  const suggested = emergencyTarget(averageExpense, 6);

  return (
    <>
      <div className="page-head">
        <h1>Metas</h1>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: "goal" })}>
          <Plus size={18} aria-hidden /> Nova meta
        </button>
      </div>

      {!hasEmergency && (
        <section className="card goal-card">
          <h2 className="card-icon-title"><ShieldCheck size={18} aria-hidden /> Reserva de emergência</h2>
          <p className="muted">
            Dinheiro guardado para imprevistos (perda de renda, saúde, conserto). O costume é juntar de 3 a 6 meses de gastos.
            {averageExpense > 0 ? (
              <> Você gasta em média {formatMoney(averageExpense)} por mês: 6 meses dão {formatMoney(suggested)}.</>
            ) : (
              <> Quando houver alguns meses de lançamentos, sugerimos um valor.</>
            )}
          </p>
          <div className="goal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing({ kind: "emergency" })}>Criar reserva de emergência</button>
          </div>
        </section>
      )}

      {goals.length === 0 ? (
        <div className="card empty">
          <p>Nenhuma meta ainda.</p>
          <p className="muted">Ex.: viagem, entrada de um imóvel, trocar de carro. Diga quanto e até quando: mostramos quanto guardar por mês.</p>
        </div>
      ) : (
        <div className="grid grid-2">
          {goals.map((g) => (
            <section key={g.id} className="card goal-card" data-testid="meta">
              <div className="goal-head">
                <div>
                  <h2 className="card-icon-title">{g.kind === "emergency" ? <ShieldCheck size={18} aria-hidden /> : <Target size={18} aria-hidden />} {g.name}</h2>
                  <span className="hint">
                    {goalKinds[g.kind]}
                    {g.kind === "emergency" && g.months && <> · {g.months} meses de gastos</>}
                    {g.targetDate && <> · até {formatDate(g.targetDate)}</>}
                  </span>
                </div>
                <span className={`tag ${g.progress.status === "done" || g.progress.status === "on_track" ? "tag-ok" : g.progress.status === "behind" || g.progress.status === "late" ? "tag-late" : ""}`}>
                  {goalStatusLabel[g.progress.status]}
                </span>
              </div>
              <div className="mini-list-line">
                <span><Money cents={g.progress.saved} testId={`meta-guardado-${g.name}`} /> <span className="muted">de <Money cents={g.target} /></span></span>
                <strong>{g.progress.percent}%</strong>
              </div>
              <span className="progress" aria-hidden><span style={{ width: `${g.progress.percent}%` }} /></span>
              <span className="hint">
                {g.progress.status === "done" ? (
                  "Meta alcançada."
                ) : (
                  <>
                    Faltam {formatMoney(g.progress.remaining)}
                    {g.progress.monthlyNeeded !== null && g.progress.status !== "late" && (
                      <> · guarde {formatMoney(g.progress.monthlyNeeded)} por mês ({g.progress.monthsLeft} {g.progress.monthsLeft === 1 ? "mês" : "meses"})</>
                    )}
                    {g.progress.status === "late" && <> · o prazo passou: escolha uma nova data</>}
                  </>
                )}
              </span>
              <span className="hint">
                {g.accountId ? <>Acompanha o saldo de <Link href={`/contas/${g.accountId}`}>{g.accountName}</Link>.</> : "Valor guardado anotado à mão (não mexe no saldo das contas)."}
                {g.kind === "emergency" && averageExpense > 0 && g.months && emergencyTarget(averageExpense, g.months) !== g.target && (
                  <> Com seus gastos atuais, {g.months} meses dão {formatMoney(emergencyTarget(averageExpense, g.months))}.</>
                )}
              </span>
              <div className="goal-actions">
                {!g.accountId && (
                  <>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMoving({ goal: g, direction: "in" })}>Guardar</button>
                    {g.manualSaved > 0 && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setMoving({ goal: g, direction: "out" })}>Retirar</button>}
                  </>
                )}
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing({ goal: g, kind: g.kind })}>Editar</button>
                <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => { remove.setError(null); setDeleting(g); }}>Excluir</button>
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.goal ? "Editar meta" : editing?.kind === "emergency" ? "Reserva de emergência" : "Nova meta"}>
        {editing && <GoalForm editing={editing} accounts={accounts} averageExpense={averageExpense} today={today} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving?.direction === "out" ? "Retirar da meta" : "Guardar na meta"}>
        {moving && <MoveForm goal={moving.goal} direction={moving.direction} onDone={() => setMoving(null)} />}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Excluir meta?"
        error={remove.error}
        message={deleting && <>A meta <strong>{deleting.name}</strong> será apagada. Contas e lançamentos não mudam.</>}
      >
        <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => deleting && remove.run(deleting.id)}>Excluir</button>
      </ConfirmDialog>
    </>
  );
}

function GoalForm({ editing, accounts, averageExpense, today, onDone }: { editing: Editing; accounts: AccountOption[]; averageExpense: number; today: string; onDone: () => void }) {
  const [submissionKey] = useState(() => crypto.randomUUID());
  const { goal, kind } = editing;
  const [months, setMonths] = useState(goal?.months ?? 6);
  const { run, pending, error } = useServerAction(saveGoal, onDone);
  const suggested = averageExpense > 0 ? emergencyTarget(averageExpense, months) : null;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(new FormData(e.currentTarget)); }}>
      {goal ? <input type="hidden" name="id" value={goal.id} /> : <input type="hidden" name="submissionKey" value={submissionKey} />}
      <input type="hidden" name="kind" value={kind} />
      <label>
        Nome
        <input name="name" required maxLength={LIMITS.accountName} defaultValue={goal?.name ?? (kind === "emergency" ? "Reserva de emergência" : "")} placeholder="Ex.: Viagem de férias" autoComplete="off" />
      </label>
      {kind === "emergency" && (
        <label>
          Quantos meses de gastos?
          <input name="months" type="number" inputMode="numeric" min={1} max={24} value={months} onChange={(e) => setMonths(Number(e.target.value) || 1)} />
          <span className="hint">{suggested ? `Com seu gasto médio (${formatMoney(averageExpense)}/mês), ${months} meses dão ${formatMoney(suggested)}.` : "Sem histórico de gastos ainda: informe o valor."}</span>
        </label>
      )}
      <MoneyInput key={kind === "emergency" && !goal ? `t-${suggested}` : "t"} name="target" label="Quanto quer juntar (R$)" required defaultCents={goal?.target ?? (kind === "emergency" ? suggested : null)} />
      <label>
        Até quando? (opcional)
        <input name="targetDate" type="date" min={today} defaultValue={goal?.targetDate ?? ""} />
        <span className="hint">Com data, mostramos quanto guardar por mês.</span>
      </label>
      <label>
        Onde o dinheiro fica guardado? (opcional)
        <select name="accountId" defaultValue={goal?.accountId ?? ""}>
          <option value="">Vou anotar à mão quanto já guardei</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className="hint">Escolhendo uma conta (poupança, investimento), o progresso acompanha o saldo dela.</span>
      </label>
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : goal ? "Salvar alterações" : "Criar meta"}</button>
      </div>
    </form>
  );
}

function MoveForm({ goal, direction, onDone }: { goal: Goal; direction: "in" | "out"; onDone: () => void }) {
  const { run, pending, error } = useServerAction(moveSaved, onDone);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(new FormData(e.currentTarget)); }}>
      <input type="hidden" name="goalId" value={goal.id} />
      <input type="hidden" name="direction" value={direction} />
      <MoneyInput name="amount" label="Valor (R$)" required hint={direction === "out" ? `Guardado: ${formatMoney(goal.manualSaved)}.` : "Só anota na meta: lance o dinheiro na conta onde ele está, se quiser que o saldo mude."} />
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : direction === "out" ? "Retirar" : "Guardar"}</button>
      </div>
    </form>
  );
}
