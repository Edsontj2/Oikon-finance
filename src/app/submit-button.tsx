"use client";

import { useFormStatus } from "react-dom";

/** Botão de enviar que trava enquanto o servidor responde (evita clique duplo). */
export function SubmitButton({
  children,
  pendingLabel = "Salvando…",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
