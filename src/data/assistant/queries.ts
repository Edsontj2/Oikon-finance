/**
 * Respostas às perguntas do assistente. Tudo vem dos mesmos cálculos do app (saldos, resumo
 * do mês, atrasados, parcelamentos, previsão): aqui só se escolhe o que mostrar e se escreve
 * o texto. Previsões aparecem sempre como previsão, nunca como saldo confirmado.
 */
import type { Db } from "@/lib/db";
import { currentMonth, formatDate, formatMonth, monthRange, shiftMonth, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { monthPace } from "@/domain/pace";
import { findAccounts, findCategory, normalize, type QueryKind } from "@/domain/assistant/parser";
import { listAccounts } from "../accounts";
import { listCategories, listCategoryOptions } from "../categories";
import { endOfMonthBalance, monthSummary, openInstallments, overdueAndDueSoon } from "../dashboard";
import { searchTransactions } from "../transactions";
import { listCards } from "../cards";
import { invoiceStatusLabel } from "@/domain/cards";

const money = formatMoney;
const monthName = (month: string) => formatMonth(month).split(" de ")[0];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lançamentos de um intervalo de datas (até 500), usando a busca normal do app. */
async function transactionsBetween(db: Db, userId: string, from: string, to: string) {
  const months = new Set<string>();
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) months.add(m);
  const all = [];
  for (const month of months) {
    all.push(...(await searchTransactions(db, userId, { month, limit: 500 })).items);
  }
  return all.filter((t) => t.date >= from && t.date <= to);
}

