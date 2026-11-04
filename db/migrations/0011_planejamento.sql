-- 0011: subcategorias, metas (objetivos e reserva de emergência).
-- Subcategoria: um nível só, do mesmo tipo da categoria-mãe. O limite da mãe vale para a soma
-- dela com as filhas. Excluir a mãe solta as filhas (viram categorias comuns).
ALTER TABLE categories ADD COLUMN parent_id uuid REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ADD CONSTRAINT categories_nao_e_mae_de_si CHECK (parent_id IS DISTINCT FROM id);
CREATE INDEX categories_parent_idx ON categories (parent_id) WHERE parent_id IS NOT NULL;

-- Meta: quanto juntar e até quando. O progresso vem do saldo de uma conta escolhida
-- (poupança, investimento) ou do valor guardado informado à mão.
CREATE TABLE goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind         text NOT NULL CHECK (kind IN ('goal', 'emergency')),
  target_cents bigint NOT NULL CHECK (target_cents > 0 AND target_cents <= 100000000000),
  target_date  date,
  account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  saved_cents  bigint NOT NULL DEFAULT 0 CHECK (saved_cents >= 0 AND saved_cents <= 100000000000),
  -- Reserva de emergência: quantos meses de gastos guardar.
  months       smallint CHECK (months BETWEEN 1 AND 24),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'emergency') = (months IS NOT NULL))
);
CREATE INDEX goals_user_idx ON goals (user_id, created_at);
CREATE UNIQUE INDEX goals_nome_unico ON goals (user_id, lower(name));
CREATE UNIQUE INDEX goals_uma_reserva ON goals (user_id) WHERE kind = 'emergency';
