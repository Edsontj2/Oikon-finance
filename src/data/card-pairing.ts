import type { Db } from "@/lib/db";

/**
 * Liga cartões de crédito a contas correntes automaticamente (um cartão por conta):
 * 1) a conta corrente que paga a fatura; senão 2) a única conta corrente da mesma instituição ou
 * com o nome que combina ("Cartão X", "X crédito", "X cartão"). Casos ambíguos ficam como estão.
 * $1 = usuário (ou null para todos).
 */
const PAIR_CARDS_SQL = `
WITH cand AS (
  SELECT c.id AS card_id, a.id AS acc_id, c.created_at,
         CASE WHEN c.payer_account_id = a.id THEN 0 ELSE 1 END AS pri
    FROM accounts c
    JOIN accounts a ON a.user_id = c.user_id AND a.type = 'checking' AND NOT a.archived
   WHERE c.type = 'credit_card' AND NOT c.archived AND c.card_of_account_id IS NULL AND NOT c.card_link_manual_off
     AND ($1::uuid IS NULL OR c.user_id = $1::uuid)
     AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.card_of_account_id = a.id)
     AND (
       c.payer_account_id = a.id
       OR (c.payer_account_id IS NULL AND (
            (a.institution IS NOT NULL AND c.institution IS NOT NULL AND lower(trim(a.institution)) = lower(trim(c.institution)))
            OR lower(trim(c.name)) IN (lower('cartão ' || a.name), lower('cartao ' || a.name), lower(a.name || ' crédito'),
                                       lower(a.name || ' credito'), lower(a.name || ' cartão'))))
     )
),
sure AS (
  SELECT * FROM cand k
   WHERE k.pri = 0 OR (SELECT count(*) FROM cand o WHERE o.card_id = k.card_id) = 1
),
per_account AS (
  SELECT DISTINCT ON (acc_id) card_id, acc_id FROM sure ORDER BY acc_id, pri, created_at
)
UPDATE accounts c SET card_of_account_id = p.acc_id, payer_account_id = p.acc_id
  FROM per_account p
 WHERE c.id = p.card_id
   AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.card_of_account_id = p.acc_id)`;

/** Liga automaticamente os cartões do usuário às contas correntes deles (ver regra acima). */
export async function pairCards(db: Db, userId: string): Promise<void> {
  await db.query(PAIR_CARDS_SQL, [userId]);
}
