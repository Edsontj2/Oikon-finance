-- Compras parceladas: cada parcela sabe qual é (3) de quantas (10).
-- Lançamentos que só repetem todo mês (assinatura, aluguel) ficam com as duas colunas vazias.
ALTER TABLE transactions
  ADD COLUMN installment_number smallint,
  ADD COLUMN installment_count smallint,
  ADD CONSTRAINT transactions_parcela_valida CHECK (
    (installment_number IS NULL AND installment_count IS NULL)
    OR (installment_count BETWEEN 2 AND 60 AND installment_number BETWEEN 1 AND installment_count AND series_id IS NOT NULL)
  );
