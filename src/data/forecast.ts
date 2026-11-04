/**
 * Previsão do dinheiro nas contas (corrente, poupança, carteira, investimento) para os próximos
 * dias. Entram:
 * - lançamentos pendentes e agendados (inclusive parcelas de empréstimo e pagamentos de fatura agendados);
 * - os meses futuros dos lançamentos "Todo mês" (ainda não lançados);
 * - o que falta pagar das faturas de cartão, no vencimento (descontando pagamento já agendado).
 * Compras no cartão não entram direto: só a fatura, quando vence. É uma previsão: depende de
 * tudo ser pago e recebido nas datas.
 */
import { num, type Db } from "@/lib/db";
import { dayOf, invoiceMonthFor, invoiceDates } from "@/domain/cards";
import { isMoneyAccount, type AccountType } from "@/domain/accounts";
import { addDays, buildForecast, FORECAST_HORIZONS, type Forecast, type ForecastMove } from "@/domain/forecast";
import { shiftMonth, today } from "@/lib/dates";
import { listAccounts } from "./accounts";
import { listCardDetails } from "./cards";

export async function balanceForecast(db: Db, userId: string, now = new Date(), horizons: readonly number[] = FORECAST_HORIZONS): Promise<Forecast> {
  const todayStr = today(now);
  const end = addDays(todayStr, Math.max(...horizons));
  const [accounts, pending, rules, cards] = await Promise.all([
    listAccounts(db, userId, now),
    db.query(
      `SELECT to_char(e.date, 'YYYY-MM-DD') AS date, SUM(e.delta) AS delta
         FROM transaction_effects e
         JOIN accounts a ON a.id = e.account_id
        WHERE e.user_id = $1 AND a.type NOT IN ('credit_card', 'loan')
          AND NOT (e.paid AND e.date <= $2::date) AND e.date <= $3::date
        GROUP BY 1`,
      [userId, todayStr, end],
    ),
    db.query(
      `SELECT r.type, r.amount_cents, r.day, to_char(r.generated_through, 'YYYY-MM') AS through,
              a.type AS account_type, a.closing_day, a.due_day, ta.type AS to_account_type
         FROM recurring_rules r
         JOIN accounts a ON a.id = r.account_id AND NOT a.archived
         LEFT JOIN accounts ta ON ta.id = r.to_account_id
        WHERE r.user_id = $1 AND r.active`,
      [userId],
    ),
    listCardDetails(db, userId, now),
  ]);

  const start = accounts.filter((a) => isMoneyAccount(a.type)).reduce((s, a) => s + a.balance, 0);
  const moves: ForecastMove[] = pending.rows.map((r) => ({ date: r.date, delta: num(r.delta), source: "pending" }));

  // Meses futuros dos recorrentes (o mês atual já foi lançado e está nos pendentes).
  const endMonth = end.slice(0, 7);
  for (const r of rules.rows) {
    const amount = num(r.amount_cents);
    for (let month = shiftMonth(r.through, 1); month <= endMonth; month = shiftMonth(month, 1)) {
      const date = dayOf(month, Number(r.day));
      const fromType = r.account_type as AccountType;
      if (fromType === "credit_card" && r.type === "expense") {
        // No cartão: sai do dinheiro quando a fatura daquela compra vence.
        const cycle = { closingDay: r.closing_day === null ? null : Number(r.closing_day), dueDay: r.due_day === null ? null : Number(r.due_day) };
        const due = invoiceDates(invoiceMonthFor(date, cycle), cycle).dueDate;
        moves.push({ date: cycle.dueDay ? due : addDays(date, 30), delta: -amount, source: "recurring" });
        continue;
      }
      let delta = 0;
      if (isMoneyAccount(fromType)) delta += r.type === "income" ? amount : -amount;
      if (r.type === "transfer" && r.to_account_type && isMoneyAccount(r.to_account_type as AccountType)) delta += amount;
      if (delta !== 0) moves.push({ date, delta, source: "recurring" });
    }
  }

  // Faturas: o que falta pagar, menos o pagamento já agendado (que já está nos pendentes).
  for (const card of cards) {
    card.invoices.forEach((inv, i) => {
      // Vencida sem pagar tudo: o resto já passou para a próxima fatura (saldo anterior); conta lá.
      const next = card.invoices[i + 1];
      if (inv.dueDate < todayStr && next && next.previousBalance > 0) return;
      if (inv.dueDate > end || inv.status === "paid" || inv.status === "installed" || inv.status === "empty") return;
      const owed = inv.remaining - inv.scheduled;
      if (owed > 0) moves.push({ date: inv.dueDate, delta: -owed, source: "invoice" });
    });
  }
  return buildForecast(todayStr, start, moves, horizons);
}
