/** Barra de uso do limite mensal (fica vermelha quando passa). */
export function LimitBar({ total, limit }: { total: number; limit: number }) {
  const pct = Math.min(100, Math.round((total / limit) * 100));
  const over = total > limit;
  return (
    <span className={`bar ${over ? "over" : ""}`} title={`${Math.round((total / limit) * 100)}% do limite`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
