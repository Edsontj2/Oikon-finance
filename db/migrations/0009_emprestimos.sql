-- 0009: empréstimos e dívidas.
-- Cada empréstimo tem uma conta do tipo "loan" (o saldo dela é a dívida, negativo, ou o que
-- emprestei, positivo). As parcelas são transferências entre a conta pagadora e a do empréstimo
-- (não são uma nova despesa); os juros de cada parcela são lançados na conta do empréstimo
-- (são o custo real e entram nos relatórios).
ALTER TABLE accounts DROP CONSTRAINT accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('checking', 'savings', 'cash', 'credit_card', 'investment', 'loan'));

CREATE TABLE loans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  payer_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('borrowed', 'lent')),
  principal_cents  bigint NOT NULL CHECK (principal_cents > 0),
  monthly_rate     numeric(7, 4) NOT NULL CHECK (monthly_rate >= 0 AND monthly_rate <= 30),
  system           text NOT NULL CHECK (system IN ('price', 'sac')),
  installments     smallint NOT NULL CHECK (installments BETWEEN 1 AND 420),
  first_due        date NOT NULL,
  start_date       date NOT NULL,
  settled_at       date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loans_user_idx ON loans (user_id);

-- Lançamentos gerados pelo empréstimo: qual parcela (0 = liberação do dinheiro) e de que tipo.
ALTER TABLE transactions
  ADD COLUMN loan_id uuid REFERENCES loans(id) ON DELETE CASCADE,
  ADD COLUMN loan_part text CHECK (loan_part IN ('disbursement', 'installment', 'interest', 'payoff', 'payoff_fee')),
  ADD COLUMN loan_installment smallint,
  ADD CONSTRAINT transactions_parte_do_emprestimo CHECK ((loan_id IS NULL) = (loan_part IS NULL));
CREATE INDEX transactions_loan_idx ON transactions (loan_id) WHERE loan_id IS NOT NULL;
