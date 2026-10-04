/**
 * Créditos do modelo híbrido (DataLikers).
 *
 * A ideia, em duas linhas: a chave do servidor serve a toda a gente até uma
 * certaina de consultas por mês; a partir daí, ou o utilizador compra mais
 * créditos, ou cola a sua própria chave e passa a contar contra a conta dele.
 *
 * Três decisões que valem a pena escrever, porque são as que é fácil refazer
 * mal:
 *
 *  1. **A chave do próprio utilizador vence a do servidor.** Não é uma
 *     alternativa: é a preferida. Quem traz a chave própria não gasta o
 *     crédito partilhado com mais ninguém, e por isso **não tem limite
 *     mensal** — o limite é do fornecedor, não nosso.
 *  2. **A chave nunca sai do servidor.** Fica cifrada em disco
 *     (AES-256-GCM, a mesma cifra das BYOK), nunca entra numa resposta, num
 *     log, numa URL guardada nem num erro.
 *  3. **Só se conta o que foi pedir ao fornecedor.** Uma execução que nem
 *     chegou a sair (validação local, recurso inválido) não consome o
 *     crédito de ninguém.
 */
import { q, encryptSecret, decryptSecret } from './db.ts';
import { PLANS, type PlanId } from './plans.ts';

/**
 * Ferramentas com créditos partilhados.
 *
 * O nome é o id do catálogo. A DataLikers é a que existe; a Shodan fica
 * registada porque a quota é um conceito por ferramenta e ter o número
 * provisionado evita que, quando a ferramenta aparecer, alguém invente um
 * limite novo em vez de usar o que já foi decidido. ** enquanto não houver
 * ferramenta que a consuma, a linha não é debitada** — é provisionamento,
 * nao e uma funcao morta a fingir que trabalha.
 */
export const TOOL_CREDITOS = 'datalikers';
export const TOOL_SHODAN = 'shodan';

/** Onde vão os dois botões do ecrã de créditos esgotados. */
export const CHECKOUT_PADRAO = 'https://datalikers.com/p/zql3ar9f';
export const AFILIADO_PADRAO = 'https://datalikers.com/p/zql3ar9f';

export function checkoutUrl(): string {
  return (process.env.DATALIKERS_CHECKOUT_URL || CHECKOUT_PADRAO).trim();
}
export function afiliadoUrl(): string {
  return (process.env.DATALIKERS_AFFILIATE_URL || AFILIADO_PADRAO).trim();
}

/**
 * Erro de créditos esgotados.
 *
 * Distinto do `QuotaError` do registo (que é o limite diário de execuções do
 * plano) porque a resposta é outra: aqui não é "espera um dia", é "compra
 * créditos ou traz a tua chave". A rota transforma-o em 402 com o X e o Y.
 */
export class CreditosEsgotadosError extends Error {
  readonly used: number;
  readonly limit: number;
  constructor(used: number, limit: number) {
    super(`Créditos DataLikers esgotados: ${used} de ${limit} consultas este mês.`);
    this.name = 'CreditosEsgotadosError';
    this.used = used;
    this.limit = limit;
  }
}

