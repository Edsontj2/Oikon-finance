import { num, type Db } from "@/lib/db";
import { currentMonth, isValidMonth, today } from "@/lib/dates";
import type { Transaction, TransactionType } from "@/domain/transactions";
import { UserError, assertUuid, isUuid } from "./errors";

/**
 * Lançamentos "Todo mês" (sem fim): cria o lançamento de cada mês que já chegou e ainda não foi
 * lançado, até o mês atual. Os meses futuros só aparecem quando chegam, então o pendente mostra
 * só o valor do mês. Um único comando: a regra é travada e avançada junto com a inserção, então
 * duas requisições ao mesmo tempo não lançam o mesmo mês duas vezes. Devolve quantos criou.
 */
export async function ensureRecurring(db: Db, userId: string, now = new Date()): Promise<number> {
  const { rowCount } = await db.query(
    `WITH due AS (
       UPDATE recurring_rules r SET generated_through = $2::date
         FROM (SELECT id, generated_through AS prev FROM recurring_rules
                WHERE user_id = $1 AND active AND generated_through < $2::date
                FOR UPDATE) old
        WHERE r.id = old.id
       RETURNING r.id, r.user_id, r.type, r.description, r.amount_cents, r.account_id, r.to_account_id,
                 r.category_id, r.day, old.prev
     )
     INSERT INTO transactions
       (user_id, type, description, amount_cents, date, paid, account_id, to_account_id, category_id, series_id, recurring_id, recurring_month)
     SELECT d.user_id, d.type, d.description, d.amount_cents,
            m.month + (LEAST(d.day, extract(day FROM (m.month + interval '1 month' - interval '1 day'))::int) - 1),
            a.type = 'credit_card', d.account_id, d.to_account_id, d.category_id, d.id, d.id, m.month
       FROM due d
       JOIN accounts a ON a.id = d.account_id AND NOT a.archived
      CROSS JOIN LATERAL (
        SELECT g::date AS month FROM generate_series(d.prev + interval '1 month', $2::date, interval '1 month') g
      ) m
      -- Mês já lançado antes da hora (pago adiantado pela lista): não lança de novo.
      WHERE NOT EXISTS (SELECT 1 FROM transactions x WHERE x.recurring_id = d.id AND x.recurring_month = m.month)
     ON CONFLICT (recurring_id, recurring_month) WHERE recurring_id IS NOT NULL DO NOTHING`,
    [userId, `${currentMonth(now)}-01`],
  );
  return rowCount ?? 0;
}

/** Lançamento previsto de um "Todo mês" num mês que ainda não chegou (não existe no banco). */
export type ProjectedTransaction = Transaction & { projected: { ruleId: string; month: string } };

/**
 * Meses futuros dos recorrentes, um por regra no mês pedido, para a lista de lançamentos
 * mostrar o que vem por aí sem gravar nada. Mês atual e passados não entram (já foram lançados).
 */
export async function projectedRecurring(
  db: Db,
  userId: string,
  month: string,
  filter: { accountId?: string; type?: TransactionType; search?: string } = {},
): Promise<ProjectedTransaction[]> {
  if (!isValidMonth(month)) return [];
  const search = filter.search?.trim().slice(0, 120).replace(/[\\%_]/g, "\\$&") || null;
  const { rows } = await db.query(
    `SELECT r.id, r.type, r.description, r.amount_cents, r.account_id, a.name AS account_name, a.type AS account_type,
            r.to_account_id, ta.name AS to_account_name, r.category_id, c.name AS category_name,
            to_char(make_date($3::int, $4::int, LEAST(r.day, extract(day FROM ($2::date + interval '1 month' - interval '1 day'))::int)), 'YYYY-MM-DD') AS date
       FROM recurring_rules r
       JOIN accounts a ON a.id = r.account_id AND NOT a.archived
       LEFT JOIN accounts ta ON ta.id = r.to_account_id
       LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.user_id = $1 AND r.active AND r.generated_through < $2::date
        AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.recurring_id = r.id AND x.recurring_month = $2::date)
        AND ($5::uuid IS NULL OR r.account_id = $5::uuid OR r.to_account_id = $5::uuid)
        AND ($6::text IS NULL OR r.type = $6)
        AND ($7::text IS NULL OR r.description ILIKE '%' || $7 || '%')
      ORDER BY r.day DESC, r.created_at`,
    [userId, `${month}-01`, Number(month.slice(0, 4)), Number(month.slice(5, 7)), isUuid(filter.accountId) ? filter.accountId : null, filter.type ?? null, search],
  );
  return rows.map((r) => ({
    id: `previsto:${r.id}:${month}`,
    projected: { ruleId: r.id, month },
    type: r.type,
    description: r.description,
    amount: num(r.amount_cents),
    date: r.date,
    // No cartão a compra entra na fatura sozinha; nas outras contas fica pendente até pagar.
    paid: r.account_type === "credit_card",
    accountId: r.account_id,
    accountName: r.account_name,
    toAccountId: r.to_account_id ?? null,
    toAccountName: r.to_account_name ?? null,
    categoryId: r.category_id ?? null,
    categoryName: r.category_name ?? null,
    seriesId: r.id,
    recurringId: r.id,
    installmentNumber: null,
    installmentCount: null,
  }));
}

/** Totais previstos do mês (o que os recorrentes ainda vão lançar), para somar no resumo. */
export function projectedTotals(items: ProjectedTransaction[]) {
  return {
    income: items.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0),
    expense: items.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0),
  };
}

/**
 * Pagar adiantado um mês previsto: grava o lançamento daquele mês agora (já pago, com a data de
 * hoje: o dinheiro sai hoje). O mês fica marcado e não é lançado de novo quando chegar.
 */
export async function payProjectedNow(db: Db, userId: string, ruleId: string, month: string, now = new Date()): Promise<string> {
  assertUuid(ruleId, "Lançamento não encontrado.");
  if (!isValidMonth(month) || month <= currentMonth(now)) throw new UserError("Esse mês já foi lançado: pague pela lista.");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO transactions
       (user_id, type, description, amount_cents, date, paid, account_id, to_account_id, category_id, series_id, recurring_id, recurring_month)
     SELECT r.user_id, r.type, r.description, r.amount_cents, $4::date, true, r.account_id, r.to_account_id, r.category_id, r.id, r.id, $3::date
       FROM recurring_rules r
      WHERE r.id = $1 AND r.user_id = $2 AND r.active AND r.generated_through < $3::date
     ON CONFLICT (recurring_id, recurring_month) WHERE recurring_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [ruleId, userId, `${month}-01`, today(now)],
  );
  if (!rows[0]) throw new UserError("Esse mês já foi lançado ou a repetição foi encerrada.");
  return rows[0].id;
}

/** "Parar de repetir" a partir de um mês previsto: apaga os lançados depois dele e desliga a regra. */
export async function stopRecurring(db: Db, userId: string, ruleId: string): Promise<void> {
  assertUuid(ruleId, "Lançamento não encontrado.");
  const { rowCount } = await db.query("UPDATE recurring_rules SET active = false WHERE id = $1 AND user_id = $2 AND active", [ruleId, userId]);
  if (!rowCount) throw new UserError("Essa repetição já foi encerrada.");
}
