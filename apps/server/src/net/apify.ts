/**
 * APIFY — engine separado do núcleo OSINT (FASE D).
 *
 * O Apify não é uma ferramenta que o ARGOS instala: é um serviço externo pago,
 * a que se acede com um token que **só existe no backend** (`APIFY_API_TOKEN`).
 * Daí as regras todas deste ficheiro:
 *
 *  - **O token nunca sai daqui.** Não entra em findings, não entra em logs, não
 *    entra em URLs de erro: vai no header `Authorization`, e o que é devolvido
 *    ao cliente é o estado, nunca a credencial.
 *  - **Sem token → `NOT_CONFIGURED` com o nome EXATO da variável.** A APIFY do
 *    ARGOS está desligada e diz isso, em vez de fingir que procura.
 *  - **Registry aberto.** Um actor novo é UMA entrada em `ACTORS` — com `actorId`,
 *    plataforma, input, normalizador e os campos que sabemos extrair. Nada mais.
 *  - **Saída sem filtro artificial.** O que o actor devolver é devolvido todo;
 *    o normalizador só destaca campos públicos conhecidos quando existem, e
 *    guarda sempre o item original por baixo.
 *
 * Os oito actors do conjunto inicial estão declarados com o `actorId` verificado
 * na Store do Apify a 2026-10-01. Três deles NÃO são `apify/*` (TikTok ×2 e Tweet)
 * e estão marcados `oficial: false` — o utilizador tem de saber que está a correr
 * um actor de terceiros.
 *
 * Custo: os oito são `pay-per-event`. Correr um actor gasta dinheiro da conta
 * Apify, por isso a ferramenta exige confirmação explícita antes de executar.
 *
 * Conta Free: sete dos oito correm via API dentro do crédito mensal; o
 * `apidojo/tweet-scraper` tem `viaApiNaFree: false` porque a Apify só o permite
 * em modo demo na Console — por API exige plano pago. O ARGOS nunca adivinha o
 * plano da conta: diz a restrição e deixa correr quem puder pagar.
 */
import type { FindingValue } from './provenance.ts';

export type Plataforma = 'instagram' | 'tiktok' | 'facebook' | 'x';
export type StatusActor = 'READY' | 'NOT_CONFIGURED' | 'AGUARDA_CONFIRMACAO' | 'ERROR' | 'RATE_LIMITED' | 'DISABLED' | 'PAYMENT_REQUIRED';

export interface ActorDef {
  /** `owner/name` oficial na Store (verificado). */
  actorId: string;
  name: string;
  platform: Plataforma;
  /** true só quando o dono é `apify`. */
  oficial: boolean;
  /**
   * `false` = na conta Free a Apify só permite este actor em modo demo na
   * Console; via API (o caminho do ARGOS) exige plano pago. Verificado na
   * página de pricing do actor a 2026-10-01. Obrigatório: um actor novo tem
   * de dizer como é cobrado na conta gratuita.
   */
  viaApiNaFree: boolean;
  /** Campos de input que este actor aceita (documentados na Store). */
  inputSchema: string[];
  /** Campos que o ARGOS destaca quando o actor os devolve. */
  outputSchema: string[];
  enabled: boolean;
  /** Constrói o input do actor a partir do alvo (puro, sem rede). */
  input: (alvo: string) => Record<string, FindingValue>;
  /** Item → achados. Nunca acrescenta o que não veio no item. */
  normalizer: (item: unknown) => { rotulo: string; valor: FindingValue }[];
}

/** Estado observado por actor (memória do processo, não é segredo). */
export interface EstadoActor {
  status: StatusActor;
  lastRun: string | null;
  error: string | null;
}

const estados = new Map<string, EstadoActor>();
export function estadoDe(actorId: string): EstadoActor {
  return estados.get(actorId) ?? { status: 'NOT_CONFIGURED', lastRun: null, error: null };
}
function marcar(actorId: string, s: StatusActor, error: string | null): void {
  estados.set(actorId, { status: s, lastRun: new Date().toISOString(), error });
}

// ------------------------------------------------------------- normalizador

