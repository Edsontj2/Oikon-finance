/** Marca OIKON Finance em texto (mesmas cores do logo original). */
export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`logo logo-${size}`} aria-label="OIKON Finance">
      <span className="logo-mark">OIKON</span>
      <span className="logo-sub">Finance</span>
    </span>
  );
}
