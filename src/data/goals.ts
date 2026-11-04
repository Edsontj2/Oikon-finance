import { num, type Db } from "@/lib/db";
import { isValidDate, monthRange, shiftMonth, today } from "@/lib/dates";
import { LIMITS, TOO_BIG, isValidCents, requiredText } from "@/domain/limits";
import { goalProgress, type GoalKind, type GoalProgress } from "@/domain/goals";
import { isMoneyAccount, type AccountType } from "@/domain/accounts";
import { UserError, assertUuid, pgCode, submissionKey, toUserError, validateOnce } from "./errors";

export type Goal = {
  id: string;
  name: string;
  kind: GoalKind;
  target: number;
  targetDate: string | null;
  accountId: string | null;
  accountName: string | null;
  /** Guardado à mão (só vale quando não há conta ligada). */
  manualSaved: number;
  months: number | null;
  createdAt: string;
  progress: GoalProgress;
};

export type GoalInput = {
  name: string;
  kind: GoalKind;
  target: number;
  targetDate?: string | null;
  accountId?: string | null;
  months?: number | null;
  submissionKey?: string | null;
};

export async function listGoals(db: Db, userId: string, now = new Date()): Promise<Goal[]> {
  const todayStr = today(now);
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.kind, g.target_cents, to_char(g.target_date, 'YYYY-MM-DD') AS target_date, g.account_id,
            a.name AS account_name, g.saved_cents, g.months, to_char(g.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS created,
            a.initial_balance_cents + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e
               WHERE e.account_id = a.id AND e.paid AND e.date <= $2::date), 0) AS account_balance
       FROM goals g
       LEFT JOIN accounts a ON a.id = g.account_id
      WHERE g.user_id = $1
      ORDER BY CASE g.kind WHEN 'emergency' THEN 0 ELSE 1 END, g.target_date NULLS LAST, g.created_at`,
    [userId, todayStr],
  );
  return rows.map((r) => {
    const target = num(r.target_cents);
    const saved = r.account_id ? num(r.account_balance) : num(r.saved_cents);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      target,
      targetDate: r.target_date ?? null,
      accountId: r.account_id ?? null,
      accountName: r.account_name ?? null,
      manualSaved: num(r.saved_cents),
      months: r.months === null ? null : Number(r.months),
      createdAt: r.created,
      progress: goalProgress({ target, saved, targetDate: r.target_date ?? null, createdAt: r.created, today: todayStr }),
    };
  });
}

/**
 * Gasto médio por mês nos últimos 3 meses completos (pagos e pendentes; transferências e
 * ajustes não entram). Meses antes do primeiro lançamento não puxam a média para baixo.
 */
export async function averageMonthlyExpense(db: Db, userId: string, now = new Date()): Promise<number> {
  const month = today(now).slice(0, 7);
  const from = shiftMonth(month, -3);
  const { rows } = await db.query(
    `SELECT to_char(date, 'YYYY-MM') AS month, SUM(amount_cents) AS total
       FROM report_transactions
      WHERE user_id = $1 AND type = 'expense' AND date >= $2 AND date < $3
      GROUP BY 1`,
    [userId, `${from}-01`, monthRange(month).start],
  );
  if (!rows.length) return 0;
  const first = rows.map((r) => r.month as string).sort()[0];
  const months = [1, 2, 3].map((n) => shiftMonth(month, -n)).filter((m) => m >= first).length;
  return Math.round(rows.reduce((s, r) => s + num(r.total), 0) / months);
}

async function validateGoal(db: Db, userId: string, input: GoalInput, exceptId?: string) {
  const name = requiredText(input.name, LIMITS.accountName, "Dê um nome para a meta.", "O nome da meta");
  if (input.kind !== "goal" && input.kind !== "emergency") throw new UserError("Tipo de meta inválido.");
  if (!Number.isSafeInteger(input.target) || input.target <= 0) throw new UserError("Informe quanto quer juntar.");
  if (!isValidCents(input.target)) throw new UserError(TOO_BIG);
  const targetDate = input.targetDate || null;
  if (targetDate !== null && !isValidDate(targetDate)) throw new UserError("Data da meta inválida.");
  const months = input.kind === "emergency" ? input.months ?? 6 : null;
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 24)) {
    throw new UserError("A reserva deve cobrir de 1 a 24 meses de gastos.");
  }
  const accountId = input.accountId || null;
  if (accountId) {
    assertUuid(accountId, "Conta não encontrada.");
    const { rows } = await db.query<{ type: AccountType }>("SELECT type FROM accounts WHERE id = $1 AND user_id = $2", [accountId, userId]);
    if (!rows[0]) throw new UserError("Conta não encontrada.");
    if (!isMoneyAccount(rows[0].type)) throw new UserError("Escolha uma conta onde o dinheiro fica guardado (poupança, investimento...).");
  }
  const dup = await db.query("SELECT 1 FROM goals WHERE user_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3::uuid", [userId, name, exceptId ?? null]);
  if (dup.rows.length) throw new UserError("Já existe uma meta com esse nome.");
  if (input.kind === "emergency") {
    const other = await db.query("SELECT 1 FROM goals WHERE user_id = $1 AND kind = 'emergency' AND id IS DISTINCT FROM $2::uuid", [userId, exceptId ?? null]);
    if (other.rows.length) throw new UserError("Você já tem uma reserva de emergência. Edite a que existe.");
  }
  return { name, kind: input.kind, target: input.target, targetDate, accountId, months };
}

function goalError(err: unknown): unknown {
  if (pgCode(err) === "23505") return new UserError("Já existe uma meta com esse nome (ou uma reserva de emergência).");
  return toUserError(err);
}

export async function createGoal(db: Db, userId: string, input: GoalInput): Promise<string | null> {
  const key = submissionKey(input.submissionKey);
  const g = await validateOnce(db, userId, key, () => validateGoal(db, userId, input));
  if (!g) return null;
  try {
    const { rows } = await db.query<{ id: string }>(
      `WITH claim AS (
         INSERT INTO form_submissions (user_id, key) SELECT $1, $8::uuid WHERE $8::uuid IS NOT NULL
         ON CONFLICT DO NOTHING RETURNING 1
       )
       INSERT INTO goals (user_id, name, kind, target_cents, target_date, account_id, months)
       SELECT $1, $2, $3, $4, $5, $6, $7 WHERE $8::uuid IS NULL OR EXISTS (SELECT 1 FROM claim)
       RETURNING id`,
      [userId, g.name, g.kind, g.target, g.targetDate, g.accountId, g.months, key],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    throw goalError(err);
  }
}

export async function updateGoal(db: Db, userId: string, goalId: string, input: GoalInput): Promise<void> {
  assertUuid(goalId, "Meta não encontrada.");
  const g = await validateGoal(db, userId, input, goalId);
  try {
    const { rowCount } = await db.query(
      `UPDATE goals SET name = $3, kind = $4, target_cents = $5, target_date = $6, account_id = $7, months = $8
        WHERE id = $1 AND user_id = $2`,
      [goalId, userId, g.name, g.kind, g.target, g.targetDate, g.accountId, g.months],
    );
    if (!rowCount) throw new UserError("Meta não encontrada.");
  } catch (err) {
    throw goalError(err);
  }
}

export async function deleteGoal(db: Db, userId: string, goalId: string): Promise<void> {
  assertUuid(goalId, "Meta não encontrada.");
  const { rowCount } = await db.query("DELETE FROM goals WHERE id = $1 AND user_id = $2", [goalId, userId]);
  if (!rowCount) throw new UserError("Meta não encontrada.");
}

/**
 * Guardar (valor positivo) ou retirar (negativo) numa meta sem conta ligada. Só anota quanto
 * está separado para a meta: não mexe no saldo de nenhuma conta.
 */
export async function moveGoalSaved(db: Db, userId: string, goalId: string, delta: number): Promise<void> {
  assertUuid(goalId, "Meta não encontrada.");
  if (!Number.isSafeInteger(delta) || delta === 0) throw new UserError("Informe o valor.");
  if (!isValidCents(delta)) throw new UserError(TOO_BIG);
  const { rows } = await db.query<{ account_id: string | null; saved_cents: string }>(
    "SELECT account_id, saved_cents FROM goals WHERE id = $1 AND user_id = $2",
    [goalId, userId],
  );
  if (!rows[0]) throw new UserError("Meta não encontrada.");
  if (rows[0].account_id) throw new UserError("Esta meta acompanha o saldo da conta ligada: lance o dinheiro na conta.");
  const { rowCount } = await db.query(
    `UPDATE goals SET saved_cents = saved_cents + $3
      WHERE id = $1 AND user_id = $2 AND account_id IS NULL AND saved_cents + $3 >= 0 AND saved_cents + $3 <= $4`,
    [goalId, userId, delta, LIMITS.maxCents],
  );
  if (!rowCount) throw new UserError(delta < 0 ? "Não dá para retirar mais do que está guardado." : TOO_BIG);
}
