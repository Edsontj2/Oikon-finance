"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * Janela por cima da tela (no celular, sobe de baixo ocupando a largura toda).
 * O conteúdo só existe enquanto está aberta: cada abertura começa um formulário novo.
 * Tocar fora só fecha com `dismissible` (confirmações); em formulários perderia o que foi digitado.
 */
export function Modal({
  open,
  onClose,
  title,
  dismissible = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      // O evento "close" também dispara quando quem fechou foi o próprio código; aí não avisa de novo.
      onClose={() => open && onClose()}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="modal-box">
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn-icon" aria-label="Fechar" onClick={onClose}>
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="modal-body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