export async function answerQuery(db: Db, userId: string, query: QueryKind, text: string, now: Date): Promise<string> {
  const n = normalize(text);
  const todayStr = today(now);
  const month = currentMonth(now);

  switch (query) {
    case "balance": {
      const accounts = (await listAccounts(db, userId, now)).filter((a) => !a.archived);
      const asked = findAccounts(n, accounts).map((f) => f.account.id);
      if (asked.length) {
        return accounts
          .filter((a) => asked.includes(a.id))
          .map(
            (a) =>
              `*${a.name}*: ${money(a.balance)} hoje${a.projectedBalance !== a.balance ? `\nCom pendentes: ${money(a.projectedBalance)}` : ""}` +
              (a.overdraftLimit ? `\nCom cheque especial: ${money(a.balance + a.overdraftLimit)} disponível${a.balance < 0 ? " (já está usando o limite)" : ""}` : ""),
          )
          .join("\n\n");
      }
      const money_ = accounts.filter((a) => a.type !== "credit_card");
      const total = money_.reduce((s, a) => s + a.balance, 0);
      const lines = money_.map((a) => `• ${a.name}: ${money(a.balance)}`);
      return [`*Saldo nas contas hoje: ${money(total)}*`, ...lines, "", "Cartões não entram nessa soma (limite não é dinheiro)."].join("\n");
    }

    case "spent_today": {
      const items = (await transactionsBetween(db, userId, todayStr, todayStr)).filter((t) => t.type === "expense" && t.paid);
      const total = items.reduce((s, t) => s + t.amount, 0);
      if (!items.length) return "Nenhuma saída paga registrada hoje.";
      return [`*Saídas pagas hoje: ${money(total)}*`, ...items.slice(0, 10).map((t) => `• ${t.description}: ${money(t.amount)}`)].join("\n");
    }

    case "spent_month": {
      const categories = await listCategoryOptions(db, userId);
      const category = findCategory(n, categories, "expense");
      if (category) {
        const row = (await listCategories(db, userId, month, now)).find((c) => c.id === category.id);
        const paid = row?.paidTotal ?? 0;
        const pending = row?.pendingTotal ?? 0;
        return `*${category.name} em ${monthName(month)}: ${money(paid)}* pagos${pending ? `\n+ ${money(pending)} pendentes` : ""}${row?.monthlyLimit ? `\nLimite do mês: ${money(row.monthlyLimit)}` : ""}`;
      }
      const s = await monthSummary(db, userId, month, now);
      return `*Saídas pagas em ${monthName(month)}: ${money(s.expense)}*${s.pendingExpense ? `\n+ ${money(s.pendingExpense)} a pagar no mês` : ""}`;
    }

    case "received_month": {
      const s = await monthSummary(db, userId, month, now);
      return `*Entradas recebidas em ${monthName(month)}: ${money(s.income)}*${s.pendingIncome ? `\n+ ${money(s.pendingIncome)} a receber no mês` : ""}`;
    }

    case "can_spend": {
      const s = await monthSummary(db, userId, month, now);
      const p = monthPace(todayStr, s);
      if (p.monthLeftover <= 0 && s.income + s.pendingIncome === 0) return "Ainda não há entradas lançadas neste mês, então não dá para calcular quanto sobra.";
      if (p.monthLeftover <= 0) return `Com o que está lançado, ${monthName(month)} já fecha em ${money(p.monthLeftover)}. Melhor segurar os gastos.`;
      return [
        `*Você pode gastar cerca de ${money(p.perDayAvailable)} por dia* nos ${p.daysLeft} dias que faltam.`,
        `Sobra prevista do mês: ${money(p.monthLeftover)} (entradas − saídas, pagas e pendentes).`,
      ].join("\n");
    }

    case "due_soon": {
      const monthEnd = addDays(monthRange(month).end, -1);
      const days = /\bamanha\b/.test(n)
        ? [addDays(todayStr, 1), addDays(todayStr, 1)]
        : /\bhoje\b/.test(n)
          ? [todayStr, todayStr]
          : /\bmes\b/.test(n)
            ? [todayStr, monthEnd]
            : [todayStr, addDays(todayStr, 7)];
      const items = (await transactionsBetween(db, userId, days[0], days[1])).filter((t) => t.type !== "income" && !t.paid);
      const label = days[0] === days[1] ? (days[0] === todayStr ? "hoje" : "amanhã") : days[1] === monthEnd ? "até o fim do mês" : "nos próximos 7 dias";
      if (!items.length) return `Nenhuma conta pendente vence ${label}.`;
      const total = items.reduce((s, t) => s + t.amount, 0);
      return [`*Vencem ${label}: ${money(total)}*`, ...items.map((t) => `• ${formatDate(t.date)} · ${t.description}: ${money(t.amount)}`)].join("\n");
    }

    case "overdue": {
      const { overdue } = await overdueAndDueSoon(db, userId, todayStr);
      if (!overdue.count) return "Nenhuma conta atrasada. 👍";
      return [
        `*${overdue.count} lançamento${overdue.count === 1 ? "" : "s"} atrasado${overdue.count === 1 ? "" : "s"}*`,
        overdue.expense ? `A pagar: ${money(overdue.expense)}` : null,
        overdue.income ? `A receber: ${money(overdue.income)}` : null,
        overdue.transfer ? `Faturas/transferências: ${money(overdue.transfer)}` : null,
        "Se já pagou, marque como pago no app ou escreva \"marcar conta de ... como paga\".",
      ].filter(Boolean).join("\n");
    }

    case "card_debt": {
      const cards = await listCards(db, userId, now);
      if (!cards.length) return "Você ainda não tem cartão de crédito cadastrado. Crie em Contas, com o tipo \"Cartão de crédito\".";
      const asked = findAccounts(n, cards.map((c) => ({ id: c.id, name: c.name, type: "credit_card" as const }))).map((f) => f.account.id);
      const shown = asked.length ? cards.filter((c) => asked.includes(c.id)) : cards;
      const blocks = shown.map((c) => {
        const lines = [`*${c.name}*`];
        if (c.toPay) lines.push(`Fatura de ${monthName(c.toPay.month)} (${invoiceStatusLabel[c.toPay.status].toLowerCase()}): ${money(c.toPay.remaining)} · vence ${formatDate(c.toPay.dueDate)}`);
        if (c.current) lines.push(`Fatura aberta (${monthName(c.current.month)}): ${money(Math.max(0, c.current.remaining))} até agora · fecha ${formatDate(c.current.closingDate)}`);
        lines.push(`Total com parcelas futuras: ${money(c.limit.committed)}`);
        if (c.limit.limit !== null) lines.push(`Limite disponível: ${money(c.limit.available ?? 0)} de ${money(c.limit.limit)}`);
        else if (/\blimite\b/.test(n)) lines.push("Limite não cadastrado (cadastre em Cartões no app).");
        if (!c.configured) lines.push("Fechamento e vencimento não cadastrados: as faturas estão por mês do calendário.");
        return lines.join("\n");
      });
      return blocks.join("\n\n");
    }

    case "next_invoice": {
      const cards = await listCards(db, userId, now);
      if (!cards.length) return "Você ainda não tem cartão de crédito cadastrado.";
      const lines = cards.map((c) => {
        const next = c.upcoming[0] ?? (c.current ? { month: c.current.month, amount: Math.max(0, c.current.remaining) } : null);
        return next ? `• ${c.name}: ${money(next.amount)} (fatura de ${monthName(next.month)})` : `• ${c.name}: nada lançado`;
      });
      return [`*Próximas faturas*`, ...lines, "", "Soma das compras e parcelas já lançadas; pode subir até o fechamento."].join("\n");
    }

    case "debts": {
      const items = await openInstallments(db, userId, todayStr);
      if (!items.length) return "Nenhuma compra parcelada em aberto.";
      const total = items.reduce((s, i) => s + i.remaining, 0);
      return [
        `*Parcelamentos em aberto: ${money(total)} a pagar*`,
        ...items.slice(0, 10).map((i) => `• ${i.description}: ${i.settledCount}/${i.count} pagas · faltam ${money(i.remaining)} · termina em ${formatDate(i.lastDate)}`),
      ].join("\n");
    }

    case "forecast": {
      const value = await endOfMonthBalance(db, userId, month, todayStr);
      return `*Previsão para o fim de ${monthName(month)}: ${money(value)}*\nÉ uma previsão: considera que tudo o que vence até o fim do mês será pago e recebido.`;
    }

    case "summary": {
      const s = await monthSummary(db, userId, month, now);
      const cats = (await listCategories(db, userId, month, now)).filter((c) => c.kind === "expense" && c.paidTotal > 0).sort((a, b) => b.paidTotal - a.paidTotal);
      const result = s.income - s.expense;
      return [
        `*Resumo de ${monthName(month)}*`,
        `Entradas recebidas: ${money(s.income)}`,
        `Saídas pagas: ${money(s.expense)}`,
        `Resultado: ${money(result)}`,
        s.income > 0 ? `Guardou ${Math.round((result / s.income) * 100)}% do que recebeu` : null,
        s.pendingExpense || s.pendingIncome ? `Pendentes: ${money(s.pendingExpense)} a pagar · ${money(s.pendingIncome)} a receber` : null,
        cats.length ? `\nMaiores categorias:\n${cats.slice(0, 3).map((c) => `• ${c.name}: ${money(c.paidTotal)}`).join("\n")}` : null,
      ].filter(Boolean).join("\n");
    }

    case "top_expenses": {
      const items = (await searchTransactions(db, userId, { month, type: "expense", limit: 500 })).items.sort((a, b) => b.amount - a.amount);
      if (!items.length) return `Nenhuma saída em ${monthName(month)}.`;
      return [`*Maiores saídas de ${monthName(month)}*`, ...items.slice(0, 5).map((t) => `• ${t.description}: ${money(t.amount)} (${formatDate(t.date)})`)].join("\n");
    }
  }
}
