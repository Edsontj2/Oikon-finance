-- 0001: tabelas iniciais. Valores sempre em centavos (inteiro) para não haver erro de arredondamento.
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Conta = onde o dinheiro está: conta corrente, poupança, dinheiro ou cartão de crédito.
CREATE TABLE IF NOT EXISTS accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  type                  text NOT NULL CHECK (type IN ('checking', 'savings', 'cash', 'credit_card')),
  initial_balance_cents bigint NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts (user_id);

-- Categoria de entrada ou saída, com limite mensal opcional (substitui "orçamentos").
CREATE TABLE IF NOT EXISTS categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('income', 'expense')),
  monthly_limit_cents bigint CHECK (monthly_limit_cents IS NULL OR monthly_limit_cents > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, name)
);

-- Lançamento: entrada, saída ou transferência entre contas.
-- paid = false significa pendente (substitui "contas a pagar/receber", dívidas e empréstimos).
-- series_id agrupa lançamentos criados com "repetir todo mês" (substitui "recorrências").
CREATE TABLE IF NOT EXISTS transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  description   text NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  date          date NOT NULL,
  paid          boolean NOT NULL DEFAULT true,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  series_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'transfer') = (to_account_id IS NOT NULL)),
  CHECK (to_account_id IS NULL OR to_account_id <> account_id),
  CHECK (type <> 'transfer' OR category_id IS NULL)
);
CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions (user_id, date);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions (account_id);
CREATE INDEX IF NOT EXISTS transactions_to_account_idx ON transactions (to_account_id);
