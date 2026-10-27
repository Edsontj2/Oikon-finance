"use client";

import { Modal } from "./modal";
import { FormError } from "./form-error";

/** Pergunta antes de apagar. As ações (botões) vêm de quem chama. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="confirm-text">{message}</p>
      <FormError message={error ?? null} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        {children}
      </div>
    </Modal>
  );
}
