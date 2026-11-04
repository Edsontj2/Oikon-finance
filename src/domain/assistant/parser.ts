/**
 * Interpretação de mensagens em português (WhatsApp e, no futuro, outras entradas de texto).
 * Só regras fixas: nada aqui acessa o banco, executa operações ou inventa dado que não está
 * na mensagem. O que faltar volta como "missing" para o assistente perguntar.
 */
import { addMonths, isValidDate, today } from "@/lib/dates";
import { parseMoney } from "@/lib/money";

export type Operation = "expense" | "income" | "transfer";

export type QueryKind =
  | "balance"
  | "spent_today"
  | "spent_month"
  | "received_month"
  | "can_spend"
  | "due_soon"
  | "overdue"
  | "card_debt"
  | "next_invoice"
  | "debts"
  | "forecast"
  | "summary"
  | "top_expenses";

export type Intent =
  | { kind: "entry"; operation: Operation; scheduled?: boolean }
  | { kind: "mark_paid" }
  | { kind: "query"; query: QueryKind }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "link"; code: string }
  | { kind: "help" }
  | { kind: "unknown" };

export type AccountRef = { id: string; name: string; type: string };
export type CategoryRef = { id: string; name: string; kind: "income" | "expense" };

/** Lançamento montado a partir da mensagem. Campos ausentes ficam vazios, nunca chutados. */
export type Draft = {
  operation: Operation;
  amount: number | null;
  description: string;
  categoryId: string | null;
  accountId: string | null;
  destinationAccountId: string | null;
  installments: number | null;
  date: string;
  /** false: conta a pagar/receber agendada (fica pendente; agendar não é pagar). */
  paid: boolean;
  /** "todo dia 5": quantos meses repetir. */
  repeatMonths: number | null;
};

/** Minúsculas, sem acentos e com espaços simples: para comparar, nunca para mostrar. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const has = (text: string, re: RegExp) => re.test(text);

/** O que a pessoa quer fazer. Recebe o texto já normalizado. */
export function detectIntent(n: string): Intent {
  const link = n.match(/^vincular\s+(\d{6})$/);
  if (link) return { kind: "link", code: link[1] };
  if (/^(sim|s|confirmar|confirmo|confirma|ok|pode|pode registrar|isso|certo|1)$/.test(n)) return { kind: "confirm" };
  if (/^(nao|n|cancelar|cancela|cancelo|desistir|para|esquece|2)$/.test(n)) return { kind: "cancel" };
  if (/^(ajuda|menu|comandos|help|oi|ola|bom dia|boa tarde|boa noite|\?)$/.test(n)) return { kind: "help" };
  if (/^marca(r)? .+ como pag[oa]$/.test(n) || /^(ja )?paguei a conta de\b/.test(n)) return { kind: "mark_paid" };
  if (/^(adicionar|adiciona|cadastrar|cadastra|lembrar|lembre|agendar|agenda)\b/.test(n)) {
    return { kind: "entry", operation: /\b(receber|recebimento|salario)\b/.test(n) ? "income" : "expense", scheduled: true };
  }

  // Consultas vêm antes dos lançamentos: "quanto gastei" é pergunta, não gasto.
  const isQuestion = has(n, /^(quanto|qual|quais|quando|mostrar|mostra|minha|minhas|meu|meus|resumo|relatorio|previsao)\b|\?$/);
  if (isQuestion || has(n, /\b(resumo|relatorio)\b/)) {
    if (has(n, /\b(resumo|relatorio)\b/)) return { kind: "query", query: "summary" };
    if (has(n, /\bmaiores? (despesas?|gastos?)\b/)) return { kind: "query", query: "top_expenses" };
    if (has(n, /\b(atrasad|vencid)/)) return { kind: "query", query: "overdue" };
    if (has(n, /\b(vence|vencem|vencimento|a pagar|contas da semana|contas de amanha|contas de hoje)\b/)) return { kind: "query", query: "due_soon" };
    if (has(n, /\bfatura\b/) && has(n, /\b(mes que vem|proximo mes|proxima)\b/)) return { kind: "query", query: "next_invoice" };
    if (has(n, /\b(fatura|devo no cartao|limite)\b/)) return { kind: "query", query: "card_debt" };
    if (has(n, /\b(dividas?|parcelamentos?|parcelas)\b/)) return { kind: "query", query: "debts" };
    if (has(n, /\b(posso gastar|ainda posso|sobra)\b/)) return { kind: "query", query: "can_spend" };
    if (has(n, /\b(economizei|guardei|sobrou)\b/)) return { kind: "query", query: "summary" };
    if (has(n, /\b(previsao|fim do mes|final do mes)\b/)) return { kind: "query", query: "forecast" };
    if (has(n, /\b(gastei|gasto|gastos|despesas?)\b/) && has(n, /\bhoje\b/)) return { kind: "query", query: "spent_today" };
    if (has(n, /\b(gastei|gasto|gastos|despesas?)\b/)) return { kind: "query", query: "spent_month" };
    if (has(n, /\b(recebi|receitas?|entradas?|ganhei)\b/)) return { kind: "query", query: "received_month" };
    if (has(n, /\b(saldo|dinheiro|tenho)\b/)) return { kind: "query", query: "balance" };
  }

  if (has(n, /\b(transferi|transferencia|transferir|movi|mover|passei)\b/) && has(n, /\bpara\b/)) {
    return { kind: "entry", operation: "transfer" };
  }
  // Pagar a fatura é mover dinheiro da conta para o cartão: não é uma nova despesa.
  if (has(n, /\bpaguei\b/) && has(n, /\bfatura\b/)) return { kind: "entry", operation: "transfer" };
  if (has(n, /\b(recebi|entrada|ganhei|caiu|receita)\b/)) return { kind: "entry", operation: "income" };
  if (has(n, /\b(gastei|paguei|comprei|saida|despesa|gasto|compra)\b/)) return { kind: "entry", operation: "expense" };
  return { kind: "unknown" };
}

