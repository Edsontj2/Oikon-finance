/** Erro com mensagem que pode ser mostrada para quem usa o app. */
export class UserError extends Error {}

export const SESSION_GONE = "Sua sessão expirou. Entre novamente.";

export function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String(err.code) : undefined;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: unknown): id is string {
  return typeof id === "string" && uuidRe.test(id);
}

/** Ids vêm de formulários; um id malformado vira "não encontrado" em vez de erro do banco. */
export function assertUuid(id: unknown, notFound: string): asserts id is string {
  if (!isUuid(id)) throw new UserError(notFound);
}

/**
 * Chave única de um envio de formulário (evita gravar duas vezes no duplo clique).
 * Chave ausente ou malformada vale como "sem proteção", nunca como erro.
 */
export function submissionKey(key: unknown): string | null {
  return isUuid(key) ? key : null;
}

/** Converte erros do banco que o usuário pode causar em mensagens; o resto sobe como está. */
export function toUserError(err: unknown): unknown {
  switch (pgCode(err)) {
    case "23503": // usuário não existe mais (conta apagada com a sessão ainda aberta)
      return new UserError(SESSION_GONE);
    case "23514": // CHECK do banco (tamanho, tipo)
      return new UserError("Algum dado está fora do permitido. Confira os campos.");
    default:
      return err;
  }
}
