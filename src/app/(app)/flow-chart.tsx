"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";
import type { MonthFlow } from "@/data/dashboard";
import { formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const shortMonth = (month: string) => formatMonth(month).slice(0, 3);

/** Topo do eixo "redondo" (1, 2, 2,5 ou 5 × 10^n) com 4 divisões. */
function niceMax(value: number): number {
  if (value <= 0) return 100_00;
  const raw = value / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return step * 4;
}

/** Entradas × saídas por mês (barras agrupadas). Toque ou passe o mouse num mês para ver os valores. */
export function FlowChart({ flow }: { flow: MonthFlow[] }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(...flow.map((f) => Math.max(f.income, f.expense))));
  const ticks = [4, 3, 2, 1, 0].map((i) => (top / 4) * i);
  const shown = active ?? flow.length - 1;
  const current = flow[shown];

  return (
    <section className="card" aria-labelledby="fluxo-title">
      <div className="chart-head">
        <h2 id="fluxo-title" className="card-icon-title"><BarChart3 size={18} aria-hidden /> Entradas e saídas · 6 meses</h2>
        <ul className="legend" aria-label="Legenda">
          <li><span className="swatch swatch-income" aria-hidden /> Entradas</li>
          <li><span className="swatch swatch-expense" aria-hidden /> Saídas</li>
        </ul>
      </div>

      <p className="chart-readout" aria-live="polite">
        <strong>{formatMonth(current.month)}</strong>
        <span>Entradas {formatMoney(current.income)}</span>
        <span>Saídas {formatMoney(current.expense)}</span>
        <span>Resultado {formatMoney(current.income - current.expense)}</span>
      </p>

      <div className="chart" onMouseLeave={() => setActive(null)}>
        <div className="chart-axis" aria-hidden>
          {ticks.map((t) => (
            <span key={t}>{t === 0 ? "0" : compact.format(t / 100)}</span>
          ))}
        </div>
        <div className="chart-plot">
          <div className="chart-grid" aria-hidden>
            {ticks.map((t) => <span key={t} />)}
          </div>
          {flow.map((f, i) => (
            <button
              key={f.month}
              type="button"
              className={`chart-col ${i === shown ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${formatMonth(f.month)}: entradas ${formatMoney(f.income)}, saídas ${formatMoney(f.expense)}`}
            >
              <span className="chart-bars">
                <span className="chart-bar bar-income" style={{ height: `${(f.income / top) * 100}%` }} />
                <span className="chart-bar bar-expense" style={{ height: `${(f.expense / top) * 100}%` }} />
              </span>
              <span className="chart-label">{shortMonth(f.month)}</span>
            </button>
          ))}
        </div>
      </div>

      <details className="chart-table">
        <summary>Ver em tabela</summary>
        <div className="table-scroll">
        <table>
          <thead>
            <tr><th scope="col">Mês</th><th scope="col">Entradas</th><th scope="col">Saídas</th><th scope="col">Resultado</th></tr>
          </thead>
          <tbody>
            {flow.map((f) => (
              <tr key={f.month}>
                <th scope="row">{formatMonth(f.month)}</th>
                <td>{formatMoney(f.income)}</td>
                <td>{formatMoney(f.expense)}</td>
                <td>{formatMoney(f.income - f.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
      <p className="hint">Inclui pendentes; transferências entre contas não entram.</p>
    </section>
  );
}
