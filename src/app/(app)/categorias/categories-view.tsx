"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import type { Category, CategoryKind } from "@/domain/categories";
import { Money } from "@/components/money";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerAction } from "@/components/use-server-action";
import { removeCategory } from "../actions";
import { CategoryForm } from "./category-form";
import { LimitBar } from "./limit-bar";

export function CategoriesView({ categories, monthNav }: { categories: Category[]; monthNav: React.ReactNode }) {
  const [creating, setCreating] = useState<CategoryKind | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const remove = useServerAction(removeCategory, () => setDeleting(null));

  const section = (kind: CategoryKind, title: string) => {
    const items = categories.filter((c) => c.kind === kind);
    return (
      <section className="list-group">
        <div className="list-group-head">
          <h2 className="list-group-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(kind)}>
            <Plus size={16} aria-hidden /> Adicionar
          </button>
        </div>
        {items.length === 0 ? (
          <div className="card empty"><p>Nenhuma categoria.</p></div>
        ) : (
          <ul className="list card">
            {items.map((c) => (
              <li key={c.id} className="row" data-testid="categoria">
                <button type="button" className="row-main" onClick={() => setEditing(c)} aria-label={`Editar categoria ${c.name}`}>
                  <span className="row-text">
                    <span className="row-title">{c.name}</span>
                    <span className="row-sub">
                      {c.pendingTotal > 0 ? (
                        <>
                          <Money cents={c.paidTotal} /> {kind === "expense" ? "pago" : "recebido"} + <Money cents={c.pendingTotal} /> pendente
                        </>
                      ) : (
                        <><Money cents={c.paidTotal} /> no mês</>
                      )}
                      {c.monthlyLimit !== null && <> · limite <Money cents={c.monthlyLimit} /></>}
                      {c.monthlyLimit !== null && c.monthTotal > c.monthlyLimit && (
                        <> <span className="tag tag-late">acima do limite</span></>
                      )}
                    </span>
                    {c.monthlyLimit !== null && <LimitBar total={c.monthTotal} limit={c.monthlyLimit} />}
                  </span>
                  <span className="row-value">
                    <ChevronRight size={16} className="row-chevron" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>Categorias</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating("expense")}>
          <Plus size={18} aria-hidden /> Nova categoria
        </button>
      </div>
      {monthNav}
      {section("expense", "Saídas")}
      {section("income", "Entradas")}

      <Modal open={creating !== null} onClose={() => setCreating(null)} title="Nova categoria">
        {creating && <CategoryForm defaultKind={creating} onDone={() => setCreating(null)} onCancel={() => setCreating(null)} />}
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Editar categoria">
        {editing && (
          <>
            <CategoryForm category={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
            <div className="danger-zone">
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => {
                  remove.setError(null);
                  setDeleting(editing);
                  setEditing(null);
                }}
              >
                Excluir categoria
              </button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Excluir categoria?"
        error={remove.error}
        message={
          deleting && (
            <>
              A categoria <strong>{deleting.name}</strong> será apagada. Os lançamentos dela continuam, só ficam sem
              categoria.
            </>
          )
        }
      >
        <button type="button" className="btn btn-danger" disabled={remove.pending} onClick={() => deleting && remove.run(deleting.id)}>
          Excluir
        </button>
      </ConfirmDialog>
    </>
  );
}