/** Chaves que sabemos extrair — presentes ou não, o item inteiro fica na mesma. */
const CHAVES = [
  'username', 'userName', 'user_name', 'name', 'fullName', 'full_name', 'firstName', 'lastName',
  'biography', 'bio', 'description', 'profilePicUrl', 'profile_pic_url', 'avatar', 'url', 'permalink',
  'followersCount', 'followers', 'followerCount', 'followingCount', 'following', 'likesCount',
  'mediaCount', 'postsCount', 'commentCount', 'repliesCount', 'retweetCount', 'quoteCount',
  'timestamp', 'createdAt', 'date', 'takenAt', 'type', 'platform', 'verified', 'isVerified', 'private', 'isPrivate',
] as const;

function normalizaItem(item: unknown, campos: readonly string[]): { rotulo: string; valor: FindingValue }[] {
  if (item === null || item === undefined) return [];
  if (typeof item !== 'object') {
    return [{ rotulo: 'valor devolvido', valor: item as FindingValue }];
  }
  const obj = item as Record<string, unknown>;
  const destaque: Record<string, FindingValue> = {};
  for (const k of CHAVES) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) destaque[k] = obj[k] as FindingValue;
  }
  const fora: string[] = [];
  for (const k of Object.keys(obj)) if (!(k in destaque)) fora.push(k);
  const out: { rotulo: string; valor: FindingValue }[] = [];
  if (Object.keys(destaque).length) out.push({ rotulo: 'campos públicos', valor: destaque });
  if (fora.length) out.push({ rotulo: `outros ${fora.length} campo(s) devolvidos`, valor: obj as FindingValue });
  if (!out.length) out.push({ rotulo: 'item', valor: obj as FindingValue });
  void campos;
  return out;
}

// ---------------------------------------------------------------- registry

