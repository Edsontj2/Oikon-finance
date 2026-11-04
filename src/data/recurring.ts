import type { Db } from "@/lib/db";
import { currentMonth } from "@/lib/dates";

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
       (user_id, type, description, amount_cents, date, paid, account_id, to_account_id, category_id, series_id, recurring_id)
     SELECT d.user_id, d.type, d.description, d.amount_cents,
            m.month + (LEAST(d.day, extract(day FROM (m.month + interval '1 month' - interval '1 day'))::int) - 1),
            a.type = 'credit_card', d.account_id, d.to_account_id, d.category_id, d.id, d.id
       FROM due d
       JOIN accounts a ON a.id = d.account_id AND NOT a.archived
      CROSS JOIN LATERAL (
        SELECT g::date AS month FROM generate_series(d.prev + interval '1 month', $2::date, interval '1 month') g
      ) m`,
    [userId, `${currentMonth(now)}-01`],
  );
  return rowCount ?? 0;
}
