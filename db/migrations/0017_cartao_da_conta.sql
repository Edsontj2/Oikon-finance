-- Conta corrente com cartão de crédito (como nos bancos digitais): o cartão continua sendo uma
-- conta do tipo cartão (faturas, limite, parcelas), mas fica ligado à conta corrente, que é a
-- pagadora da fatura. Uma conta tem no máximo um cartão ligado. Só acrescenta uma coluna.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS card_of_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_cartao_da_conta;
ALTER TABLE accounts ADD CONSTRAINT accounts_cartao_da_conta
  CHECK (card_of_account_id IS NULL OR (type = 'credit_card' AND card_of_account_id <> id));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_um_cartao_por_conta ON accounts (card_of_account_id) WHERE card_of_account_id IS NOT NULL;
