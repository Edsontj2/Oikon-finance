-- Sessões no banco: sair encerra a sessão de verdade, e apagar o usuário derruba as sessões dele.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Cada formulário enviado leva uma chave única; a mesma chave não é processada duas vezes
-- (evita lançamento duplicado com duplo clique ou reenvio).
CREATE TABLE form_submissions (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Registro de tentativas para limitar login e cadastro.
CREATE TABLE rate_limit_hits (
  bucket text NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_hits_bucket_idx ON rate_limit_hits (bucket, hit_at);

-- Limites de tamanho também no banco (NOT VALID: vale para dados novos, sem travar os antigos).
ALTER TABLE users ADD CONSTRAINT users_name_len CHECK (char_length(name) BETWEEN 1 AND 80) NOT VALID;
ALTER TABLE users ADD CONSTRAINT users_email_len CHECK (char_length(email) BETWEEN 3 AND 254) NOT VALID;
ALTER TABLE accounts ADD CONSTRAINT accounts_name_len CHECK (char_length(name) BETWEEN 1 AND 60) NOT VALID;
ALTER TABLE categories ADD CONSTRAINT categories_name_len CHECK (char_length(name) BETWEEN 1 AND 60) NOT VALID;
ALTER TABLE transactions ADD CONSTRAINT transactions_description_len CHECK (char_length(description) BETWEEN 1 AND 120) NOT VALID;
