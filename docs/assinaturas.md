# Assinaturas e planos

## Estado atual
- Planos (Essencial, Inteligente, Premium), preços e franquias de IA ficam na tabela `plans`.
  O que cada plano libera está em `src/domain/plans.ts`.
- Configurações em `app_settings` (alteráveis pelo painel administrativo):
  `billing_enforced` (bloqueio por plano), `plans_public` (planos e teste grátis visíveis),
  `trial_days`, `trial_plan`, `trial_ai_quota`, `grace_days`, `checkout_hours`, `legacy_ai_quota`.
- **Cobrança desligada**: `billing_enforced = false`; ninguém perde acesso ao que já usa.
- **Planos escondidos**: `plans_public = false` até o OIKON IA estar no ar.
- **Nenhum gateway de pagamento** está ligado: não há botão de pagar.

## Regras
- Teste grátis: um por conta, `trial_days` dias no plano `trial_plan`, com `trial_ai_quota` interações.
- Assinatura só fica ativa com evento de pagamento confirmado pelo gateway (webhook
  `/api/pagamentos/<gateway>`, idempotente pelo id do evento) ou concessão manual do admin.
- Renovação: novo período a partir do fim do anterior. Sem pagamento: "em atraso" com acesso
  por `grace_days` dias; depois expira.
- Cancelamento: assinatura paga continua até o fim do período (pode ser desfeito); teste e
  contratação não paga terminam na hora.
- Plano maior: nova contratação (ativa ao pagar, encerrando a anterior). Plano menor: no fim do período.
- Oferta de lançamento (`launch_offer`): preço especial nas primeiras `slot_limit` vagas do plano
  configurado. A vaga é reservada ao contratar (atômico, nunca passa do limite), segura por
  `checkout_hours`, mantida em renovações, atraso dentro da tolerância e cancelamento agendado;
  perdida quando a assinatura termina ou troca de plano, e então volta para a oferta.
- Franquia de IA mensal compartilhada entre app e WhatsApp (`ai_usage`), reservada de forma
  atômica antes de cada chamada ao modelo e devolvida se o modelo falhar.

## Para ativar cobranças reais (precisa da sua decisão)
1. Escolher o gateway (ex.: Mercado Pago, Asaas, Stripe, Pagar.me).
2. Implementar o adaptador em `src/lib/billing.ts` (criar pagamento recorrente + conferir webhook).
3. Configurar na Vercel `BILLING_PROVIDER` e as chaves do gateway.
4. Cadastrar a URL do webhook no painel do gateway.
5. No painel administrativo: ligar `plans_public` e, quando quiser, `billing_enforced`.

## Administrador
Papel `admin` em `users.role`, ou e-mail em `OIKON_ADMIN_EMAILS` (separados por vírgula) na Vercel.
