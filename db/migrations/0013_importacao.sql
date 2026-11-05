-- 0013: importação de extratos (OFX/CSV).
-- import_ref é o identificador da linha do extrato (FITID do banco ou um resumo da linha).
-- Uma linha só entra uma vez por conta: importar o mesmo arquivo de novo não duplica nada.
ALTER TABLE transactions ADD COLUMN import_ref text CHECK (import_ref IS NULL OR length(import_ref) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX transactions_import_ref_unico ON transactions (account_id, import_ref) WHERE import_ref IS NOT NULL;
