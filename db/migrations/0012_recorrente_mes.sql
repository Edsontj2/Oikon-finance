-- 0012: mês a que pertence cada lançamento de um recorrente ("Todo mês").
-- A data pode mudar (pagar antes do vencimento traz a data para hoje), mas o mês fica: assim o
-- app sabe que aquele mês já foi lançado e não lança de novo, e os meses futuros que ainda não
-- existem aparecem como "previstos" na lista.
ALTER TABLE transactions ADD COLUMN recurring_month date;
UPDATE transactions SET recurring_month = date_trunc('month', date)::date WHERE recurring_id IS NOT NULL;
ALTER TABLE transactions ADD CONSTRAINT transactions_mes_do_recorrente
  CHECK ((recurring_id IS NULL OR recurring_month IS NOT NULL) AND (recurring_month IS NULL OR extract(day FROM recurring_month) = 1));
CREATE UNIQUE INDEX transactions_um_por_mes_do_recorrente ON transactions (recurring_id, recurring_month) WHERE recurring_id IS NOT NULL;
