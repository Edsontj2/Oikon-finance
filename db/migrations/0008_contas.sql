-- 0008: contas completas.
--   tipo "investment" (aplicações, corretora), instituição, cor, ícone, arquivada e cheque especial.
ALTER TABLE accounts DROP CONSTRAINT accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('checking', 'savings', 'cash', 'credit_card', 'investment'));

ALTER TABLE accounts
  ADD COLUMN institution text CHECK (institution IS NULL OR char_length(institution) BETWEEN 1 AND 40),
  ADD COLUMN color text CHECK (color IS NULL OR color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN icon text CHECK (icon IS NULL OR icon IN ('wallet', 'bank', 'piggy', 'cash', 'card', 'chart', 'phone', 'building')),
  ADD COLUMN archived boolean NOT NULL DEFAULT false,
  ADD COLUMN overdraft_limit_cents bigint CHECK (overdraft_limit_cents IS NULL OR overdraft_limit_cents > 0),
  ADD CONSTRAINT accounts_cheque_especial CHECK (overdraft_limit_cents IS NULL OR type = 'checking');

-- Ajuste de conciliação: corrige o saldo para bater com o extrato do banco.
-- Mexe no saldo, mas não é receita nem despesa (fica fora dos relatórios).
ALTER TABLE transactions ADD COLUMN is_adjustment boolean NOT NULL DEFAULT false;
ALTER TABLE transactions ADD CONSTRAINT transactions_ajuste_valido
  CHECK (NOT is_adjustment OR (type IN ('income', 'expense') AND card_kind IS NULL AND series_id IS NULL));

CREATE OR REPLACE VIEW report_transactions AS
  SELECT t.id, t.user_id, t.category_id, t.date, t.paid, t.account_id,
         CASE WHEN t.card_kind = 'refund' THEN 'expense' ELSE t.type END AS type,
         CASE WHEN t.card_kind = 'refund' THEN -t.amount_cents ELSE t.amount_cents END AS amount_cents
    FROM transactions t
   WHERE (t.card_kind IS NULL OR t.card_kind NOT IN ('invoice_credit', 'invoice_installment'))
     AND NOT t.is_adjustment;

-- Conciliações feitas: saldo do extrato x saldo do app numa data, e o ajuste lançado (se houve).
CREATE TABLE account_reconciliations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date                 date NOT NULL,
  statement_cents      bigint NOT NULL,
  system_cents         bigint NOT NULL,
  adjustment_id        uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_reconciliations_account_idx ON account_reconciliations (account_id, created_at DESC);

-- Auditoria: toda criação, alteração e exclusão de conta ou lançamento fica registrada pelo banco
-- (vale para o app, o WhatsApp e qualquer outro caminho), com o antes e o depois.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL,
  entity     text NOT NULL CHECK (entity IN ('account', 'transaction')),
  entity_id  uuid NOT NULL,
  action     text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  before     jsonb,
  after      jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_id, at DESC);

CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entity text := CASE TG_TABLE_NAME WHEN 'accounts' THEN 'account' ELSE 'transaction' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, entity, entity_id, action, after) VALUES (NEW.user_id, entity, NEW.id, 'insert', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      INSERT INTO audit_log (user_id, entity, entity_id, action, before, after)
      VALUES (NEW.user_id, entity, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSE
    -- Usuário sendo apagado: o histórico vai junto (não fica registro órfão).
    IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
      INSERT INTO audit_log (user_id, entity, entity_id, action, before) VALUES (OLD.user_id, entity, OLD.id, 'delete', to_jsonb(OLD));
    END IF;
    RETURN OLD;
  END IF;
END $$;

CREATE TRIGGER accounts_audit AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER transactions_audit AFTER INSERT OR UPDATE OR DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Apagar o usuário apaga o histórico dele.
CREATE FUNCTION audit_cleanup_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM audit_log WHERE user_id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER users_audit_cleanup AFTER DELETE ON users FOR EACH ROW EXECUTE FUNCTION audit_cleanup_user();
