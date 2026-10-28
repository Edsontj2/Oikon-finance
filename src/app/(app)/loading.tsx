/** Aparece na hora ao trocar de aba, enquanto o servidor monta a página. */
export default function Loading() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Carregando">
      <span className="skeleton skeleton-title" />
      <div className="grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card stat">
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-value" />
          </div>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="card">
          <span className="skeleton skeleton-line short" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line medium" />
        </div>
      ))}
    </div>
  );
}