type Token = { raw: string; norm: string };

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalize(raw).replace(/[.,!?;:]+$/, "") }));
}

/** Valor em centavos e quais palavras ele ocupa. "mil" multiplica; parcelas, dias e finais de cartão não contam. */
export function findAmount(text: string): { cents: number; start: number; end: number } | null {
  const tokens = tokenize(text);
  const candidates: Array<{ cents: number; start: number; end: number; strong: boolean }> = [];
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i].norm;
    let start = i;
    let strong = false;
    if (t === "r$" && i + 1 < tokens.length) {
      i++;
      t = tokens[i].norm;
      strong = true;
    } else if (t.startsWith("r$")) {
      t = t.slice(2);
      strong = true;
    }
    if (!/^\d[\d.,]*$/.test(t)) continue;
    const prev = tokens[start - 1]?.norm;
    const next = tokens[i + 1]?.norm;
    if (prev === "dia" || prev === "final" || prev === "dias") continue;
    if (next && /^(x|vezes|parcelas?|meses|dias)$/.test(next)) continue;
    if (/^\d+x$/.test(tokens[i].norm)) continue;
    let cents = parseMoney(t);
    if (cents === null || cents <= 0) continue;
    let end = i;
    if (next === "mil") {
      cents *= 1000;
      end++;
    }
    const unit = tokens[end + 1]?.norm;
    if (unit && /^(reais|real|conto|contos|pila)$/.test(unit)) {
      end++;
      strong = true;
    }
    candidates.push({ cents, start, end, strong });
  }
  const best = candidates.find((c) => c.strong) ?? candidates[0];
  return best ? { cents: best.cents, start: best.start, end: best.end } : null;
}

/** "em 10 vezes", "10x", "em 3 parcelas", "parcelado em 12". */
export function findInstallments(n: string): number | null {
  const m = n.match(/\b(\d{1,2})\s*(?:x|vezes|parcelas)\b/) ?? n.match(/\bparcelad[oa] em (\d{1,2})\b/);
  if (!m) return null;
  const count = Number(m[1]);
  return count >= 2 && count <= 60 ? count : null;
}

