-- Teto de R$ 1 bilhão (em centavos) por valor, o mesmo de src/domain/limits.ts.
-- Garante que as somas de saldo nunca passem do inteiro exato do JavaScript.
-- NOT VALID: não reprova linhas antigas, só as novas e as alteradas.
ALTER TABLE transactions ADD CONSTRAINT transactions_amount_teto CHECK (amount_cents <= 100000000000) NOT VALID;
ALTER TABLE accounts ADD CONSTRAINT accounts_initial_balance_teto CHECK (abs(initial_balance_cents) <= 100000000000) NOT VALID;
ALTER TABLE categories ADD CONSTRAINT categories_limit_teto CHECK (monthly_limit_cents <= 100000000000) NOT VALID;
