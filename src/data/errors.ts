/** Erro com mensagem que pode ser mostrada para quem usa o app. */
export class UserError extends Error {}

export function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String(err.code) : undefined;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids vêm de formulários; um id malformado vira "não encontrado" em vez de erro do banco. */
export function assertUuid(id: unknown, notFound: string): asserts id is string {
  if (typeof id !== "string" || !uuidRe.test(id)) throw new UserError(notFound);
}
