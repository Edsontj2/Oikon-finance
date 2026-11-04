/** Panorama do painel: dinheiro, cartões, dívidas, patrimônio e quanto da renda já está comprometido. */
import { num, type Db } from "@/lib/db";
import { monthRange, shiftMonth, today } from "@/lib/dates";
import { isMoneyAccount } from "@/domain/accounts";
import { listAccounts } from "./accounts";
import { listCards } from "./cards";
import { listLoans } from "./loans";
import { openInstallments } from "./dashboard";

export type NetWorthPoint = { month: string; assets: number; debts: number; net: number };

export type Overview = {
  /** Dinheiro nas contas (sem cartão e sem empréstimo). */
  available: number;
  /** Tudo: contas − cartões − dívidas + o que emprestei. */
  netWorth: number;
  cards: { count: number; toPay: number; openInvoices: number; limit: number | null; limitAvailable: number | null };
  debts: { count: number; owed: number; lentReceivable: number };
  /** Parcelas e contas fixas do próximo mês ÷ renda média (null sem renda). */
  commitment: { monthly: number; averageIncome: number; percent: number | null };
  netWorthHistory: NetWorthPoint[];
};

/** Patrimônio no fim de cada um dos últimos `count` meses (o atual vai até hoje). */
export async function netWorthHistory(db: Db, userId: string, now = new Date(), count = 12): Promise<NetWorthPoint[]> {
  const todayStr = today(now);
  const last = todayStr.slice(0, 7);
  const first = shiftMonth(last, -(count - 1));
  const { rows } = await db.query(
    `WITH months AS (
       SELECT g::date AS m FROM generate_series($2::date, $3::date, interval '1 month') g
     ), initial AS (
       SELECT COALESCE(SUM(initial_balance_cents) FILTER (WHERE type NOT IN ('credit_card', 'loan')), 0) AS assets,
              COALESCE(SUM(initial_balance_cents) FILTER (WHERE type IN ('credit_card', 'loan')), 0) AS debts
         FROM accounts WHERE user_id = $1
     )
     SELECT to_char(months.m, 'YYYY-MM') AS month,
            initial.assets + COALESCE(SUM(e.delta) FILTER (WHERE a.type NOT IN ('credit_card', 'loan')), 0) AS assets,
            initial.debts + COALESCE(SUM(e.delta) FILTER (WHERE a.type IN ('credit_card', 'loan')), 0) AS debts
       FROM months
       CROSS JOIN initial
       LEFT JOIN transaction_effects e
              ON e.user_id = $1 AND e.paid AND e.date <= LEAST((months.m + interval '1 month' - interval '1 day')::date, $4::date)
       LEFT JOIN accounts a ON a.id = e.account_id
      GROUP BY months.m, initial.assets, initial.debts
      ORDER BY months.m`,
    [userId, `${first}-01`, `${last}-01`, todayStr],
  );
  return rows.map((r) => {
    const assets = num(r.assets);
    const debts = num(r.debts);
    return { month: r.month, assets, debts, net: assets + debts };
  });
}

async function averageIncome(db: Db, userId: string, month: string): Promise<number> {
  const from = shiftMonth(month, -3);
  const { rows } = await db.query(
    `SELECT to_char(date, 'YYYY-MM') AS month, SUM(amount_cents) AS total
       FROM report_transactions WHERE user_id = $1 AND type = 'income' AND date >= $2 AND date < $3
      GROUP BY 1`,
    [userId, `${from}-01`, monthRange(month).start],
  );
  if (!rows.length) return 0;
  const firstMonth = rows.map((r) => r.month as string).sort()[0];
  const months = [1, 2, 3].map((n) => shiftMonth(month, -n)).filter((m) => m >= firstMonth).length;
  return Math.round(rows.reduce((s, r) => s + num(r.total), 0) / months);
}

export async function getOverview(db: Db, userId: string, now = new Date()): Promise<Overview> {
  const todayStr = today(now);
  const month = todayStr.slice(0, 7);
  const [accounts, cards, loans, installments, recurring, income, history] = await Promise.all([
    listAccounts(db, userId, now),
    listCards(db, userId, now),
    listLoans(db, userId, now),
    openInstallments(db, userId, todayStr),
    db.query(
      `SELECT COALESCE(SUM(r.amount_cents), 0) AS total FROM recurring_rules r
        WHERE r.user_id = $1 AND r.active AND r.type = 'expense'`,
      [userId],
    ),
    averageIncome(db, userId, month),
    netWorthHistory(db, userId, now),
  ]);

  const limits = cards.filter((c) => c.limit.limit !== null);
  const active = loans.filter((l) => !l.settledAt);
  // Fixos do mês: parcelas de compras, parcelas de empréstimo e contas "Todo mês".
  const monthly =
    installments.reduce((s, i) => s + i.nextAmount, 0) +
    active.filter((l) => l.kind === "borrowed" && l.next).reduce((s, l) => s + l.next!.amount, 0) +
    num(recurring.rows[0].total);

  return {
    available: accounts.filter((a) => isMoneyAccount(a.type)).reduce((s, a) => s + a.balance, 0),
    netWorth: accounts.reduce((s, a) => s + a.balance, 0),
    cards: {
      count: cards.length,
      toPay: cards.reduce((s, c) => s + Math.max(0, c.toPay?.remaining ?? 0), 0),
      openInvoices: cards.reduce((s, c) => s + Math.max(0, c.current?.remaining ?? 0), 0),
      limit: limits.length ? limits.reduce((s, c) => s + c.limit.limit!, 0) : null,
      limitAvailable: limits.length ? limits.reduce((s, c) => s + (c.limit.available ?? 0), 0) : null,
    },
    debts: {
      count: active.filter((l) => l.kind === "borrowed").length,
      owed: active.filter((l) => l.kind === "borrowed").reduce((s, l) => s + Math.max(0, -l.balance), 0),
      lentReceivable: active.filter((l) => l.kind === "lent").reduce((s, l) => s + Math.max(0, l.balance), 0),
    },
    commitment: { monthly, averageIncome: income, percent: income > 0 ? Math.round((monthly / income) * 100) : null },
    netWorthHistory: history,
  };
}
