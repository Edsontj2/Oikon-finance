/**
 * Contas a pagar e a receber: tudo que está pendente (lançamentos não pagos, parcelas de
 * empréstimo) e as faturas de cartão fechadas, agrupado pelo vencimento. Não cria nada novo:
 * só junta o que já existe nos lançamentos e nos cartões.
 */
import { num, type Db } from "@/lib/db";
import { shiftMonth, today } from "@/lib/dates";
import { projectedRecurring } from "./recurring";
import { listCards } from "./cards";

export type Bill = {
  /** Id do lançamento, ou "card:<id>" para fatura de cartão. */
  id: string;
  kind: "pay" | "receive" | "transfer" | "invoice";
  description: string;
  amount: number;
  date: string;
  accountName: string;
  toAccountName: string | null;
  categoryName: string | null;
  /** Parcela de empréstimo, fatura etc.: link para a tela certa. */
  href: string | null;
  transactionId: string | null;
  /** Mês futuro de um "Todo mês" (ainda não lançado). */
  projected?: { ruleId: string; month: string };
};

export type BillGroup = { key: "overdue" | "today" | "week" | "month" | "later"; label: string; items: Bill[]; pay: number; receive: number };

const groupLabels: Record<BillGroup["key"], string> = {
  overdue: "Atrasadas",
  today: "Vencem hoje",
  week: "Próximos 7 dias",
  month: "Até 30 dias",
  later: "Depois (até 90 dias)",
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function listBills(db: Db, userId: string, now = new Date()): Promise<{ groups: BillGroup[]; next30: { pay: number; receive: number } }> {
  const todayStr = today(now);
  const until = addDays(todayStr, 90);
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.description, t.amount_cents, to_char(t.date, 'YYYY-MM-DD') AS date, a.name AS account_name,
            ta.name AS to_account_name, c.name AS category_name, t.loan_id, a.type AS account_type, ta.type AS to_account_type
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ta ON ta.id = t.to_account_id
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = $1 AND NOT t.paid AND t.date <= $2::date
      ORDER BY t.date, t.created_at
      LIMIT 500`,
    [userId, until],
  );
  const bills: Bill[] = rows.map((r) => ({
    id: r.id,
    // Transferência para empréstimo é parcela a pagar; do empréstimo para a conta, a receber.
    kind: r.type === "expense" ? "pay" : r.type === "income" ? "receive" : r.to_account_type === "loan" || r.to_account_type === "credit_card" ? "pay" : r.account_type === "loan" ? "receive" : "transfer",
    description: r.description,
    amount: num(r.amount_cents),
    date: r.date,
    accountName: r.account_name,
    toAccountName: r.to_account_name ?? null,
    categoryName: r.category_name ?? null,
    href: r.loan_id ? `/dividas#${r.loan_id}` : null,
    transactionId: r.id,
  }));
  // Faturas fechadas ainda não pagas (o pagamento agendado, se houver, já aparece como lançamento).
  for (const card of await listCards(db, userId, now)) {
    const inv = card.toPay;
    if (!inv || inv.remaining - inv.scheduled <= 0) continue;
    bills.push({
      id: `card:${card.id}`,
      kind: "invoice",
      description: `Fatura ${card.name}`,
      amount: inv.remaining - inv.scheduled,
      date: inv.dueDate,
      accountName: card.name,
      toAccountName: null,
      categoryName: null,
      href: `/cartoes/${card.id}?fatura=${inv.month}`,
      transactionId: null,
    });
  }
  // Meses futuros dos "Todo mês" (ainda não lançados). No cartão já entram pela fatura.
  for (let month = shiftMonth(todayStr.slice(0, 7), 1); month <= until.slice(0, 7); month = shiftMonth(month, 1)) {
    for (const t of await projectedRecurring(db, userId, month)) {
      if (t.date > until || t.paid) continue;
      bills.push({
        id: t.id,
        kind: t.type === "expense" ? "pay" : t.type === "income" ? "receive" : "transfer",
        description: t.description,
        amount: t.amount,
        date: t.date,
        accountName: t.accountName,
        toAccountName: t.toAccountName,
        categoryName: t.categoryName,
        href: null,
        transactionId: null,
        projected: t.projected,
      });
    }
  }
  bills.sort((a, b) => a.date.localeCompare(b.date));

  const keyOf = (date: string): BillGroup["key"] =>
    date < todayStr ? "overdue" : date === todayStr ? "today" : date <= addDays(todayStr, 7) ? "week" : date <= addDays(todayStr, 30) ? "month" : "later";
  const groups = (Object.keys(groupLabels) as BillGroup["key"][]).map((key) => {
    const items = bills.filter((b) => keyOf(b.date) === key);
    return {
      key,
      label: groupLabels[key],
      items,
      pay: items.filter((b) => b.kind === "pay" || b.kind === "invoice").reduce((s, b) => s + b.amount, 0),
      receive: items.filter((b) => b.kind === "receive").reduce((s, b) => s + b.amount, 0),
    };
  });
  const within30 = bills.filter((b) => b.date <= addDays(todayStr, 30));
  return {
    groups: groups.filter((g) => g.items.length),
    next30: {
      pay: within30.filter((b) => b.kind === "pay" || b.kind === "invoice").reduce((s, b) => s + b.amount, 0),
      receive: within30.filter((b) => b.kind === "receive").reduce((s, b) => s + b.amount, 0),
    },
  };
}
