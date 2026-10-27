"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/action-result";
import { useToast } from "./toast";

/**
 * Chama uma ação do servidor sem recarregar a página: trava cliques repetidos enquanto
 * ela roda, mostra o aviso de sucesso e guarda a mensagem de erro para a tela exibir.
 * O formulário não é limpo em caso de erro (o que a pessoa digitou continua lá).
 */
export function useServerAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<ActionResult | undefined>,
  onSuccess?: () => void,
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  function run(...args: Args) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await action(...args);
      if (!result) return; // a ação redirecionou
      if (result.ok) {
        toast(result.message);
        onSuccess?.();
      } else {
        setError(result.message);
      }
    });
  }

  return { run, pending, error, setError };
}
