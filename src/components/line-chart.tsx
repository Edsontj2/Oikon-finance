"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

export type LinePoint = { key: string; label: string; value: number; detail?: string };

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Linha simples em SVG (sem biblioteca). Toque ou passe o mouse para ler um ponto; a linha zero
 * aparece quando há valores negativos. A tabela embaixo tem os mesmos números.
 */
export function LineChart({ points, ariaLabel, tickEvery = 1, tableTitle }: { points: LinePoint[]; ariaLabel: string; tickEvery?: number; tableTitle: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <p className="muted">Ainda não há dados suficientes para o gráfico.</p>;
  // Largura parecida com a do celular: o texto do SVG fica legível sem escalar demais.
  const W = 380;
  const H = 170;
  const pad = { top: 10, bottom: 22, left: 40, right: 8 };
  const values = points.map((p) => p.value);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 100_00;
  const span = max - min;
  min -= span * 0.05;
  max += span * 0.05;
  const x = (i: number) => pad.left + (i / (points.length - 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + ((max - v) / (max - min)) * (H - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} Z`;
  const ticks = [max, (max + min) / 2, min].map((v) => Math.round(v));
  const shown = active ?? points.length - 1;
  const current = points[shown];

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((rel - pad.left) / (W - pad.left - pad.right)) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="line-chart">
      <p className="chart-readout" aria-live="polite">
        <strong>{current.label}</strong>
        <span className={current.value < 0 ? "negative" : undefined}>{formatMoney(current.value)}</span>
        {current.detail && <span>{current.detail}</span>}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onTouchStart={(e) => pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        onTouchMove={(e) => pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="lc-grid" />
            <text x={pad.left - 6} y={y(t) + 4} className="lc-axis" textAnchor="end">{compact.format(t / 100)}</text>
          </g>
        ))}
        {min < 0 && <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} className="lc-zero" />}
        <path d={area} className="lc-area" />
        <path d={path} className="lc-line" />
        {points.map((p, i) =>
          i % tickEvery === 0 || i === points.length - 1 ? (
            <text key={p.key} x={x(i)} y={H - 6} className="lc-axis" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {p.label.length > 8 ? p.label.slice(0, 6) : p.label}
            </text>
          ) : null,
        )}
        <line x1={x(shown)} x2={x(shown)} y1={pad.top} y2={H - pad.bottom} className="lc-cursor" />
        <circle cx={x(shown)} cy={y(current.value)} r={4.5} className={current.value < 0 ? "lc-dot negative" : "lc-dot"} />
      </svg>
      <details className="chart-table">
        <summary>Ver em tabela</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">{tableTitle}</th><th scope="col">Valor</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}><th scope="row">{p.label}</th><td>{formatMoney(p.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
