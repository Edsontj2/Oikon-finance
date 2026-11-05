-- 0014: app Android que lê as notificações dos bancos.
-- O celular é vinculado com um código de 8 dígitos gerado no site (logado) e recebe um token
-- que só ele guarda; no banco fica só o hash. As notificações chegam como indícios: viram
-- lançamento só depois que a pessoa confirma (nada é lançado sozinho).
CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX devices_user_idx ON devices (user_id);

CREATE TABLE device_link_codes (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE bank_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      uuid REFERENCES devices(id) ON DELETE SET NULL,
  -- Identificador gerado no celular: reenviar a mesma notificação não duplica.
  external_id    text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 100),
  package        text NOT NULL CHECK (length(package) <= 120),
  app_name       text CHECK (length(app_name) <= 80),
  title          text CHECK (length(title) <= 200),
  body           text NOT NULL CHECK (length(body) <= 1000),
  posted_at      timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored', 'discarded')),
  -- O que o leitor entendeu (tipo, valor, cartão, conta sugerida, confiança).
  parsed         jsonb NOT NULL DEFAULT '{}'::jsonb,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  UNIQUE (user_id, external_id)
);
CREATE INDEX bank_notifications_user_idx ON bank_notifications (user_id, status, posted_at DESC);

ALTER TABLE users ADD COLUMN bank_notifications_paused boolean NOT NULL DEFAULT false;
