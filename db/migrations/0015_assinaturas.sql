-- Planos, assinaturas, oferta de lançamento, uso de IA e eventos de pagamento.
-- Só cria tabelas e colunas novas: nada existente é alterado ou apagado.
-- Enquanto a cobrança não for ativada (app_settings.billing_enforced = false), ninguém perde
-- acesso ao que já usa hoje: os planos passam a valer quando o administrador ativar.

-- Papel do usuário: só "admin" vê o painel administrativo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));

-- Configurações que o administrador muda sem novo deploy.
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO app_settings (key, value) VALUES
  ('billing_enforced', 'false'),   -- bloqueio por plano desligado até a cobrança existir
  ('plans_public', 'false'),       -- planos e teste grátis aparecem só quando o OIKON IA estiver no ar
  ('trial_days', '7'),
  ('trial_plan', '"inteligente"'),
  ('trial_ai_quota', '30'),        -- interações de IA durante o teste
  ('grace_days', '3'),             -- dias de tolerância após um pagamento falhar
  ('checkout_hours', '24'),        -- quanto tempo uma contratação espera o pagamento (e segura a vaga da oferta)
  ('legacy_ai_quota', '0')         -- IA para quem não tem assinatura enquanto a cobrança está desligada
ON CONFLICT (key) DO NOTHING;

-- Planos: preço e franquia de IA ficam aqui (o administrador ajusta); o que cada plano libera
-- é definido no código (src/domain/plans.ts), por ser parte do produto.
CREATE TABLE IF NOT EXISTS plans (
  id           text PRIMARY KEY CHECK (id IN ('essencial', 'inteligente', 'premium')),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  price_cents  integer NOT NULL CHECK (price_cents BETWEEN 0 AND 100000),
  ai_quota     integer NOT NULL CHECK (ai_quota BETWEEN 0 AND 100000),
  sort         integer NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plans (id, name, price_cents, ai_quota, sort) VALUES
  ('essencial', 'OIKON Essencial', 1290, 0, 1),
  ('inteligente', 'OIKON Inteligente', 2490, 300, 2),
  ('premium', 'OIKON Premium', 3490, 1000, 3)
ON CONFLICT (id) DO NOTHING;

-- Oferta de lançamento: contador único (uma linha). Reservar uma vaga é um UPDATE com
-- "claimed < slot_limit": o Postgres reavalia a condição depois de esperar a trava da linha,
-- então duas pessoas ao mesmo tempo nunca passam do limite.
CREATE TABLE IF NOT EXISTS launch_offer (
  id           integer PRIMARY KEY CHECK (id = 1),
  enabled      boolean NOT NULL DEFAULT true,
  plan_id      text NOT NULL REFERENCES plans(id),
  price_cents  integer NOT NULL CHECK (price_cents BETWEEN 0 AND 100000),
  slot_limit   integer NOT NULL CHECK (slot_limit >= 0),
  claimed      integer NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  CHECK (claimed <= slot_limit OR NOT enabled)
);
INSERT INTO launch_offer (id, plan_id, price_cents, slot_limit) VALUES (1, 'inteligente', 1990, 100)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id               text NOT NULL REFERENCES plans(id),
  status                text NOT NULL CHECK (status IN ('trialing', 'pending', 'active', 'past_due', 'canceled', 'expired')),
  trial                 boolean NOT NULL DEFAULT false,
  price_cents           integer NOT NULL CHECK (price_cents BETWEEN 0 AND 100000), -- preço travado na contratação
  launch_offer          boolean NOT NULL DEFAULT false,
  current_period_start  timestamptz NOT NULL DEFAULT now(),
  current_period_end    timestamptz NOT NULL,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  pending_plan_id       text REFERENCES plans(id), -- troca para um plano menor no fim do período
  past_due_since        timestamptz,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  provider              text CHECK (provider ~ '^[a-z_]{2,30}$'),
  provider_ref          text CHECK (char_length(provider_ref) <= 200),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- No máximo uma assinatura em vigor por pessoa (e uma contratação aguardando pagamento),
-- e um único teste grátis na vida.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_current ON subscriptions (user_id)
  WHERE status IN ('trialing', 'active', 'past_due');
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_pending ON subscriptions (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_trial ON subscriptions (user_id) WHERE trial;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_ref ON subscriptions (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id, created_at DESC);

-- Quem está usando uma vaga da oferta de lançamento (uma por pessoa).
CREATE TABLE IF NOT EXISTS launch_offer_claims (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  subscription_id  uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  claimed_at       timestamptz NOT NULL DEFAULT now()
);

-- Histórico de tudo que acontece com uma assinatura (auditoria).
CREATE TABLE IF NOT EXISTS subscription_events (
  id               bigserial PRIMARY KEY,
  subscription_id  uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind ~ '^[a-z_]{2,40}$'),
  data             jsonb NOT NULL DEFAULT '{}',
  actor            text NOT NULL DEFAULT 'system' CHECK (actor IN ('user', 'system', 'payment', 'admin')),
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_events_sub_idx ON subscription_events (subscription_id, at DESC);

-- Eventos do gateway de pagamento: o id do evento é a chave, então reenvios não repetem nada.
CREATE TABLE IF NOT EXISTS payment_events (
  id            text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 200),
  provider      text NOT NULL CHECK (provider ~ '^[a-z_]{2,30}$'),
  type          text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 80),
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'error')),
  error         text CHECK (char_length(error) <= 500),
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  PRIMARY KEY (provider, id)
);

-- Uso de IA por mês (franquia compartilhada entre app e WhatsApp). Somar uma interação é um
-- único INSERT ... ON CONFLICT DO UPDATE ... WHERE total < franquia: atômico, sem passar do limite.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  interactions    integer NOT NULL DEFAULT 0 CHECK (interactions >= 0),
  app_count       integer NOT NULL DEFAULT 0 CHECK (app_count >= 0),
  whatsapp_count  integer NOT NULL DEFAULT 0 CHECK (whatsapp_count >= 0),
  input_tokens    bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens   bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_micros     bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0), -- custo estimado em milionésimos de dólar
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);
CREATE INDEX IF NOT EXISTS ai_usage_period_idx ON ai_usage (period);
