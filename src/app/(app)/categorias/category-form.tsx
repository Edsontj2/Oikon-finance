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
  defaultKind = "expense",
  onDone,
  onCancel,
}: {
  category?: Category;
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
