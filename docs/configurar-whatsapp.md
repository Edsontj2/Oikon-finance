# Configurar o assistente do WhatsApp (Meta + Vercel)

Endereço do webhook do OIKON:

```
https://oikon-finance.vercel.app/api/whatsapp/webhook
```

A ordem importa: a Meta só aceita o webhook se o site já tiver o token de verificação. Por isso,
primeiro cadastre as chaves na Vercel (passo 4), publique de novo e só depois verifique o webhook (passo 5).

## 1. Criar o app na Meta

1. Entre em https://developers.facebook.com → **Meus apps → Criar app**.
2. Tipo **Empresa (Business)**; vincule ao seu Portfólio empresarial (Business Manager).
3. No painel do app, em **Adicionar produtos**, escolha **WhatsApp → Configurar**.

## 2. Número e token

1. Em **WhatsApp → Configuração da API**:
   - Use o número de teste da Meta ou adicione o seu número comercial (ele não pode estar em uso
     no app WhatsApp comum).
   - Anote o **Identificação do número de telefone** (Phone number ID) → vai em `WHATSAPP_PHONE_NUMBER_ID`.
   - Com o número de teste, cadastre o seu celular em **Para** (lista de destinatários permitidos).
2. Token **permanente** (o temporário expira em 24 h):
   - business.facebook.com → **Configurações do negócio → Usuários → Usuários do sistema → Adicionar**
     (função Administrador).
   - **Atribuir ativos** → o app → controle total.
   - **Gerar novo token** → escolha o app → marque `whatsapp_business_messaging` e
     `whatsapp_business_management` → validade **Nunca** → copie → vai em `WHATSAPP_TOKEN`.

## 3. Chave secreta do app

**Configurações do app → Básico → Chave secreta do app → Mostrar** → vai em `WHATSAPP_APP_SECRET`.
É ela que garante que só a Meta consegue mandar mensagens para o webhook.

## 4. Cadastrar as variáveis na Vercel

vercel.com → projeto **oikon-finance** → **Settings → Environment Variables** → ambiente **Production**:

| Variável | Valor |
|---|---|
| `WHATSAPP_VERIFY_TOKEN` | Um texto que você inventa (ex.: 30 letras e números aleatórios). Vai ser repetido na Meta no passo 5. |
| `WHATSAPP_APP_SECRET` | Chave secreta do app (passo 3) |
| `WHATSAPP_TOKEN` | Token permanente (passo 2) |
| `WHATSAPP_PHONE_NUMBER_ID` | Id do número de telefone (passo 2) |
| `WHATSAPP_DISPLAY_NUMBER` | Número do bot só com dígitos e DDI, ex.: `5511999998888` (usado no link "Abrir WhatsApp" do app) |
| `WHATSAPP_API_VERSION` | Opcional. Padrão `v21.0` |

Depois de salvar: **Deployments → último deploy → ⋯ → Redeploy** (as variáveis só valem num deploy novo).
Se preferir, me avise que eu publico.

## 5. Ligar o webhook

1. Na Meta: **WhatsApp → Configuração → Webhook → Editar**.
   - URL de callback: `https://oikon-finance.vercel.app/api/whatsapp/webhook`
   - Verificar token: o mesmo texto de `WHATSAPP_VERIFY_TOKEN`
   - **Verificar e salvar** (se der erro, confira se o redeploy do passo 4 terminou).
2. Em **Campos do webhook**, clique em **Assinar** no campo **messages**.

## 6. Vincular o seu número

1. No OIKON: ícone de engrenagem → **Configurações → Assistente no WhatsApp → Gerar código de vínculo**.
2. Envie para o número do bot: `vincular 123456` (o código vale 10 minutos).
3. Teste: `Quanto tenho de dinheiro?` ou `Gastei 20 no mercado` → responda **sim** para confirmar.

## Problemas comuns

- **Não responde nada:** o campo *messages* não foi assinado, ou o seu número não está na lista
  de destinatários do número de teste. Veja o histórico em *Configurações → WhatsApp*.
- **"Não está vinculado":** gere um código novo no app e envie `vincular` + código.
- **Erro 401 no webhook:** `WHATSAPP_APP_SECRET` diferente da chave do app.
- **Parou de responder depois de um dia:** foi usado o token temporário; gere o permanente (passo 2).
- Mensagens só são enviadas em até 24 h depois da última mensagem sua (regra da Meta). Lembretes
  automáticos fora dessa janela precisam de modelos aprovados (próxima etapa).

Nunca mande essas chaves por chat ou e-mail; cadastre direto na Vercel.
