# Oikon Finance

Controle financeiro pessoal simples. Versão enxuta do Oikon: **4 partes** em vez de 15 módulos.

| Parte | O que faz | Substitui (versão antiga) |
|---|---|---|
| **Contas** | Banco, poupança, dinheiro e cartão de crédito, cada um com saldo | contas, cartões |
| **Lançamentos** | Entrada (soma), saída (subtrai) ou transferência entre contas. Pode ficar *pendente* e pode *repetir todo mês* | lançamentos, transferências, contas a pagar/receber, dívidas, empréstimos, recorrências |
| **Categorias** | Agrupam entradas e saídas; saídas podem ter limite mensal | categorias, orçamentos |
| **Painel** | Saldo total, resultado do mês, a pagar/receber, atrasados e gastos por categoria | dashboard, fluxo de caixa, relatórios |

## Como o saldo é calculado

```
saldo atual = saldo inicial
            + entradas pagas
            − saídas pagas
            − transferências que saíram + transferências que entraram
```

- Lançamento **pendente** não mexe no saldo atual até ser marcado como pago (a tela de contas mostra também o saldo "com pendentes").
- **Transferência** não conta como ganho nem gasto: só muda o dinheiro de conta.
- **Cartão de crédito**: cada compra é uma saída na conta do cartão (saldo fica negativo). Pagar a fatura é uma transferência do banco para o cartão.
- **Repetir todo mês** cria um lançamento por mês; só o primeiro herda "pago", os seguintes ficam pendentes. Dia 31 vira o último dia em meses mais curtos.
- Valores são guardados em centavos (inteiros), então não há erro de arredondamento.

## Tecnologia

Next.js 16 (App Router, server actions), PostgreSQL via `pg`, sessão em cookie assinado (`jose`) e senha com `bcryptjs`. Sem ORM: o banco inteiro está em [`db/schema.sql`](db/schema.sql) (4 tabelas).

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

- `tests/unit` — conversão de valores ("1.234,56"), datas, sessão, redirecionamentos seguros.
- `tests/integration/saldos.test.ts` — entrada soma, saída subtrai, pendentes, transferências, cartão, repetir todo mês, resumo do mês, validações e isolamento entre usuários.
- `e2e/app.spec.ts` — cadastro, login, criar conta, lançar, marcar pago, transferir, excluir, categorias com limite e sair, conferindo os saldos na tela a cada passo.

## Deploy (Vercel)

Defina `DATABASE_URL` e `AUTH_SECRET` nas variáveis de ambiente do projeto e rode `npm run db:migrate` uma vez contra o banco de produção. O `.vercelignore` impede que o `.env` seja enviado junto com o código.
