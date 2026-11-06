-- Cada importação de extrato vira um registro, com o que ela fez em cada lançamento: o que criou
-- (desfazer = apagar) e o que conciliou (desfazer = voltar data e "pago" como estavam).
-- Importações feitas antes desta migração não têm registro e não podem ser desfeitas assim.
CREATE TABLE IF NOT EXISTS statement_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  file_name        text CHECK (char_length(file_name) <= 200),
  created_count    integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  reconciled_count integer NOT NULL DEFAULT 0 CHECK (reconciled_count >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  undone_at        timestamptz
);
CREATE INDEX IF NOT EXISTS statement_imports_user_idx ON statement_imports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS statement_import_items (
  import_id       uuid NOT NULL REFERENCES statement_imports(id) ON DELETE CASCADE,
  transaction_id  uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('created', 'reconciled')),
  prev_date       date,
  prev_paid       boolean,
  PRIMARY KEY (import_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS statement_import_items_tx_idx ON statement_import_items (transaction_id);