/** 'AAAA-MM' do mês corrente em UTC — o mesmo fuso do carimbo de `usage`. */
export function periodoDe(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface LinhaQuota {
  used_this_month: number;
  limit_month: number | null;
  custom_key: string | null;
  periodo: string;
}

function linha(userId: string, tool: string): LinhaQuota | null {
  const r = q('SELECT used_this_month, limit_month, custom_key, periodo FROM user_quotas WHERE user_id = ? AND tool = ?')
    .get(userId, tool) as LinhaQuota | undefined;
  return r ?? null;
}

/**
 * O estado dos créditos de uma pessoa.
 *
 * `usados` só conta o período corrente: se o mês já mudou, a linha antiga
 * significa zero. É por isso que o `periodo` é guardado.
 */
export function estado(userId: string, tool: string, plan: PlanId, isAdmin = false): {
  usados: number; limite: number; periodo: string; temChavePropria: boolean; esgotado: boolean;
} {
  const agora = periodoDe();
  const l = linha(userId, tool);
  const mesmoPeriodo = !!l && l.periodo === agora;
  const usados = mesmoPeriodo ? l!.used_this_month : 0;
  const limite = (mesmoPeriodo ? l!.limit_month : null) ?? limiteDoPlano(tool, plan, isAdmin);
  const temChavePropria = !!chavePropria(userId, tool);
  return {
    usados,
    limite,
    periodo: agora,
    temChavePropria,
    // Com chave própria o limite é o do fornecedor: o nosso não se aplica.
    esgotado: !temChavePropria && usados >= limite,
  };
}

/**
 * O limite mensal, pela regra única do produto:
 *
 *   admin  OU  pro  -> 200 consultas de DataLikers e 50 de Shodan por mês
 *   free            -> 0, e as ferramentas pagas ficam trancadas pelo plano
 *
 * O `pro_max` fica acima do pro (é o plano mais caro que existe) e o admin
 * fica no escalão do pro: quem opera o serviço tem as mesmas ferramentas que
 * um cliente Pro, não mais — não há caminho para o admin se auto-atribuir
 * limites que os clientes não têm.
 */
const LIMITES: Record<string, { pro: number; pro_max: number }> = {
  [TOOL_CREDITOS]: { pro: 200, pro_max: 1000 },
  [TOOL_SHODAN]: { pro: 50, pro_max: 200 },
};

function limiteDoPlano(tool: string, plan: PlanId, isAdmin = false): number {
  const escalao = isAdmin ? 'pro' : plan;
  const linha = LIMITES[tool];
  if (!linha) return 0;
  if (escalao === 'free') return 0;
  return escalao === 'pro_max' ? linha.pro_max : linha.pro;
}

/** +1 consulta. Só é chamado depois de o pedido ter saído para o fornecedor. */
export function consumir(userId: string, tool: string): void {
  const agora = periodoDe();
  const iso = new Date().toISOString();
  q(`INSERT INTO user_quotas(user_id, tool, used_this_month, limit_month, custom_key, periodo, updated_at)
     VALUES(?,?,1,NULL,NULL,?,?)
     ON CONFLICT(user_id, tool) DO UPDATE SET
       used_this_month = CASE WHEN user_quotas.periodo = excluded.periodo
                              THEN user_quotas.used_this_month + 1 ELSE 1 END,
       periodo = excluded.periodo,
       updated_at = excluded.updated_at`)
    .run(userId, tool, agora, iso);
}

/** A chave do próprio utilizador, em claro. Só para uso interno do servidor. */
export function chavePropria(userId: string, tool: string): string | null {
  const l = linha(userId, tool);
  const enc = l?.custom_key;
  if (!enc) return null;
  try {
    const k = decryptSecret(enc);
    return k.trim() || null;
  } catch {
    // Chave cifrada com outra cifra (ARGUS_SECRET mudou): trata-se como
    // inexistente. A pessoa volta a colar a chave; nunca se tenta adivinhar.
    return null;
  }
}

/** Guarda a chave do próprio utilizador, cifrada. Devolve o que foi guardado. */
export function guardarChavePropria(userId: string, tool: string, chave: string): void {
  const agora = periodoDe();
  const iso = new Date().toISOString();
  q(`INSERT INTO user_quotas(user_id, tool, used_this_month, limit_month, custom_key, periodo, updated_at)
     VALUES(?,?,0,NULL,?,?,?)
     ON CONFLICT(user_id, tool) DO UPDATE SET
       custom_key = excluded.custom_key,
       updated_at = excluded.updated_at`)
    .run(userId, tool, encryptSecret(chave.trim()), agora, iso);
}

/** Apaga a chave do próprio utilizador (volta à partilhada do servidor). */
export function apagarChavePropria(userId: string, tool: string): void {
  q('UPDATE user_quotas SET custom_key = NULL, updated_at = ? WHERE user_id = ? AND tool = ?')
    .run(new Date().toISOString(), userId, tool);
}

/**
 * O limite *definido à mão* para esta pessoa, ou `null` se segue o plano.
 *
 * Distingue "o limite é 200 porque é o que o PRO dá" de "o limite é 200 porque
 * o admin o pôs". Sem esta distinção o painel de administração mostrava um
 * número e não dizia se mexer nele ia mudar alguma coisa — e não há forma de
 * voltar ao valor do plano sem ela.
 *
 * Só conta se for do período corrente: um override de Janeiro não deve
 * aparecer em Fevereiro como se ainda valesse.
 */
export function limiteDefinido(userId: string, tool: string): number | null {
  const l = linha(userId, tool);
  if (!l || l.periodo !== periodoDe()) return null;
  return l.limit_month ?? null;
}

/** Altera o limite mensal de uma pessoa. `null` volta ao limite do plano. */
export function definirLimite(userId: string, tool: string, limite: number | null): void {
  const agora = periodoDe();
  q(`INSERT INTO user_quotas(user_id, tool, used_this_month, limit_month, custom_key, periodo, updated_at)
     VALUES(?,?,0,?,NULL,?,?)
     ON CONFLICT(user_id, tool) DO UPDATE SET
       limit_month = excluded.limit_month, updated_at = excluded.updated_at`)
    .run(userId, tool, limite, agora, new Date().toISOString());
}

/**
 * A chave que este pedido vai usar, e de onde vem.
 *
 * Devolve um `env` pronto a passar à camada de rede — que é a assinatura que
 * `net/datalikers.ts` já tem. Não é elegância: é o que garante que a chave
 * entra **apenas** no header `x-access-key` e em mais lado nenhum.
 */
export function chaveEfetiva(userId: string, tool: string): {
  env: NodeJS.ProcessEnv; origem: 'propria' | 'servidor' | 'nenhuma';
} {
  const propria = chavePropria(userId, tool);
  if (propria) return { env: { DATALIKERS_API_KEY: propria }, origem: 'propria' };
  const doServidor = (process.env.DATALIKERS_API_KEY ?? '').trim();
  if (doServidor) return { env: { DATALIKERS_API_KEY: doServidor }, origem: 'servidor' };
  return { env: {}, origem: 'nenhuma' };
}
