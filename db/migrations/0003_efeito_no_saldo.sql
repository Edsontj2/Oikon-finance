-- Regra única de como cada lançamento mexe no saldo de cada conta (antes estava repetida no código):
--   entrada  -> +valor na conta
--   saída    -> -valor na conta
--   transferência -> -valor na conta de origem e +valor na conta de destino
CREATE VIEW transaction_effects AS
  SELECT t.id AS transaction_id, t.user_id, t.account_id, t.type, t.date, t.paid,
         CASE WHEN t.type = 'income' THEN t.amount_cents ELSE -t.amount_cents END AS delta
    FROM transactions t
  UNION ALL
  SELECT t.id, t.user_id, t.to_account_id, t.type, t.date, t.paid, t.amount_cents
    FROM transactions t
   WHERE t.type = 'transfer';
