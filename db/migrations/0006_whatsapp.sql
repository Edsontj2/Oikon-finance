-- Assistente pelo WhatsApp (Cloud API oficial da Meta). Ele usa os mesmos serviços do app:
-- estas tabelas guardam só o vínculo, as mensagens e as operações aguardando confirmação.

-- Um número de WhatsApp por usuário. O vínculo só nasce com um código gerado dentro do app
-- logado (o número, sozinho, não prova identidade).
CREATE TABLE IF NOT EXISTS whatsapp_links (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone                text NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{8,15}$'),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  default_account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  allow_entries        boolean NOT NULL DEFAULT true,
  linked_at            timestamptz NOT NULL DEFAULT now()
);

-- Código de 6 dígitos para vincular; guardado só como hash, vale 10 minutos.
CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0
);

-- Toda mensagem recebida, pelo id do WhatsApp: o webhook reenviado não é processado duas vezes.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id           text PRIMARY KEY,
  phone        text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  body         text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  reply        text CHECK (char_length(reply) <= 4096),
  status       text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'error', 'ignored')),
  error        text CHECK (char_length(error) <= 500),
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_user_idx ON whatsapp_messages (user_id, received_at DESC);

-- Operação montada a partir da conversa, esperando o que falta ou a confirmação.
-- No máximo uma aberta por usuário; ao confirmar, vira lançamento pelo serviço normal.
CREATE TABLE IF NOT EXISTS whatsapp_pending_ops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft            jsonb NOT NULL,
  missing          text,
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'confirmed', 'cancelled', 'expired', 'failed')),
  transaction_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  closed_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_pending_one_open ON whatsapp_pending_ops (user_id) WHERE state = 'open';
