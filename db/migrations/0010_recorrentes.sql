-- 0010: lançamento recorrente sem fim ("Todo mês").
-- A regra guarda o modelo; o app cria um lançamento por mês, quando o mês chega (pendente).
-- Só o mês atual aparece como pendente: os meses futuros não existem até chegarem.
-- Excluir "este e os próximos" desliga a regra (active = false) e para a repetição.
CREATE TABLE recurring_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  description       text NOT NULL,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id     uuid REFERENCES accounts(id) ON DELETE CASCADE,
  category_id       uuid REFERENCES categories(id) ON DELETE SET NULL,
  -- Dia do mês do primeiro lançamento (31 vira o último dia nos meses curtos).
  day               smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  -- Primeiro dia do último mês já lançado.
  generated_through date NOT NULL CHECK (extract(day FROM generated_through) = 1),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'transfer') = (to_account_id IS NOT NULL)),
  CHECK (to_account_id IS NULL OR to_account_id <> account_id)
);
CREATE INDEX recurring_rules_user_idx ON recurring_rules (user_id, generated_through) WHERE active;

ALTER TABLE transactions ADD COLUMN recurring_id uuid REFERENCES recurring_rules(id) ON DELETE SET NULL;
CREATE INDEX transactions_recurring_idx ON transactions (recurring_id) WHERE recurring_id IS NOT NULL;