export const ACTORS: ActorDef[] = [
  {
    actorId: 'apify/instagram-scraper', name: 'Instagram Scraper', platform: 'instagram', oficial: true, viaApiNaFree: true,
    inputSchema: ['directUrls', 'resultsLimit'], outputSchema: ['username', 'fullName', 'biography', 'followersCount', 'postsCount', 'url'],
    enabled: true,
    input: (alvo) => ({ directUrls: [alvo.startsWith('http') ? alvo : `https://www.instagram.com/${alvo.replace(/^@/, '')}/`] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'apify/instagram-profile-scraper', name: 'Instagram Profile Scraper', platform: 'instagram', oficial: true, viaApiNaFree: true,
    inputSchema: ['usernames'], outputSchema: ['username', 'fullName', 'biography', 'followersCount', 'followingCount', 'profilePicUrl'],
    enabled: true,
    input: (alvo) => ({ usernames: [alvo.replace(/^@/, '')] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'apify/instagram-comment-scraper', name: 'Instagram Comments Scraper', platform: 'instagram', oficial: true, viaApiNaFree: true,
    inputSchema: ['directUrls', 'resultsLimit'], outputSchema: ['username', 'text', 'timestamp', 'likesCount'],
    enabled: true,
    input: (alvo) => ({ directUrls: [alvo] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'apify/instagram-followers-following-scraper', name: 'Instagram Followers/Following Scraper', platform: 'instagram', oficial: true, viaApiNaFree: true,
    inputSchema: ['usernames', 'dataToScrape', 'resultsLimit'], outputSchema: ['username', 'fullName', 'followersCount'],
    enabled: true,
    input: (alvo) => ({ usernames: [alvo.replace(/^@/, '')], dataToScrape: 'Followers' }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'clockworks/tiktok-scraper', name: 'TikTok Scraper', platform: 'tiktok', oficial: false, viaApiNaFree: true,
    inputSchema: ['profiles', 'postURLs', 'hashtags', 'searchQueries'], outputSchema: ['username', 'authorName', 'desc', 'playCount', 'diggCount', 'createTime'],
    enabled: true,
    input: (alvo) => ({ profiles: [alvo.startsWith('http') ? alvo : `https://www.tiktok.com/@${alvo.replace(/^@/, '')}`] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'clockworks/tiktok-profile-scraper', name: 'TikTok Profile Scraper', platform: 'tiktok', oficial: false, viaApiNaFree: true,
    inputSchema: ['profiles'], outputSchema: ['nickname', 'signature', 'followerCount', 'followingCount', 'heartCount', 'videoCount'],
    enabled: true,
    input: (alvo) => ({ profiles: [alvo.startsWith('http') ? alvo : `https://www.tiktok.com/@${alvo.replace(/^@/, '')}`] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'apify/facebook-posts-scraper', name: 'Facebook Posts Scraper', platform: 'facebook', oficial: true, viaApiNaFree: true,
    inputSchema: ['startUrls', 'resultsLimit'], outputSchema: ['url', 'text', 'timestamp', 'reactionsCount', 'commentsCount', 'sharesCount'],
    enabled: true,
    input: (alvo) => ({ startUrls: [{ url: alvo }] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
  {
    actorId: 'apidojo/tweet-scraper', name: 'Tweet Scraper', platform: 'x', oficial: false, viaApiNaFree: false,
    inputSchema: ['twitterHandles', 'startUrls', 'searchTerms', 'maxItems'], outputSchema: ['author', 'text', 'createdAt', 'likeCount', 'retweetCount', 'url'],
    enabled: true,
    input: (alvo) => ({ twitterHandles: [alvo.replace(/^@/, '')] }),
    normalizer: (i) => normalizaItem(i, CHAVES),
  },
];

/** Registry aberto: um actor novo é uma entrada destas. */
export function registarActor(a: ActorDef): void {
  const i = ACTORS.findIndex((x) => x.actorId === a.actorId);
  if (i >= 0) ACTORS[i] = a; else ACTORS.push(a);
}

export function escolherActors(plataforma?: string, ids?: string): ActorDef[] {
  let l = ACTORS.filter((a) => a.enabled);
  const p = String(plataforma ?? '').trim().toLowerCase();
  if (p) l = l.filter((a) => a.platform === p);
  const bruto = String(ids ?? '').trim();
  if (bruto) {
    const alvo = bruto.toLowerCase().split(/[,\s]+/).filter(Boolean);
    const f = l.filter((a) => alvo.some((x) => a.actorId.toLowerCase() === x || a.name.toLowerCase().includes(x) || a.platform === x));
    if (f.length) l = f;
  }
  return l;
}

// ------------------------------------------------------------------- token

export interface TokenEstado { token: string | null; falta: string | null }

/** Só backend. `APIFY_API_TOKEN` é o nome do spec; `APIFY_TOKEN` é o da doc oficial. */
export function token(env: NodeJS.ProcessEnv = process.env): TokenEstado {
  const t = (env.APIFY_API_TOKEN ?? env.APIFY_TOKEN ?? '').trim();
  return t ? { token: t, falta: null } : { token: null, falta: 'APIFY_API_TOKEN' };
}

/** Nunca deixar a credencial aparecer numa mensagem. */
export function limpar(texto: string, tk: string | null): string {
  if (!tk) return texto;
  return texto.split(tk).join('[chave removida]')
    .replace(/([?&]token=)[^\s&"']+/gi, '$1[chave]')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1[chave]');
}

/**
 * Defesa em profundidade: percorre qualquer estrutura e redige a chave onde quer
 * que ela apareça (usa `limpar`, portanto também `?token=` e `Bearer`). O
 * `/api/health` aplica isto ao relatório inteiro antes de o devolver — mesmo
 * que uma linha futura escreva o valor por engano, ele não sai do backend.
 */
export function foraDeAlcance<T>(valor: T, tk: string | null): T {
  if (!tk) return valor;
  if (typeof valor === 'string') return limpar(valor, tk) as unknown as T;
  if (Array.isArray(valor)) return valor.map((v) => foraDeAlcance(v, tk)) as unknown as T;
  if (valor !== null && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) out[k] = foraDeAlcance(v, tk);
    return out as T;
  }
  return valor;
}

// ------------------------------------------------------------------ runner

const API = 'https://api.apify.com/v2';

function caminhoActor(actorId: string): string {
  return `${actorId.replace('/', '~')}`;
}

/**
 * Health check do serviço. Sem token não faz sequer o pedido: `NOT_CONFIGURED`
 * é o estado honesto e é o que o teste sem token espera.
 */
export async function saude(env: NodeJS.ProcessEnv = process.env): Promise<{
  status: StatusActor; nota: string; latenciaMs: number | null; conta: string | null;
}> {
  const t = token(env);
  if (!t.token) return { status: 'NOT_CONFIGURED', nota: `${t.falta} em falta — APIFY desligado no ARGOS`, latenciaMs: null, conta: null };
  const t0 = Date.now();
  try {
    const r = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(15_000) });
    const ms = Date.now() - t0;
    if (r.status === 401) return { status: 'NOT_CONFIGURED', nota: 'chave rejeitada (401): verifique APIFY_API_TOKEN', latenciaMs: ms, conta: null };
    if (!r.ok) return { status: 'ERROR', nota: `API do Apify respondeu ${r.status}`, latenciaMs: ms, conta: null };
    const j = await r.json() as { data?: { username?: string } };
    return { status: 'READY', nota: 'API acessível com esta chave', latenciaMs: ms, conta: j.data?.username ?? null };
  } catch (e) {
    return { status: 'ERROR', nota: limpar(String((e as Error).message ?? e), t.token), latenciaMs: Date.now() - t0, conta: null };
  }
}

/**
 * Corre um actor e devolve TODOS os itens do dataset — sem limite artificial.
 * `POST /v2/acts/{owner}~{name}/run-sync-get-dataset-items` (a doc oficial do
 * Apify, verificada): um pedido, o run corre, devolve os itens já prontos.
 */
export async function correr(actor: ActorDef, alvo: string, env: NodeJS.ProcessEnv = process.env): Promise<{
  status: StatusActor; nota: string; itens: unknown[]; ms: number;
}> {
  const t = token(env);
  const t0 = Date.now();
  if (!t.token) {
    marcar(actor.actorId, 'NOT_CONFIGURED', `${t.falta} em falta`);
    return { status: 'NOT_CONFIGURED', nota: `${t.falta} em falta`, itens: [], ms: 0 };
  }
  const body = JSON.stringify(actor.input(alvo));
  try {
    const r = await fetch(`${API}/acts/${caminhoActor(actor.actorId)}/run-sync-get-dataset-items?timeout=240`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
      body, signal: AbortSignal.timeout(250_000),
    });
    const ms = Date.now() - t0;
    const txt = await r.text();
    if (r.status === 401 || r.status === 403) {
      const nota = `chave sem acesso a este actor (${r.status})`;
      marcar(actor.actorId, 'NOT_CONFIGURED', nota);
      return { status: 'NOT_CONFIGURED', nota, itens: [], ms };
    }
    if (r.status === 402) {
      const nota = '402: a conta Apify não tem crédito para este actor (é pay-per-event)';
      marcar(actor.actorId, 'PAYMENT_REQUIRED', nota);
      return { status: 'PAYMENT_REQUIRED', nota, itens: [], ms };
    }
    if (r.status === 429) {
      const nota = '429: limite de pedidos do Apify atingido';
      marcar(actor.actorId, 'RATE_LIMITED', nota);
      return { status: 'RATE_LIMITED', nota, itens: [], ms };
    }
    if (!r.ok) {
      const nota = limpar(`HTTP ${r.status}: ${txt.slice(0, 300)}`, t.token);
      marcar(actor.actorId, 'ERROR', nota);
      return { status: 'ERROR', nota, itens: [], ms };
    }
    let itens: unknown[] = [];
    try {
      const j = JSON.parse(txt) as unknown;
      itens = Array.isArray(j) ? j : [j];
    } catch {
      const nota = 'resposta não é JSON — não se inventa conteúdo a partir de texto bruto';
      marcar(actor.actorId, 'ERROR', nota);
      return { status: 'ERROR', nota, itens: [], ms };
    }
    marcar(actor.actorId, 'READY', null);
    return { status: 'READY', nota: itens.length ? `${itens.length} item(ns) sem filtro artificial` : 'run sem itens', itens, ms };
  } catch (e) {
    const nota = limpar(String((e as Error).message ?? e), t.token);
    marcar(actor.actorId, 'ERROR', nota);
    return { status: 'ERROR', nota, itens: [], ms: Date.now() - t0 };
  }
}

/** Matriz de dependência deste engine (usada pela página de saúde). */
export function matriz(env: NodeJS.ProcessEnv = process.env): {
  nome: string; módulo: string; tipo: string; runtime: string; versao: string | null;
  cliApi: string; dependencias: string; apikey: string; servicoExterno: string; status: string; health: string;
}[] {
  const t = token(env);
  return ACTORS.map((a) => ({
    nome: a.name, módulo: 'APIFY', tipo: 'actor', runtime: 'API remota',
    versao: null, cliApi: 'REST', dependencias: 'nenhuma local',
    apikey: t.falta ?? 'APIFY_API_TOKEN (configurada)', servicoExterno: `apify.com/${a.actorId}`,
    status: a.enabled ? estadoDe(a.actorId).status : 'DISABLED',
    health: t.token ? 'com token — health check disponível' : `${t.falta} em falta`,
  }));
}
