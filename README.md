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

## App Android (notificações do banco)

- Código em `android/` (Kotlin, só APIs do Android, sem bibliotecas extras). O GitHub Actions (`.github/workflows/android.yml`) gera o APK a cada mudança em `android/` e publica em **Releases** (`oikon.apk`, link fixo `releases/latest/download/oikon.apk`).
- O app lê as notificações só dos apps de banco que a pessoa marcar (NotificationListenerService, com permissão explícita), descarta no próprio celular o que não tem valor em R$, guarda numa fila local (envia quando houver internet, com novas tentativas) e manda para `POST /api/app/notificacoes` com o token do celular.
- Vínculo: o site gera um código de 8 dígitos (10 min, uma vez) em **Notificações do banco**; o app troca por um token (`/api/app/vincular`) guardado cifrado no Android Keystore. No banco fica só o hash. Desvincular no site corta o acesso na hora.
- O leitor (`src/domain/bank-notification.ts`, regras fixas) identifica compra, Pix, transferência, pagamento, estorno, recusa e propaganda; sugere a conta pelo final do cartão ou pelo banco e a categoria pelo histórico. **Nada é lançado sozinho**: cada notificação espera confirmação no site (e avisa se parece já lançada). Reenviar não duplica (id gerado no celular).
- Assinatura: sem segredos, usa `android/app/dev.keystore` (atualizações instalam por cima). Para a Play Store, configure os segredos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`.
- iPhone: a Apple não permite ler notificações de outros apps; use a importação de extrato.

## Relatório e exportação

- **Mais → Relatório** (`/relatorio?mes=`): resumo do mês, gastos por categoria (com limites), contas, cartões, dívidas e lançamentos. O botão "Salvar em PDF" abre a impressão do navegador; o estilo de impressão tira o menu e as cores (fundo branco, 1 página quando cabe).
- **Exportar CSV** (`/api/exportar?mes=`): todos os lançamentos do mês (ou todos, sem `mes`), separador `;` e vírgula decimal para abrir direto no Excel. Texto que começa com `=`, `+`, `-` ou `@` ganha um apóstrofo para não virar fórmula. Exige login.

## Importar extrato (OFX e CSV)

- Em **Mais → Importar extrato** (ou na tela da conta), escolha a conta e envie o arquivo. OFX é o mais confiável (traz o identificador de cada lançamento); CSV com cabeçalho também serve (Data, Descrição/Histórico, Valor ou Débito/Crédito). Planilha do Excel: salve como CSV.
- Antes de gravar, cada linha aparece como **Novo**, **Já lançado** (lançado à mão e pago, ±3 dias), **Confirma um pendente** (conta pendente paga até 10 dias antes do vencimento: vira paga na data do extrato) ou **Já importado**. A categoria é sugerida pela última usada numa descrição igual.
- O identificador da linha fica em `transactions.import_ref` (único por conta, migração 0013): reimportar o mesmo arquivo não duplica nada. Linhas de saldo e valor zero são ignoradas; nada é inventado.

## Planejamento, metas e panorama

- **Todo mês (sem fim):** o lançamento recorrente gera um lançamento por mês quando o mês chega (pendente), até a pessoa excluir com "Parar de repetir". Os meses futuros não existem no banco, por isso o pendente mostra só o mês atual (`recurring_rules`, migração 0010).
- **Subcategorias:** um nível, do mesmo tipo da principal. O limite da principal vale para ela e as filhas juntas; painel e orçamento somam as filhas na principal (migração 0011).
- **Planejamento** (`/planejamento`):
  - Previsão do dinheiro nas contas em 7, 15, 30, 60 e 90 dias: pendentes e agendados, meses futuros dos recorrentes e faturas no vencimento (menos pagamentos já agendados). Compras no cartão só entram pela fatura. Avisa o dia em que o saldo ficaria negativo.
  - Orçamento do mês: planejado (limites) × realizado, alerta a partir de 80%, gasto acima da média dos 3 meses anteriores e recorrentes previstos nos meses futuros.
- **Metas** (`/metas`): objetivos com valor e data (quanto guardar por mês e se está no ritmo) e reserva de emergência sugerida pelo gasto médio × meses. O progresso vem do saldo de uma conta ligada ou de um valor anotado à mão (que não mexe em saldo nenhum).
- **Painel:** panorama com dinheiro nas contas, patrimônio líquido, faturas a pagar e limite livre, dívidas, renda comprometida (parcelas e contas fixas ÷ renda média) e a evolução do patrimônio em 12 meses.

## Agenda, dívidas e empréstimos

- **Agenda** (contas a pagar e a receber): junta tudo que está pendente (lançamentos não pagos,
  parcelas de empréstimo e faturas de cartão fechadas), agrupado em atrasadas, hoje, 7 dias, 30 dias
  e até 90 dias, com o botão de marcar como pago.
- **Dívidas e empréstimos:** cada empréstimo é uma conta do tipo "Empréstimo ou dívida". As
  parcelas (Price ou SAC, calculadas em `src/domain/loans.ts`) são transferências da conta pagadora
  para o empréstimo; os juros de cada parcela entram como gasto na data do vencimento. Também vale
  para dinheiro que você emprestou (juros entram como receita).
- **Simulador:** compara Price e SAC (parcela, total e juros) antes de contratar.
- **Quitação antecipada:** registre o valor informado pelo banco; as parcelas futuras somem e a
  diferença para o saldo vira encargo (pagou mais) ou ajuste de desconto (pagou menos, fora dos
  relatórios). Tudo gravado num único comando, com chave contra envio duplicado.

## Contas

Cada conta tem tipo (corrente, poupança, dinheiro, cartão ou **investimento**), instituição, cor e
ícone. Conta corrente pode ter **cheque especial**: o app avisa quando está em uso e mostra quanto
resta, mas não conta o limite como dinheiro seu.

- **Arquivar:** esconde a conta das listas de escolha e mantém todo o histórico. Só com saldo zerado
  e sem lançamentos pendentes ou futuros, para os totais não mudarem.
- **Conciliação:** em *Contas → conta → Conciliar e histórico*, informe o saldo do extrato numa data.
  Se for diferente do app, é lançado um **ajuste** que corrige o saldo e fica fora dos relatórios
  (não é receita nem despesa). Cada conferência fica registrada.
- **Auditoria:** o banco registra toda criação, alteração e exclusão de contas e lançamentos (pelo app,
  pelo WhatsApp ou por qualquer outro caminho), com o antes e o depois (`audit_log`, migração 0008).

## Cartões de crédito

O cartão é uma conta do tipo "Cartão de crédito" com limite, dia de fechamento, dia de vencimento,
conta pagadora, bandeira e final (tela **Cartões**). As faturas não são uma tabela: são calculadas dos
lançamentos do cartão (`src/domain/cards.ts`), então nunca ficam fora de sincronia.

- Compra antes do dia de fechamento entra na fatura que fecha naquele mês; no dia do fechamento ou
  depois, na seguinte. A fatura é identificada pelo mês do vencimento. Dá para mover um lançamento
  para outra fatura à mão.
- Pagar a fatura é uma transferência da conta pagadora para o cartão (não conta como gasto de novo).
  Pagamento parcial é aceito: depois do vencimento, o que faltou vai para a fatura seguinte (rotativo).
- Estorno abate a fatura e o gasto da categoria (não vira receita). Juros, multa/tarifa/anuidade e IOF
  são lançados com o valor que o banco cobrou: o app não inventa taxas.
- Parcelar a fatura: informe parcelas e valor oferecidos pelo banco; a fatura é quitada, as parcelas
  entram nas próximas e só a diferença (juros) conta como gasto novo.
- Limite disponível = limite − tudo o que ainda vai ser cobrado (inclui parcelas futuras). Mudanças de
  limite ficam no histórico.
- Relatórios usam a view `report_transactions` (migração 0007) para aplicar essas regras em todo lugar.

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

Passo a passo detalhado: [docs/configurar-whatsapp.md](docs/configurar-whatsapp.md).

Respostas são enviadas dentro da janela de atendimento de 24 horas aberta pela mensagem da pessoa. Lembretes fora dessa janela exigem modelos de mensagem aprovados pela Meta (próxima etapa).

## Deploy (Vercel)

Defina `DATABASE_URL` e `AUTH_SECRET` nas variáveis de ambiente do projeto. As migrações rodam sozinhas no build de produção (`vercel-build`); os previews não mexem no banco. O `.vercelignore` impede que o `.env` seja enviado junto com o código.