/** "hoje", "ontem", "anteontem", "dia 15", "15/10", "15/10/2026". Sem data na mensagem, é hoje. */
export function findDate(n: string, now: Date): string {
  const t = today(now);
  if (/\banteontem\b/.test(n)) return shiftDays(t, -2);
  if (/\bontem\b/.test(n)) return shiftDays(t, -1);
  const full = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (full) {
    const year = full[3] ? (full[3].length === 2 ? `20${full[3]}` : full[3]) : t.slice(0, 4);
    const date = `${year}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
    if (isValidDate(date)) return date;
  }
  const day = n.match(/\bdia (\d{1,2})\b/);
  if (day) {
    const date = `${t.slice(0, 7)}-${day[1].padStart(2, "0")}`;
    if (isValidDate(date)) return date;
  }
  return t;
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Contas citadas na mensagem, na ordem em que aparecem. Nome igual vence nome parecido. */
export function findAccounts(n: string, accounts: AccountRef[]): Array<{ account: AccountRef; index: number }> {
  const found: Array<{ account: AccountRef; index: number }> = [];
  for (const account of accounts) {
    const name = normalize(account.name);
    if (!name) continue;
    const re = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
    const m = re.exec(n);
    if (m) found.push({ account, index: m.index });
  }
  // "Nubank" e "Nubank PJ": se os dois casam no mesmo ponto, fica o nome mais longo.
  return found
    .filter((f) => !found.some((o) => o !== f && o.index <= f.index && normalize(o.account.name).includes(normalize(f.account.name)) && o.account.name.length > f.account.name.length))
    .sort((a, b) => a.index - b.index);
}

const CATEGORY_HINTS: Array<[RegExp, string[]]> = [
  [/\b(mercado|supermercado|feira|padaria|acougue|hortifruti|atacadao|assai)\b/, ["Mercado", "Alimentação"]],
  [/\b(almoco|jantar|lanche|restaurante|ifood|pizza|cafe|hamburguer|delivery)\b/, ["Alimentação", "Restaurante", "Lazer"]],
  [/\b(uber|99|taxi|onibus|metro|gasolina|combustivel|posto|estacionamento|pedagio|passagem)\b/, ["Transporte"]],
  [/\b(aluguel|condominio|iptu)\b/, ["Moradia"]],
  [/\b(luz|energia|agua|internet|telefone|celular|gas)\b/, ["Contas da casa", "Moradia"]],
  [/\b(farmacia|remedio|medico|consulta|dentista|exame|plano de saude)\b/, ["Saúde"]],
  [/\b(cinema|bar|show|viagem|netflix|spotify|streaming|jogo)\b/, ["Lazer", "Assinaturas"]],
  [/\b(roupas?|tenis|sapato|loja|shopping|televisao|tv|celular novo|eletronico)\b/, ["Compras", "Outras saídas"]],
  [/\b(escola|faculdade|curso|livro|mensalidade)\b/, ["Educação"]],
  [/\b(salario|holerite|contracheque)\b/, ["Salário"]],
];

/** Categoria do tipo certo: nome citado, depois palavras típicas. Sem pista clara, fica sem categoria. */
export function findCategory(n: string, categories: CategoryRef[], kind: "income" | "expense"): CategoryRef | null {
  const ofKind = categories.filter((c) => c.kind === kind);
  const byName = ofKind.find((c) => new RegExp(`\\b${normalize(c.name)}\\b`).test(n));
  if (byName) return byName;
  for (const [re, names] of CATEGORY_HINTS) {
    if (!re.test(n)) continue;
    for (const name of names) {
      const cat = ofKind.find((c) => normalize(c.name) === normalize(name));
      if (cat) return cat;
    }
  }
  return null;
}

const FILLER = new Set([
  "gastei", "paguei", "comprei", "recebi", "ganhei", "caiu", "entrada", "saida", "despesa", "gasto", "compra", "receita",
  "reais", "real", "conto", "contos", "r$", "no", "na", "do", "da", "pelo", "pela", "com", "de", "em", "um", "uma", "o", "a",
  "adicionar", "cadastrar", "lembrar", "agendar", "pagar", "para", "todo", "mes",
  "cartao", "conta", "credito", "debito", "hoje", "ontem", "anteontem", "vezes", "x", "parcelas", "via", "pix", "e", "meu", "minha",
]);
const EDGE = new Set(["com", "de", "em", "no", "na", "um", "uma", "o", "a", "do", "da", "pelo", "pela", "para", "e"]);

/** O que sobra da mensagem depois de tirar valor, verbos, contas, parcelas e datas. */
export function extractDescription(text: string, amount: { start: number; end: number } | null, accountNames: string[]): string {
  const tokens = tokenize(text);
  const accountWords = new Set(accountNames.flatMap((name) => normalize(name).split(" ")));
  const keep = tokens.map((t, i) => {
    if (amount && i >= amount.start && i <= amount.end) return false;
    if (accountWords.has(t.norm)) return false;
    if (/^\d+x?$/.test(t.norm) && /^(x|vezes|parcelas)$/.test(tokens[i + 1]?.norm ?? "")) return false;
    if (/^\d+x$/.test(t.norm)) return false;
    if (t.norm === "dia" || (/^\d{1,2}$/.test(t.norm) && tokens[i - 1]?.norm === "dia")) return false;
    return true;
  });
  let words = tokens.filter((_, i) => keep[i]).map((t) => t);
  // Tira conectores e verbos das pontas ("com almoço" -> "almoço").
  while (words.length && (FILLER.has(words[0].norm) || EDGE.has(words[0].norm))) words = words.slice(1);
  while (words.length && (FILLER.has(words[words.length - 1].norm) || EDGE.has(words[words.length - 1].norm))) words = words.slice(0, -1);
  const result = words.map((w) => w.raw.replace(/[.,!?;:]+$/, "")).join(" ").trim().slice(0, 120);
  return result ? result[0].toUpperCase() + result.slice(1) : "";
}

/**
 * Monta o lançamento. Transferência: "do X para o Y". Pagar fatura: "da fatura do CARTÃO usando/com/pelo CONTA".
 * Conta não citada fica vazia (o assistente usa a conta padrão, se houver, ou pergunta).
 */
export function buildDraft(
  text: string,
  operation: Operation,
  ctx: { accounts: AccountRef[]; categories: CategoryRef[]; now: Date; scheduled?: boolean },
): Draft {
  const n = normalize(text);
  const amount = findAmount(text);
  const mentioned = findAccounts(n, ctx.accounts);
  let accountId: string | null = null;
  let destinationAccountId: string | null = null;

  if (operation === "transfer") {
    if (/\bfatura\b/.test(n)) {
      // "Paguei 500 da fatura do Nubank usando o Inter": sai do Inter, entra no cartão Nubank.
      const card = mentioned.find((m) => m.account.type === "credit_card");
      const payer = mentioned.find((m) => m !== card && m.account.type !== "credit_card");
      destinationAccountId = card?.account.id ?? null;
      accountId = payer?.account.id ?? null;
    } else {
      const split = n.search(/\b(para|pra|pro)\b/);
      const origin = mentioned.find((m) => m.index < split);
      const destination = mentioned.find((m) => m.index > split);
      accountId = origin?.account.id ?? null;
      destinationAccountId = destination?.account.id ?? null;
    }
  } else {
    // "no cartão X" tem prioridade; senão a primeira conta citada.
    const card = /\bcartao\b/.test(n) ? mentioned.find((m) => m.account.type === "credit_card") : undefined;
    accountId = (card ?? mentioned[0])?.account.id ?? null;
  }

  const category = operation === "transfer" ? null : findCategory(n, ctx.categories, operation);
  const accountNames = mentioned.map((m) => m.account.name);
  let description = extractDescription(text, amount, accountNames);
  if (operation === "transfer") description = /\bfatura\b/.test(n) ? "Pagamento de fatura" : "Transferência entre contas";
  if (!description) description = category?.name ?? (operation === "income" ? "Entrada" : "Despesa");

  const installments = operation === "expense" ? findInstallments(n) : null;
  const scheduled = ctx.scheduled === true;
  let date = findDate(n, ctx.now);
  // Agendar "para dia 5" quando hoje já é dia 20: é o dia 5 do mês que vem.
  if (scheduled && date < today(ctx.now) && /\bdia \d{1,2}\b/.test(n)) date = addMonths(date, 1);
  const repeatMonths = scheduled && /\btodo (dia|mes)\b/.test(n) ? 12 : null;
  if (scheduled) description = description.replace(/^(Adicionar|Cadastrar|Lembrar de pagar|Lembrar|Agendar)\s*/i, "").replace(/^(conta de|a conta de)\s*/i, "") || description;
  return {
    operation,
    amount: amount?.cents ?? null,
    description,
    categoryId: category?.id ?? null,
    accountId,
    destinationAccountId,
    installments,
    date,
    paid: !scheduled,
    repeatMonths,
  };
}

/** Primeiro campo que falta para o lançamento poder ser confirmado. */
export function missingField(draft: Draft): "amount" | "account" | "destination" | null {
  if (!draft.amount) return "amount";
  if (!draft.accountId) return "account";
  if (draft.operation === "transfer" && !draft.destinationAccountId) return "destination";
  return null;
}

/** Último dia do mês que vem, para consultas de "mês que vem". */
export function nextMonthOf(date: string): string {
  return addMonths(`${date.slice(0, 7)}-01`, 1).slice(0, 7);
}
