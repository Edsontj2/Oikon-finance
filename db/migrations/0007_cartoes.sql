-- 0007: cartão de crédito completo.
-- O cartão continua sendo uma conta (type = 'credit_card'); aqui ganha limite, fechamento,
-- vencimento, conta que paga a fatura, bandeira e final. As faturas não são uma tabela: são
-- calculadas dos lançamentos do cartão (data + dia de fechamento), então nunca ficam fora de sincronia.
ALTER TABLE accounts
  ADD COLUMN credit_limit_cents bigint CHECK (credit_limit_cents IS NULL OR credit_limit_cents > 0),
  ADD COLUMN closing_day smallint CHECK (closing_day BETWEEN 1 AND 31),
  ADD COLUMN due_day smallint CHECK (due_day BETWEEN 1 AND 31),
  ADD COLUMN payer_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN brand text CHECK (brand IS NULL OR length(brand) <= 30),
  ADD COLUMN last4 text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT accounts_dados_de_cartao CHECK (
    type = 'credit_card'
    OR (credit_limit_cents IS NULL AND closing_day IS NULL AND due_day IS NULL AND payer_account_id IS NULL
        AND brand IS NULL AND last4 IS NULL)
  ),
  ADD CONSTRAINT accounts_pagadora_diferente CHECK (payer_account_id IS NULL OR payer_account_id <> id);

-- Histórico de limite: cada mudança fica registrada.
CREATE TABLE card_limit_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  limit_cents bigint CHECK (limit_cents IS NULL OR limit_cents > 0),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_limit_changes_account_idx ON card_limit_changes (account_id, changed_at);

-- Lançamentos do cartão:
--   card_kind: o que o lançamento é dentro da fatura (compra comum = vazio).
--     refund              estorno (entrada no cartão; nos relatórios abate a saída, não é receita)
--     interest/fee/iof    juros, multa/tarifa/anuidade, IOF (saídas comuns, com rótulo)
--     invoice_credit      crédito que zera a fatura parcelada (fora dos relatórios)
--     invoice_installment parcela do parcelamento da fatura (fora dos relatórios: a compra já contou)
--   invoice_month: fatura escolhida à mão ("AAAA-MM" do vencimento); vazio = pela data.
ALTER TABLE transactions
  ADD COLUMN card_kind text CHECK (card_kind IN ('refund', 'interest', 'fee', 'iof', 'invoice_credit', 'invoice_installment')),
  ADD COLUMN invoice_month text CHECK (invoice_month IS NULL OR invoice_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT transactions_tipo_do_cartao CHECK (
    card_kind IS NULL
    OR (card_kind IN ('refund', 'invoice_credit') AND type = 'income')
    OR (card_kind IN ('interest', 'fee', 'iof', 'invoice_installment') AND type = 'expense')
  );

-- Visão usada nos relatórios (resumo do mês, gráficos, categorias): a mesma regra em todo lugar.
--   estorno vira saída negativa (abate o gasto, não é ganho);
--   crédito e parcelas do parcelamento de fatura ficam de fora (o gasto real já foi a compra + juros).
CREATE VIEW report_transactions AS
  SELECT t.id, t.user_id, t.category_id, t.date, t.paid, t.account_id,
         CASE WHEN t.card_kind = 'refund' THEN 'expense' ELSE t.type END AS type,
         CASE WHEN t.card_kind = 'refund' THEN -t.amount_cents ELSE t.amount_cents END AS amount_cents
    FROM transactions t
   WHERE t.card_kind IS NULL OR t.card_kind NOT IN ('invoice_credit', 'invoice_installment');
