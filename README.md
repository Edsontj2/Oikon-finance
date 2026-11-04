# Oikon Finance

Controle financeiro pessoal simples. Versão enxuta do Oikon: **4 partes** em vez de 15 módulos.

| Parte | O que faz | Substitui (versão antiga) |
|---|---|---|
| **Contas** | Banco, poupança, dinheiro e cartão de crédito, cada um com saldo | contas, cartões |
| **Lançamentos** | Entrada (soma), saída (subtrai) ou transferência entre contas. Pode ficar *pendente* e pode *repetir todo mês* | lançamentos, transferências, contas a pagar/receber, dívidas, empréstimos, recorrências |
| **Categorias** | Agrupam entradas e saídas; saídas podem ter limite mensal | categorias, orçamentos |
| **Painel** | Saldo total, resultado do mês, a pagar/receber, gastos por categoria e uma **análise automática** do mês | dashboard, fluxo de caixa, relatórios |

Criar, editar e excluir acontece em janelas (modais), sem sair da lista. Um lançamento pode ser **uma vez**, **parcelado** (o app divide o total, mostra o valor de cada parcela e o dia e mês em que termina; cada parcela aparece como 3/10) ou **todo mês** (assinaturas, aluguel). No cartão de crédito cada parcela entra sozinha na fatura do mês dela.

O painel mostra, além dos totais: ritmo do mês (quanto dá para gastar por dia, média diária, sobra prevista, quanto guardou), parcelamentos em aberto (quanto falta, quanto compromete por mês e quando fica livre) e entradas × saídas dos últimos 6 meses. Lançamentos mostra todos os meses por padrão, com filtros de período, conta, tipo e busca.

Funciona como app no celular (PWA): pode ser instalado na tela inicial, não dá zoom ao tocar nos campos e se ajusta ao entalhe do iPhone. Dados financeiros nunca ficam guardados offline.

## Como o saldo é calculado

```
saldo atual = saldo inicial
            + entradas pagas
            − saídas pagas
            − transferências que saíram + transferências que entraram
```

- Lançamento **pendente** não mexe no saldo atual até ser marcado como pago (a tela de contas mostra também o saldo "com pendentes").
- Lançamento pago com **data no futuro** só entra no saldo atual quando a data chegar (até lá aparece no "com pendentes").
- Cada valor vai até **R$ 1 bilhão**; assim as somas nunca perdem precisão.
- **Transferência** não conta como ganho nem gasto: só muda o dinheiro de conta.
- **Cartão de crédito**: cada compra é uma saída na conta do cartão (saldo fica negativo). Pagar a fatura é uma transferência do banco para o cartão.
- **Repetir todo mês** cria um lançamento por mês; só o primeiro herda "pago", os seguintes ficam pendentes. Dia 31 vira o último dia em meses mais curtos.
- Valores são guardados em centavos (inteiros), então não há erro de arredondamento.

## Tecnologia

Next.js 16 (App Router, server actions), PostgreSQL via `pg`, sessão em cookie assinado (`jose`) e senha com `bcryptjs`. Sem ORM: o banco está em [`db/migrations`](db/migrations), aplicadas em ordem e uma única vez (tabela `schema_migrations`). As regras sem banco (tipos, limites, análise do painel) ficam em `src/domain`; o acesso ao banco em `src/data`.

### Análise do painel

Regras simples e explicáveis em [`src/domain/insights.ts`](src/domain/insights.ts): lançamentos atrasados, conta no negativo, categoria perto ou acima do limite, contas que vencem em 7 dias, previsão do saldo no fim do mês, gastos comparados com a média dos 3 meses anteriores, categoria que cresceu e quanto você guardou do que recebeu. Mostra no máximo 5, as graves primeiro.

### Segurança

Sessões gravadas no banco (sair invalida o cookie), limite de tentativas de login e cadastro, chave por envio de formulário (duplo clique não duplica), CSP com nonce e cabeçalhos de proteção em `src/proxy.ts`.

## Rodando

```bash
cp .env.example .env.local   # preencha DATABASE_URL e AUTH_SECRET
npm install
DATABASE_URL=... npm run db:migrate
npm run dev
```

