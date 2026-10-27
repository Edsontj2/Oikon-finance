# Oikon Finance

Controle financeiro pessoal simples. Versão enxuta do Oikon: **4 partes** em vez de 15 módulos.

| Parte | O que faz | Substitui (versão antiga) |
|---|---|---|
| **Contas** | Banco, poupança, dinheiro e cartão de crédito, cada um com saldo | contas, cartões |
| **Lançamentos** | Entrada (soma), saída (subtrai) ou transferência entre contas. Pode ficar *pendente* e pode *repetir todo mês* | lançamentos, transferências, contas a pagar/receber, dívidas, empréstimos, recorrências |
| **Categorias** | Agrupam entradas e saídas; saídas podem ter limite mensal | categorias, orçamentos |
| **Painel** | Saldo total, resultado do mês, a pagar/receber, gastos por categoria e uma **análise automática** do mês | dashboard, fluxo de caixa, relatórios |

Criar, editar e excluir acontece em janelas (modais), sem sair da lista. Lançamentos mostra todos os meses por padrão, com filtros de período, conta, tipo e busca.

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

## Deploy (Vercel)

Defina `DATABASE_URL` e `AUTH_SECRET` nas variáveis de ambiente do projeto. As migrações rodam sozinhas no build de produção (`vercel-build`); os previews não mexem no banco. O `.vercelignore` impede que o `.env` seja enviado junto com o código.
