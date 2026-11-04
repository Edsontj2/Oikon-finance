"use client";

import { useState } from "react";
import { categoryKinds, type Category, type CategoryKind } from "@/domain/categories";
import { LIMITS } from "@/domain/limits";
import { MoneyInput } from "@/components/money-input";
import { FormError } from "@/components/form-error";
import { useServerAction } from "@/components/use-server-action";
import { saveCategory } from "../actions";

export function CategoryForm({
  category,
  categories = [],
  defaultKind = "expense",
  onDone,
  onCancel,
}: {
  category?: Category;
  /** Todas as categorias, para escolher a principal (subcategoria). */
  categories?: Category[];
  defaultKind?: CategoryKind;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? defaultKind);
  const { run, pending, error } = useServerAction(saveCategory, onDone);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget));
      }}
    >
      {category ? <input type="hidden" name="id" value={category.id} /> : <input type="hidden" name="submissionKey" value={submissionKey} />}
      {!category && (
        <>
          <input type="hidden" name="kind" value={kind} />
          <div className="segmented" role="radiogroup" aria-label="Tipo de categoria">
            {(Object.keys(categoryKinds) as CategoryKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={`segment segment-${k} ${kind === k ? "active" : ""}`}
                onClick={() => setKind(k)}
              >
                {categoryKinds[k]}
              </button>
            ))}
          </div>
        </>
      )}
      <label>
        Nome
        <input name="name" required maxLength={LIMITS.categoryName} defaultValue={category?.name} autoComplete="off" />
      </label>
      {(() => {
        const hasChildren = category ? categories.some((c) => c.parentId === category.id) : false;
        const parents = categories.filter((c) => c.kind === kind && !c.parentId && c.id !== category?.id);
        if (hasChildren) return <p className="hint">Esta categoria tem subcategorias.</p>;
        return (
          <label>
            Dentro de (opcional)
            <select name="parentId" key={kind} defaultValue={category?.parentId ?? ""}>
              <option value="">Nenhuma: é uma categoria principal</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="hint">Ex.: &quot;Restaurante&quot; dentro de &quot;Alimentação&quot;. O limite da principal vale para ela e as subcategorias juntas.</span>
          </label>
        );
      })()}
      {kind === "expense" && (
        <MoneyInput
          name="monthlyLimit"
          label="Limite mensal (R$)"
          placeholder="opcional"
          defaultCents={category?.monthlyLimit}
          hint="O painel avisa quando os gastos do mês passarem desse valor."
        />
      )}
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando…" : category ? "Salvar alterações" : "Criar categoria"}
        </button>
      </div>
    </form>
  );
}
