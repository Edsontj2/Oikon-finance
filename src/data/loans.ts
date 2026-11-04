/**
 * Empréstimos e dívidas (migração 0009). Um empréstimo é uma conta do tipo "loan":
 *
 * - "borrowed" (peguei emprestado): a conta começa devendo o valor (saldo negativo). Se o dinheiro
 *   caiu numa conta, é uma transferência do empréstimo para ela. Cada parcela é uma transferência
 *   pendente da conta pagadora para o empréstimo; os juros da parcela são uma saída na conta do
 *   empréstimo na data do vencimento (é o custo real, aparece nos relatórios).
 * - "lent" (emprestei): o contrário; os juros são uma entrada.
 *
 * Tudo é gravado num único comando SQL (ou grava tudo, ou nada) e cada linha passa pela auditoria.
 */
import { num, type Db } from "@/lib/db";
import { isValidDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { LIMITS, TOO_BIG, isValidCents, requiredText } from "@/domain/limits";
import { isAmortizationSystem, loanInputError, loanSchedule, payoffEstimate, type AmortizationSystem, type LoanSchedule } from "@/domain/loans";
import { UserError, assertUuid, isUuid, pgCode, submissionKey } from "./errors";

export type LoanKind = "borrowed" | "lent";
export const loanKinds: Record<LoanKind, string> = { borrowed: "Peguei emprestado", lent: "Emprestei" };

export type NewLoan = {
  name: string;
  kind: LoanKind;
  /** Valor emprestado, em centavos. */
  principal: number;
  /** Taxa de juros ao mês, em % (ex.: 1.99). */
  monthlyRate: number;
  installments: number;
  system: AmortizationSystem;
  /** Vencimento da primeira parcela. */
  firstDue: string;
  /** Data em que o dinheiro foi liberado (padrão: hoje). */
  startDate?: string;
  /** Conta que paga (ou recebe, se emprestei) as parcelas. */
  payerAccountId: string;
  /** Conta onde o dinheiro caiu (ou de onde saiu, se emprestei). Vazio = dívida que já existia. */
  disbursementAccountId?: string | null;
  submissionKey?: string | null;
};

type Row = {
  type: "income" | "expense" | "transfer";
  description: string;
  amount: number;
  date: string;
  paid: boolean;
  /** Quem é a conta de origem/destino: o empréstimo, a pagadora ou a da liberação. */
  from: "loan" | "payer" | "disb";
  to: "loan" | "payer" | "disb" | null;
  part: "disbursement" | "installment" | "interest" | "payoff" | "payoff_fee";
  number: number | null;
};

async function ownedMoneyAccount(db: Db, userId: string, id: string, label: string) {
  assertUuid(id, `${label} não encontrada.`);
  const { rows } = await db.query<{ type: string; archived: boolean }>("SELECT type, archived FROM accounts WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!rows[0] || rows[0].archived) throw new UserError(`${label} não encontrada.`);
  if (rows[0].type === "loan") throw new UserError(`${label}: escolha uma conta, não outro empréstimo.`);
}

/** Formulário já enviado com esta chave (duplo clique, reenvio): não faz nada de novo. */
async function alreadySubmitted(db: Db, userId: string, key: string | null): Promise<boolean> {
  if (!key) return false;
  const { rows } = await db.query("SELECT 1 FROM form_submissions WHERE user_id = $1 AND key = $2", [userId, key]);
  return rows.length > 0;
}

export async function createLoan(db: Db, userId: string, input: NewLoan, now = new Date()): Promise<string | null> {
  if (await alreadySubmitted(db, userId, submissionKey(input.submissionKey))) return null;
  const name = requiredText(input.name, LIMITS.accountName, "Dê um nome ao empréstimo.", "O nome");
  if (input.kind !== "borrowed" && input.kind !== "lent") throw new UserError("Escolha se pegou ou deu o empréstimo.");
  if (!isAmortizationSystem(input.system)) throw new UserError("Escolha o tipo de parcela (Price ou SAC).");
  const error = loanInputError(input.principal, input.monthlyRate, input.installments);
  if (error) throw new UserError(error);
  if (!isValidCents(input.principal)) throw new UserError(TOO_BIG);
  if (!isValidDate(input.firstDue)) throw new UserError("Data da primeira parcela inválida.");
  const startDate = input.startDate || today(now);
  if (!isValidDate(startDate)) throw new UserError("Data da liberação inválida.");
  if (input.firstDue < startDate) throw new UserError("A primeira parcela não pode vencer antes da liberação do dinheiro.");
  await ownedMoneyAccount(db, userId, input.payerAccountId, "Conta pagadora");
  const disb = input.disbursementAccountId || null;
  if (disb) await ownedMoneyAccount(db, userId, disb, "Conta da liberação");
  const dup = await db.query("SELECT 1 FROM accounts WHERE user_id = $1 AND lower(name) = lower($2)", [userId, name]);
  if (dup.rows.length) throw new UserError("Você já tem uma conta com esse nome. Dê outro nome ao empréstimo.");

  const schedule = loanSchedule(input.principal, input.monthlyRate, input.installments, input.firstDue, input.system);
  if (schedule.installments.some((p) => !isValidCents(p.amount))) throw new UserError(TOO_BIG);
  const borrowed = input.kind === "borrowed";
  const rows: Row[] = [];
  if (disb) {
    rows.push({
      type: "transfer",
      description: borrowed ? `Liberação do empréstimo ${name}` : `Empréstimo concedido: ${name}`,
      amount: input.principal,
      date: startDate,
      paid: startDate <= today(now),
      from: borrowed ? "loan" : "disb",
      to: borrowed ? "disb" : "loan",
      part: "disbursement",
      number: 0,
    });
  }
  const n = input.installments;
  for (const p of schedule.installments) {
    rows.push({
      type: "transfer",
      description: `Parcela ${p.number}/${n} · ${name}`,
      amount: p.amount,
      date: p.date,
      paid: false,
      from: borrowed ? "payer" : "loan",
      to: borrowed ? "loan" : "payer",
      part: "installment",
      number: p.number,
    });
    if (p.interest > 0) {
      // Juros entram (como custo ou ganho) na data do vencimento, pagos ou não.
      rows.push({ type: borrowed ? "expense" : "income", description: `Juros ${p.number}/${n} · ${name}`, amount: p.interest, date: p.date, paid: true, from: "loan", to: null, part: "interest", number: p.number });
    }
  }
  // Sem liberação registrada: a conta já começa com a dívida (ou o valor a receber).
  const initial = disb ? 0 : borrowed ? -input.principal : input.principal;
  const key = submissionKey(input.submissionKey);

  try {
    const { rows: out } = await db.query<{ id: string }>(
      `WITH claim AS (
         INSERT INTO form_submissions (user_id, key) SELECT $1, $2::uuid WHERE $2::uuid IS NOT NULL ON CONFLICT DO NOTHING RETURNING 1
       ), acc AS (
         INSERT INTO accounts (user_id, name, type, initial_balance_cents, icon)
         SELECT $1, $3, 'loan', $4, 'building' WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM claim)
         RETURNING id
       ), ln AS (
         INSERT INTO loans (user_id, account_id, payer_account_id, kind, principal_cents, monthly_rate, system, installments, first_due, start_date)
         SELECT $1, acc.id, $5, $6, $7, $8, $9, $10, $11, $12 FROM acc
         RETURNING id, account_id
       ), tx AS (
         INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id, to_account_id, loan_id, loan_part, loan_installment)
         SELECT $1, r.type, r.description, r.amount, r.date, r.paid,
                CASE r.src WHEN 'loan' THEN ln.account_id WHEN 'payer' THEN $5::uuid ELSE $13::uuid END,
                CASE r.dst WHEN 'loan' THEN ln.account_id WHEN 'payer' THEN $5::uuid WHEN 'disb' THEN $13::uuid END,
                ln.id, r.part, r.num
           FROM ln, unnest($14::text[], $15::text[], $16::bigint[], $17::date[], $18::boolean[], $19::text[], $20::text[], $21::text[], $22::smallint[])
                AS r(type, description, amount, date, paid, src, dst, part, num)
         RETURNING 1
       )
       SELECT ln.id FROM ln, (SELECT count(*) FROM tx) AS done`,
      [
        userId, key, name, initial, input.payerAccountId, input.kind, input.principal, input.monthlyRate, input.system, n, input.firstDue, startDate, disb,
        rows.map((r) => r.type), rows.map((r) => r.description), rows.map((r) => r.amount), rows.map((r) => r.date), rows.map((r) => r.paid),
        rows.map((r) => r.from), rows.map((r) => r.to), rows.map((r) => r.part), rows.map((r) => r.number),
      ],
    );
    return out[0]?.id ?? null;
  } catch (err) {
    if (pgCode(err) === "23514") throw new UserError("Algum valor está fora do permitido. Confira os dados do empréstimo.");
    throw err;
  }
}

export type Loan = {
  id: string;
  accountId: string;
  name: string;
  kind: LoanKind;
  principal: number;
  monthlyRate: number;
  system: AmortizationSystem;
  installments: number;
  firstDue: string;
  startDate: string;
  settledAt: string | null;
  payerAccountId: string | null;
  payerAccountName: string | null;
  /** Saldo da conta do empréstimo hoje (negativo = ainda devo). */
  balance: number;
  paidCount: number;
  overdueCount: number;
  next: { id: string; number: number; date: string; amount: number } | null;
  /** Soma das parcelas que faltam (com os juros já previstos). */
  remainingInstallments: number;
  schedule: LoanSchedule;
  /** Quanto falta de amortização (o que se quitaria hoje, sem os juros futuros). */
  payoff: { remainingPrincipal: number; interestSaved: number };
};

export async function listLoans(db: Db, userId: string, now = new Date()): Promise<Loan[]> {
  const todayStr = today(now);
  const { rows } = await db.query(
    `SELECT l.*, to_char(l.first_due, 'YYYY-MM-DD') AS first_due_s, to_char(l.start_date, 'YYYY-MM-DD') AS start_s,
            to_char(l.settled_at, 'YYYY-MM-DD') AS settled_s, a.name, p.name AS payer_name,
            a.initial_balance_cents + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e
               WHERE e.account_id = a.id AND e.paid AND e.date <= $2::date), 0) AS balance,
            (SELECT count(*) FROM transactions t WHERE t.loan_id = l.id AND t.loan_part = 'installment' AND t.paid) AS paid_count,
            (SELECT count(*) FROM transactions t WHERE t.loan_id = l.id AND t.loan_part = 'installment' AND NOT t.paid AND t.date < $2::date) AS overdue_count,
            (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t WHERE t.loan_id = l.id AND t.loan_part = 'installment' AND NOT t.paid) AS remaining,
            (SELECT json_build_object('id', t.id, 'number', t.loan_installment, 'date', to_char(t.date, 'YYYY-MM-DD'), 'amount', t.amount_cents)
               FROM transactions t WHERE t.loan_id = l.id AND t.loan_part = 'installment' AND NOT t.paid ORDER BY t.date LIMIT 1) AS next
       FROM loans l
       JOIN accounts a ON a.id = l.account_id
       LEFT JOIN accounts p ON p.id = l.payer_account_id
      WHERE l.user_id = $1
      ORDER BY l.settled_at NULLS FIRST, l.created_at`,
    [userId, todayStr],
  );
  return rows.map((r) => {
    const rate = Number(r.monthly_rate);
    const schedule = loanSchedule(num(r.principal_cents), rate, Number(r.installments), r.first_due_s, r.system);
    const paidCount = num(r.paid_count);
    return {
      id: r.id,
      accountId: r.account_id,
      name: r.name,
      kind: r.kind,
      principal: num(r.principal_cents),
      monthlyRate: rate,
      system: r.system,
      installments: Number(r.installments),
      firstDue: r.first_due_s,
      startDate: r.start_s,
      settledAt: r.settled_s ?? null,
      payerAccountId: r.payer_account_id ?? null,
      payerAccountName: r.payer_name ?? null,
      balance: num(r.balance),
      paidCount,
      overdueCount: num(r.overdue_count),
      next: r.next ? { id: r.next.id, number: Number(r.next.number), date: r.next.date, amount: num(r.next.amount) } : null,
      remainingInstallments: num(r.remaining),
      schedule,
      payoff: r.settled_s ? { remainingPrincipal: 0, interestSaved: 0 } : payoffEstimate(schedule, paidCount),
    };
  });
}

export async function getLoan(db: Db, userId: string, loanId: string, now = new Date()): Promise<Loan | null> {
  if (!isUuid(loanId)) return null;
  return (await listLoans(db, userId, now)).find((l) => l.id === loanId) ?? null;
}

/**
 * Quitação antecipada pelo valor que o banco informou: apaga as parcelas e juros que ainda não
 * aconteceram e registra o pagamento. Se o valor pago for diferente do saldo, a diferença vira
 * encargo (pagou mais) ou um ajuste de desconto (pagou menos), para a conta zerar.
 */
export async function settleLoan(
  db: Db,
  userId: string,
  loanId: string,
  input: { amount: number; date?: string; submissionKey?: string | null },
  now = new Date(),
): Promise<void> {
  if (await alreadySubmitted(db, userId, submissionKey(input.submissionKey))) return;
  const loan = await getLoan(db, userId, loanId, now);
  if (!loan) throw new UserError("Empréstimo não encontrado.");
  if (loan.settledAt) throw new UserError("Esse empréstimo já foi quitado.");
  if (!loan.payerAccountId) throw new UserError("Escolha de novo a conta pagadora do empréstimo antes de quitar.");
  const date = input.date || today(now);
  if (!isValidDate(date) || date > today(now)) throw new UserError("A quitação é registrada com a data de hoje ou de um dia que já passou.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new UserError("Informe o valor da quitação.");
  if (!isValidCents(input.amount)) throw new UserError(TOO_BIG);
  const borrowed = loan.kind === "borrowed";
  const key = submissionKey(input.submissionKey);

  // Um comando só: trava o empréstimo, apaga o futuro, calcula o saldo e lança pagamento e diferença.
  const { rows } = await db.query<{ ok: boolean }>(
    `WITH claim AS (
       INSERT INTO form_submissions (user_id, key) SELECT $1, $2::uuid WHERE $2::uuid IS NOT NULL ON CONFLICT DO NOTHING RETURNING 1
     ), lock AS (
       UPDATE loans SET settled_at = $4::date
        WHERE id = $3 AND user_id = $1 AND settled_at IS NULL AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM claim))
        RETURNING id, account_id
     ), gone AS (
       DELETE FROM transactions t USING lock
        WHERE t.loan_id = lock.id AND NOT (t.paid AND t.date <= $4::date)
        RETURNING t.id
     ), bal AS (
       SELECT a.initial_balance_cents + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e
                WHERE e.account_id = a.id AND e.paid AND e.date <= $4::date
                  AND e.transaction_id NOT IN (SELECT id FROM gone)), 0) AS balance, lock.id AS loan_id, a.id AS account_id
         FROM lock JOIN accounts a ON a.id = lock.account_id
     ), pay AS (
       INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id, to_account_id, loan_id, loan_part)
       SELECT $1, 'transfer', $6, $5, $4, true,
              CASE WHEN $7 THEN $8::uuid ELSE bal.account_id END, CASE WHEN $7 THEN bal.account_id ELSE $8::uuid END,
              bal.loan_id, 'payoff'
         FROM bal RETURNING 1
     ), diff AS (
       -- Saldo depois do pagamento: dívida (-) + pagamento, ou crédito (+) - recebimento.
       SELECT bal.*, CASE WHEN $7 THEN bal.balance + $5 ELSE bal.balance - $5 END AS rest FROM bal
     ), fee AS (
       INSERT INTO transactions (user_id, type, description, amount_cents, date, paid, account_id, loan_id, loan_part, is_adjustment)
       SELECT $1,
              CASE WHEN diff.rest > 0 THEN 'expense' ELSE 'income' END,
              CASE WHEN ($7 AND diff.rest > 0) OR (NOT $7 AND diff.rest < 0) THEN 'Encargos da quitação' ELSE 'Desconto na quitação' END,
              abs(diff.rest), $4, true, diff.account_id, diff.loan_id, 'payoff_fee',
              -- Desconto não é ganho (é juro que deixou de existir): fica fora dos relatórios.
              NOT (($7 AND diff.rest > 0) OR (NOT $7 AND diff.rest < 0))
         FROM diff WHERE diff.rest <> 0
         RETURNING 1
     )
     SELECT true AS ok FROM lock, (SELECT count(*) FROM pay) p, (SELECT count(*) FROM fee) f`,
    [userId, key, loanId, date, input.amount, `Quitação do empréstimo ${loan.name} (${formatMoney(input.amount)})`, borrowed, loan.payerAccountId],
  );
  if (!rows.length && !key) throw new UserError("Esse empréstimo já foi quitado.");
}

/** Exclui o empréstimo, a conta dele e todos os lançamentos que ele gerou. */
export async function deleteLoan(db: Db, userId: string, loanId: string): Promise<void> {
  assertUuid(loanId, "Empréstimo não encontrado.");
  const { rows } = await db.query<{ account_id: string }>(
    `WITH l AS (SELECT id, account_id FROM loans WHERE id = $1 AND user_id = $2),
          other AS (SELECT 1 FROM transactions t, l WHERE (t.account_id = l.account_id OR t.to_account_id = l.account_id) AND t.loan_id IS DISTINCT FROM l.id LIMIT 1)
     SELECT l.account_id, EXISTS (SELECT 1 FROM other) AS has_other FROM l`,
    [loanId, userId],
  );
  if (!rows[0]) throw new UserError("Empréstimo não encontrado.");
  if ((rows[0] as unknown as { has_other: boolean }).has_other) {
    throw new UserError("Há lançamentos feitos à mão na conta deste empréstimo. Exclua ou mova esses lançamentos antes.");
  }
  // Em ordem: lançamentos do empréstimo, o empréstimo e a conta (que só sai sem lançamentos).
  await db.query("DELETE FROM transactions WHERE loan_id = $1 AND user_id = $2", [loanId, userId]);
  await db.query("DELETE FROM loans WHERE id = $1 AND user_id = $2", [loanId, userId]);
  await db.query("DELETE FROM accounts WHERE id = $1 AND user_id = $2", [rows[0].account_id, userId]);
}
