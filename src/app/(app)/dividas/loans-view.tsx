"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calculator, Plus } from "lucide-react";
import type { AccountOption } from "@/domain/accounts";
import { amortizationSystems, loanInputError, loanSchedule, type AmortizationSystem } from "@/domain/loans";
import type { Loan } from "@/data/loans";
import { addMonths, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { payOffLoan, removeLoan, saveLoan } from "./actions";

type Sim = { principal: number | null; rate: string; count: string; system: AmortizationSystem; firstDue: string };

function parseRate(text: string): number {
  const t = text.trim().replace(",", ".");
  return /^\d{1,2}(\.\d{1,4})?$/.test(t) ? Number(t) : Number.NaN;
}

export function LoansView({ loans, accounts, today }: { loans: Loan[]; accounts: AccountOption[]; today: string }) {
  const [sim, setSim] = useState<Sim>({ principal: null, rate: "", count: "12", system: "price", firstDue: addMonths(today, 1) });
  const [registering, setRegistering] = useState(false);
  const [settling, setSettling] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState<Loan | null>(null);
  const remove = useServerAction(removeLoan, () => setDeleting(null));

  const open = loans.filter((l) => !l.settledAt);
  const owe = open.filter((l) => l.kind === "borrowed").reduce((s, l) => s + Math.max(0, -l.balance), 0);
  const toReceive = open.filter((l) => l.kind === "lent").reduce((s, l) => s + Math.max(0, l.balance), 0);
  const thisMonth = open.filter((l) => l.kind === "borrowed" && l.next && l.next.date.slice(0, 7) <= today.slice(0, 7)).reduce((s, l) => s + l.next!.amount, 0);

  return (
    <>
      <div className="page-head">
        <h1>Dívidas e empréstimos</h1>
        <button type="button" className="btn btn-primary" onClick={() => setRegistering(true)}>
          <Plus size={18} aria-hidden /> Registrar empréstimo
        </button>
      </div>

      <div className="summary card">
        <div><span className="label">Devo (com juros até hoje)</span><Money cents={owe} testId="dividas-devo" /></div>
        <div><span className="label">Parcelas deste mês</span><Money cents={thisMonth} /></div>
        {toReceive > 0 && <div><span className="label">A receber de empréstimos</span><Money cents={toReceive} /></div>}
      </div>

      {loans.length === 0 ? (
        <div className="card empty"><p>Nenhum empréstimo ou dívida registrado.</p><p className="muted">Use o simulador abaixo antes de contratar.</p></div>
      ) : (
        <ul className="list card">
          {loans.map((l) => (
            <li key={l.id} id={l.id} className="row" data-testid="emprestimo">
              <div className="row-main loan-row">
                <span className="row-text">
                  <span className="row-title">
                    {l.name} {l.settledAt ? <span className="tag tag-ok">Quitado</span> : l.overdueCount > 0 ? <span className="tag tag-late">{l.overdueCount} atrasada{l.overdueCount > 1 ? "s" : ""}</span> : null}
                  </span>
                  <span className="row-sub">
                    {l.kind === "borrowed" ? "Peguei" : "Emprestei"} {formatMoney(l.principal)} · {String(l.monthlyRate).replace(".", ",")}% a.m. ({String(l.schedule.yearlyRate).replace(".", ",")}% a.a.) · {amortizationSystems[l.system]}
                  </span>
                  <span className="progress" aria-hidden><span style={{ width: `${Math.round((l.paidCount / l.installments) * 100)}%` }} /></span>
                  <span className="hint">
                    {l.paidCount}/{l.installments} parcelas pagas
                    {l.next && <> · próxima {formatDate(l.next.date)}: {formatMoney(l.next.amount)}</>}
                    {!l.settledAt && <> · quitar hoje ≈ {formatMoney(l.payoff.remainingPrincipal)} (economiza ≈ {formatMoney(l.payoff.interestSaved)} de juros)</>}
                  </span>
                  <details className="loan-schedule">
                    <summary>Ver parcelas · total {formatMoney(l.schedule.totalPaid)} ({formatMoney(l.schedule.totalInterest)} de juros)</summary>
                    <ScheduleTable schedule={l.schedule.installments} paidCount={l.paidCount} />
                  </details>
                  <span className="stack-actions">
                    {!l.settledAt && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSettling(l)}>Quitar</button>}
                    <Link className="btn btn-sm btn-secondary" href={`/lancamentos?conta=${l.accountId}`}>Lançamentos</Link>
                    <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => { remove.setError(null); setDeleting(l); }}>Excluir</button>
                  </span>
                </span>
                <span className="row-value"><Money cents={l.balance} testId={`emprestimo-saldo-${l.name}`} /></span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Simulator sim={sim} setSim={setSim} onRegister={() => setRegistering(true)} />

      <p className="hint page-hint">
        Parcelas pagas são transferências da conta pagadora para o empréstimo (não contam como gasto de novo). Os juros de cada
        parcela entram como gasto na data do vencimento. As parcelas pendentes aparecem na Agenda.
      </p>

      <Modal open={registering} onClose={() => setRegistering(false)} title="Registrar empréstimo">
        <LoanForm sim={sim} accounts={accounts} today={today} onDone={() => setRegistering(false)} />
      </Modal>

      <Modal open={settling !== null} onClose={() => setSettling(null)} title={`Quitar ${settling?.name ?? ""}`}>
        {settling && <SettleForm loan={settling} today={today} onDone={() => setSettling(null)} />}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Excluir empréstimo?"
        error={remove.error}
        message={deleting && <>O empréstimo <strong>{deleting.name}</strong>, a conta dele e todas as parcelas registradas (inclusive as pagas) serão apagados.</>}
      >
        {deleting && <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => remove.run(deleting.id)}>Excluir</button>}
      </ConfirmDialog>
    </>
  );
}

function ScheduleTable({ schedule, paidCount }: { schedule: Loan["schedule"]["installments"]; paidCount: number }) {
  return (
    <div className="table-scroll">
      <table className="chart-table loan-table">
        <thead><tr><th>#</th><th>Vencimento</th><th>Parcela</th><th>Juros</th><th>Amortização</th><th>Saldo</th></tr></thead>
        <tbody>
          {schedule.map((p) => (
            <tr key={p.number} className={p.number <= paidCount ? "muted" : undefined}>
              <td>{p.number}</td><td>{formatDate(p.date)}</td><td>{formatMoney(p.amount)}</td><td>{formatMoney(p.interest)}</td><td>{formatMoney(p.principal)}</td><td>{formatMoney(p.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Simulator({ sim, setSim, onRegister }: { sim: Sim; setSim: (s: Sim) => void; onRegister: () => void }) {
  const rate = parseRate(sim.rate);
  const count = /^\d{1,3}$/.test(sim.count) ? Number(sim.count) : Number.NaN;
  const error = sim.principal === null || !sim.rate ? null : loanInputError(sim.principal, rate, count);
  const result = useMemo(() => {
    if (sim.principal === null || !sim.rate || error) return null;
    return { price: loanSchedule(sim.principal, rate, count, sim.firstDue, "price"), sac: loanSchedule(sim.principal, rate, count, sim.firstDue, "sac") };
  }, [sim, rate, count, error]);
  const chosen = result?.[sim.system];

  return (
    <section className="card" aria-labelledby="sim-title">
      <h2 id="sim-title" className="card-icon-title"><Calculator size={18} aria-hidden /> Simulador</h2>
      <div className="fields">
        <MoneyInput name="simPrincipal" label="Valor (R$)" onCentsChange={(c) => setSim({ ...sim, principal: c })} />
        <label>Juros ao mês (%)<input inputMode="decimal" value={sim.rate} onChange={(e) => setSim({ ...sim, rate: e.target.value })} placeholder="Ex.: 1,99" /></label>
        <label>Parcelas<input inputMode="numeric" value={sim.count} onChange={(e) => setSim({ ...sim, count: e.target.value })} /></label>
        <label>Primeira parcela<input type="date" value={sim.firstDue} onChange={(e) => setSim({ ...sim, firstDue: e.target.value })} /></label>
      </div>
      <FormError message={error} />
      {result && chosen && (
        <>
          <div className="metrics metrics-3" data-testid="simulacao">
            <div className="metric"><span className="label">Price: parcela</span><Money cents={result.price.installments[0].amount} /><span className="hint">total {formatMoney(result.price.totalPaid)}</span></div>
            <div className="metric"><span className="label">SAC: 1ª → última</span><span className="metric-value">{formatMoney(result.sac.installments[0].amount)} → {formatMoney(result.sac.installments.at(-1)!.amount)}</span><span className="hint">total {formatMoney(result.sac.totalPaid)}</span></div>
            <div className="metric"><span className="label">Juros ({sim.system === "price" ? "Price" : "SAC"})</span><Money cents={chosen.totalInterest} /><span className="hint">{String(chosen.yearlyRate).replace(".", ",")}% ao ano</span></div>
          </div>
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Tipo de parcela">
            {(["price", "sac"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sim.system === s} className={`segment ${sim.system === s ? "active" : ""}`} onClick={() => setSim({ ...sim, system: s })}>
                {amortizationSystems[s]}
              </button>
            ))}
          </div>
          <p className="hint">
            SAC paga {formatMoney(result.price.totalInterest - result.sac.totalInterest)} a menos de juros, mas começa com parcela maior.
            É uma estimativa: o contrato pode ter tarifas, seguro e IOF (o custo efetivo total, CET, vem no contrato).
          </p>
          <details className="loan-schedule">
            <summary>Ver todas as parcelas</summary>
            <ScheduleTable schedule={chosen.installments} paidCount={0} />
          </details>
          <div className="stack-actions"><button type="button" className="btn btn-secondary" onClick={onRegister}>Registrar com estes dados</button></div>
        </>
      )}
    </section>
  );
}

function LoanForm({ sim, accounts, today, onDone }: { sim: Sim; accounts: AccountOption[]; today: string; onDone: () => void }) {
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<"borrowed" | "lent">("borrowed");
  const { run, pending, error } = useServerAction(saveLoan, onDone);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(new FormData(e.currentTarget)); }}>
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="kind" value={kind} />
      <div className="segmented" role="radiogroup" aria-label="Tipo">
        {(["borrowed", "lent"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`segment ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
            {k === "borrowed" ? "Peguei emprestado" : "Emprestei"}
          </button>
        ))}
      </div>
      <label>Nome<input name="name" required maxLength={60} placeholder={kind === "borrowed" ? "Ex.: Consignado Banco X" : "Ex.: Empréstimo para o João"} /></label>
      <div className="fields">
        <MoneyInput name="principal" label="Valor emprestado (R$)" required defaultCents={sim.principal} />
        <label>Juros ao mês (%)<input name="monthlyRate" inputMode="decimal" required defaultValue={sim.rate} placeholder="0 se não tem juros" /></label>
        <label>Parcelas<input name="installments" inputMode="numeric" required defaultValue={sim.count} /></label>
        <label>
          Tipo de parcela
          <select name="system" defaultValue={sim.system}>
            {(["price", "sac"] as const).map((s) => <option key={s} value={s}>{amortizationSystems[s]}</option>)}
          </select>
        </label>
        <label>Liberação do dinheiro<input type="date" name="startDate" defaultValue={today} required /></label>
        <label>Primeira parcela<input type="date" name="firstDue" defaultValue={sim.firstDue} required /></label>
      </div>
      <label>
        {kind === "borrowed" ? "Conta que paga as parcelas" : "Conta que recebe as parcelas"}
        <select name="payerAccountId" required defaultValue={accounts[0]?.id}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>
        {kind === "borrowed" ? "O dinheiro caiu em" : "O dinheiro saiu de"}
        <select name="disbursementAccountId" defaultValue="">
          <option value="">{kind === "borrowed" ? "Não registrar (dívida que já existia)" : "Não registrar"}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <p className="hint">As parcelas são calculadas com a taxa informada. Confira com o contrato: se o valor da parcela do banco for outro, ajuste a taxa.</p>
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : "Registrar"}</button>
      </div>
    </form>
  );
}

function SettleForm({ loan, today, onDone }: { loan: Loan; today: string; onDone: () => void }) {
  const [submissionKey] = useState(() => crypto.randomUUID());
  const { run, pending, error } = useServerAction(payOffLoan, onDone);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(new FormData(e.currentTarget)); }}>
      <input type="hidden" name="loanId" value={loan.id} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <p className="muted">
        Estimativa de quitação hoje: {formatMoney(loan.payoff.remainingPrincipal)} (sem os {formatMoney(loan.payoff.interestSaved)} de juros futuros).
        Use o valor que o {loan.kind === "borrowed" ? "banco informou" : "combinado"}.
      </p>
      <MoneyInput name="amount" label="Valor da quitação (R$)" required defaultCents={loan.payoff.remainingPrincipal || null} />
      <label>Data<input type="date" name="date" defaultValue={today} max={today} required /></label>
      <p className="hint">As parcelas futuras são apagadas. Diferença para o saldo devedor vira encargo (pagou mais) ou ajuste de desconto.</p>
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Salvando…" : "Registrar quitação"}</button>
      </div>
    </form>
  );
}