## Testes

Precisam de um Postgres **só para teste** (as tabelas são apagadas a cada execução):

```bash
export TEST_DATABASE_URL=postgres://oikon:oikon@localhost:5432/oikon_test
npm test           # cálculos + somas/subtrações no banco
npm run test:e2e   # o app inteiro no navegador (Playwright)
```

- `tests/unit` — conversão de valores ("1.234,56"), datas e fuso, sessão, análise do painel.
- `tests/integration/saldos.test.ts` — entrada soma, saída subtrai, pendentes, transferências, cartão, repetir todo mês, resumo do mês, validações e isolamento entre usuários.
- `tests/integration/criticos.test.ts` e `casos-limite.test.ts` — duplo envio, sessão encerrada, usuário apagado, limites de tamanho e valor, virada de ano.
- `e2e/app.spec.ts` — cadastro, login, criar conta, lançar, editar, marcar pago, transferir, excluir, categorias com limite e sair, conferindo os saldos na tela a cada passo.
- `e2e/criticos.spec.ts` — duplo clique, cookie após sair, tentativas de login, formulário adulterado, outra pessoa, celular sem zoom nem rolagem lateral.

O e2e usa um banco separado (`E2E_DATABASE_URL`, padrão `oikon_e2e`).

## Assistente no WhatsApp

Conversa com o mesmo backend do app: não tem lógica financeira própria. A mensagem é interpretada por regras fixas (`src/domain/assistant/parser.ts`, sem IA, então um texto não consegue "mandar" o sistema fazer outra coisa), vira uma operação pendente e, depois do **sim**, é gravada pelo mesmo `createTransaction` do app.

- **Vínculo seguro:** o número só acessa a conta depois de enviar `vincular 123456`, código gerado em *Configurações → WhatsApp* com a pessoa logada (vale 10 minutos, uma vez, com limite de tentativas). O número sozinho não prova identidade.
- **Confirmação sempre:** todo lançamento mostra um resumo; a confirmação fecha a operação numa única atualização e usa a própria operação como chave de envio, então confirmar duas vezes não grava duas vezes. A operação expira em 15 minutos e pode ser cancelada.
- **Sem duplicidade:** cada mensagem é guardada pelo id do WhatsApp; webhook reenviado não é processado de novo.
- **Webhook:** `GET/POST /api/whatsapp/webhook`. Responde 200 na hora e processa depois; o POST só é aceito com a assinatura `X-Hub-Signature-256` válida.
- **O que entende:** despesas, receitas, transferências entre contas próprias (sem Pix real), compras parceladas no cartão, pagamento de fatura (transferência para o cartão, não é nova despesa), contas a pagar agendadas, "marcar ... como paga" e consultas (saldo, gastos, recebidos, quanto posso gastar, contas que vencem, atrasadas, cartões, parcelamentos, previsão, resumo, maiores despesas). Envie *ajuda* para ver exemplos.

### Configurar na Meta

1. Crie um app do tipo *Business* em developers.facebook.com e adicione o produto **WhatsApp**.
2. Em *WhatsApp → Configuração da API*, anote o **id do número de telefone** e gere um **token permanente** (usuário do sistema com `whatsapp_business_messaging`).
3. Em *WhatsApp → Configuração → Webhook*, use a URL `https://SEU-DOMINIO/api/whatsapp/webhook`, o mesmo texto de `WHATSAPP_VERIFY_TOKEN` e assine o campo **messages**.
4. Em *Configurações do app → Básico*, copie a **chave secreta do app**.
5. Preencha as variáveis `WHATSAPP_*` (veja `.env.example`) no projeto da Vercel e publique de novo.

Respostas são enviadas dentro da janela de atendimento de 24 horas aberta pela mensagem da pessoa. Lembretes fora dessa janela exigem modelos de mensagem aprovados pela Meta (próxima etapa).

## Deploy (Vercel)

Defina `DATABASE_URL` e `AUTH_SECRET` nas variáveis de ambiente do projeto. As migrações rodam sozinhas no build de produção (`vercel-build`); os previews não mexem no banco. O `.vercelignore` impede que o `.env` seja enviado junto com o código.
