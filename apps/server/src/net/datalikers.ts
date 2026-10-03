/**
 * DATALIKERS — cliente da Cache API oficial, só backend (FASE Social Intelligence).
 *
 * O que esta camada garante, por ordem:
 *
 *   1. **Só o que está documentado.** Os 30 endpoints de dados vêm todos do
 *      OpenAPI oficial do gateway (`api.datalikers.com/openapi.json`, título
 *      "Cache API 2.10.1"). Não há um único caminho inventado: o que existe
 *      apenas em MCP (`search_users`, `get_user_stories`, datasets…) está
 *      **fora** daqui, porque não tem REST documentado.
 *   2. **A chave nunca sai daqui.** Vai no header `x-access-key` (a doc do
 *      produto mostra-o em curl) e a URL que se guarda para a proveniência é
 *      sempre reconstruída sem a chave — nem o fallback `?access_key=` deixa o
 *      segredo na matriz de fontes.
 *   3. **Sem chave, sem pedido.** `DATALIKERS_API_KEY` em falta devolve
 *      `NOT_CONFIGURED` antes de tocar na rede: a ferramenta recusa e diz o
 *      nome exato da variável, que é o padrão do Apify aqui ao lado.
 *   4. **Estado honesto por código HTTP.** 401/403 é chave (não "não existe"),
 *      404 é "não está no cache", 429 é limite, 5xx é erro do serviço —
 *      nunca tudo colado num "falhou".
 */
import { apiGet } from './ssrf.ts';

/** Base pública da Cache API. */
export const API = 'https://api.datalikers.com';
/** Página do produto, onde o header e o `access_key` estão documentados. */
export const DOCS = 'https://datalikers.com/cache-api';
/** OpenAPI oficial — é dele que sai o catálogo de baixo. */
export const OPENAPI = 'https://api.datalikers.com/openapi.json';

export type Plataforma = 'instagram' | 'tiktok';
export const PLATAFORMAS: readonly Plataforma[] = ['instagram', 'tiktok'];

export interface EndpointDL {
  /** Estável e único: serve de id de ferramenta e de id da fonte (`dl-<id>`). */
  id: string;
  plataforma: Plataforma;
  /** Caminho absoluto, exatamente como no OpenAPI. */
  caminho: string;
  /** Parâmetro obrigatório onde entra o alvo. Os opcionais (`cursor`, `limit`) ficam de fora. */
  param: string;
  rotulo: string;
  /** O que a tag oficial do OpenAPI diz que este caminho devolve. */
  desc: string;
  /** O que o utilizador tem de escrever no campo `alvo`. */
  alvo: string;
}

/**
 * Os 30 endpoints de dados da Cache API.
 *
 * As descrições são as `tags` do OpenAPI oficial, palavra por palavra
 * ("Cache-only, no live fallback" está lá e diz-se ao utilizador). Os outros
 * dois paths do documento — `/sys/healthcheck` e `/sys/balance` — são de
 * sistema e vivem em `saude()`, não são recurso de investigação.
 */
export const ENDPOINTS: readonly EndpointDL[] = [
  // ---- Instagram: user ----
  { id: 'ig-perfil', plataforma: 'instagram', caminho: '/v1/user/by/username', param: 'username', rotulo: 'Instagram · perfil por username', desc: 'Instagram user profiles — lookup by PK or username.', alvo: 'username sem @' },
  { id: 'ig-perfil-id', plataforma: 'instagram', caminho: '/v1/user/by/id', param: 'id', rotulo: 'Instagram · perfil por PK', desc: 'Instagram user profiles — lookup by PK or username.', alvo: 'PK numérico' },
  { id: 'ig-perfil-completo', plataforma: 'instagram', caminho: '/v2/user/by/id', param: 'id', rotulo: 'Instagram · perfil completo por PK', desc: 'Instagram user profile, extended.', alvo: 'PK numérico' },
  { id: 'ig-sobre', plataforma: 'instagram', caminho: '/v1/user/about', param: 'id', rotulo: 'Instagram · sobre o perfil', desc: 'Instagram user profiles — extended about info.', alvo: 'PK numérico' },
  { id: 'ig-rostos', plataforma: 'instagram', caminho: '/v1/user/face', param: 'id', rotulo: 'Instagram · análise de rosto (IA)', desc: 'Instagram user profiles — AI face analysis.', alvo: 'PK numérico' },
  { id: 'ig-seguidores', plataforma: 'instagram', caminho: '/v1/user/followers/by/username', param: 'username', rotulo: 'Instagram · seguidores por username', desc: 'Instagram user profiles — best-effort followers list.', alvo: 'username sem @' },
  { id: 'ig-seguidores-id', plataforma: 'instagram', caminho: '/v1/user/followers/by/id', param: 'id', rotulo: 'Instagram · seguidores por PK', desc: 'Instagram user profiles — best-effort followers list.', alvo: 'PK numérico' },

  // ---- Instagram: media ----
  { id: 'ig-publicacao', plataforma: 'instagram', caminho: '/v1/media/by/id', param: 'id', rotulo: 'Instagram · publicação por PK', desc: 'Instagram posts, reels, and carousels — lookup by PK.', alvo: 'PK numérico' },
  { id: 'ig-publicacao-code', plataforma: 'instagram', caminho: '/v1/media/by/code', param: 'code', rotulo: 'Instagram · publicação por shortcode', desc: 'Instagram posts, reels, and carousels — lookup by shortcode.', alvo: 'shortcode (ex: C8xYz12AbCd)' },
  { id: 'ig-publicacao-url', plataforma: 'instagram', caminho: '/v1/media/by/url', param: 'url', rotulo: 'Instagram · publicação por URL', desc: 'Instagram posts, reels, and carousels — lookup by full URL.', alvo: 'URL completa do post/reel' },
  { id: 'ig-story', plataforma: 'instagram', caminho: '/v1/story/by/id', param: 'id', rotulo: 'Instagram · story por PK', desc: 'Instagram stories — lookup by PK.', alvo: 'PK numérico' },
  { id: 'ig-story-url', plataforma: 'instagram', caminho: '/v1/story/by/url', param: 'url', rotulo: 'Instagram · story por URL', desc: 'Instagram stories — lookup by story URL.', alvo: 'URL do story' },
  { id: 'ig-destaque', plataforma: 'instagram', caminho: '/v1/highlight/by/id', param: 'id', rotulo: 'Instagram · destaque por PK', desc: 'Instagram story highlights — lookup by PK.', alvo: 'PK numérico' },
  { id: 'ig-destaque-url', plataforma: 'instagram', caminho: '/v1/highlight/by/url', param: 'url', rotulo: 'Instagram · destaque por URL', desc: 'Instagram story highlights — lookup by URL.', alvo: 'URL do destaque' },
  { id: 'ig-comentario', plataforma: 'instagram', caminho: '/v1/comment/by/id', param: 'id', rotulo: 'Instagram · comentário por PK', desc: 'Instagram comments — lookup by PK. Cache-only, no live fallback.', alvo: 'PK numérico' },

  // ---- Instagram: hashtag / local / áudio ----
  { id: 'ig-hashtag', plataforma: 'instagram', caminho: '/v1/hashtag/by/name', param: 'name', rotulo: 'Instagram · hashtag por nome', desc: 'Instagram hashtags — lookup by name.', alvo: 'nome sem #' },
  { id: 'ig-hashtag-id', plataforma: 'instagram', caminho: '/v1/hashtag/by/id', param: 'id', rotulo: 'Instagram · hashtag por PK', desc: 'Instagram hashtags — lookup by PK.', alvo: 'PK numérico' },
  { id: 'ig-localizacao', plataforma: 'instagram', caminho: '/v1/location/by/name', param: 'name', rotulo: 'Instagram · localização por nome', desc: 'Instagram locations — lookup by name search.', alvo: 'nome do local' },
  { id: 'ig-localizacao-id', plataforma: 'instagram', caminho: '/v1/location/by/id', param: 'id', rotulo: 'Instagram · localização por PK', desc: 'Instagram locations — lookup by PK.', alvo: 'PK numérico' },
  { id: 'ig-audio', plataforma: 'instagram', caminho: '/v1/track/by/id', param: 'id', rotulo: 'Instagram · áudio usado em reels', desc: 'Instagram audio tracks used in reels — lookup by PK.', alvo: 'PK numérico' },

  // ---- TikTok ----
  { id: 'tt-perfil', plataforma: 'tiktok', caminho: '/t1/user/by/username', param: 'username', rotulo: 'TikTok · perfil por unique_id', desc: 'TikTok user profiles — lookup by PK or unique_id (handle).', alvo: 'handle sem @' },
  { id: 'tt-perfil-id', plataforma: 'tiktok', caminho: '/t1/user/by/id', param: 'id', rotulo: 'TikTok · perfil por PK', desc: 'TikTok user profiles — lookup by PK or unique_id (handle).', alvo: 'PK numérico' },
  { id: 'tt-publicacao', plataforma: 'tiktok', caminho: '/t1/media/by/id', param: 'id', rotulo: 'TikTok · vídeo por PK', desc: 'TikTok videos — lookup by PK.', alvo: 'PK numérico' },
  { id: 'tt-publicacoes', plataforma: 'tiktok', caminho: '/t1/media/by/user', param: 'user_pk', rotulo: 'TikTok · vídeos de um perfil', desc: 'TikTok videos — lookup by owner user_pk.', alvo: 'user_pk do perfil' },
  { id: 'tt-comentario', plataforma: 'tiktok', caminho: '/t1/comment/by/id', param: 'id', rotulo: 'TikTok · comentário por PK', desc: 'TikTok comments — lookup by PK. Cache-only.', alvo: 'PK numérico' },
  { id: 'tt-comentarios', plataforma: 'tiktok', caminho: '/t1/comment/by/user', param: 'user_pk', rotulo: 'TikTok · comentários de um perfil', desc: 'TikTok comments — lookup by author user_pk. Cache-only.', alvo: 'user_pk do perfil' },
  { id: 'tt-hashtag', plataforma: 'tiktok', caminho: '/t1/hashtag/by/name', param: 'name', rotulo: 'TikTok · hashtag por nome', desc: 'TikTok hashtags (challenges) — lookup by name.', alvo: 'nome sem #' },
  { id: 'tt-hashtag-id', plataforma: 'tiktok', caminho: '/t1/hashtag/by/id', param: 'id', rotulo: 'TikTok · hashtag por PK', desc: 'TikTok hashtags (challenges) — lookup by PK.', alvo: 'PK numérico' },
  { id: 'tt-playlist', plataforma: 'tiktok', caminho: '/t1/playlist/by/id', param: 'id', rotulo: 'TikTok · playlist por PK', desc: 'TikTok playlists — lookup by PK.', alvo: 'PK numérico' },
  { id: 'tt-playlists', plataforma: 'tiktok', caminho: '/t1/playlist/by/user', param: 'user_pk', rotulo: 'TikTok · playlists de um perfil', desc: 'TikTok playlists — lookup by owner user_pk.', alvo: 'user_pk do perfil' },
];

const POR_ID = new Map(ENDPOINTS.map((e) => [e.id, e]));

export function endpoint(id: string): EndpointDL | null {
  return POR_ID.get(id) ?? null;
}

export function recursos(p: Plataforma): EndpointDL[] {
  return ENDPOINTS.filter((e) => e.plataforma === p);
}

/**
 * Nome curto de um recurso: o id sem o prefixo da plataforma. `ig-perfil` e
 * `tt-perfil` são `perfil` nos seus respetivos catálogos — como a resolução é
 * sempre dentro de uma plataforma, não há ambiguidade, e o utilizador escreve
 * a mesma palavra nos dois lados.
 */
export function aliasDe(id: string): string {
  return id.replace(/^(ig|tt)-/, '');
}

/** Resolve um nome de recurso (id ou alias) DENTRO de uma plataforma. */
export function recurso(plataforma: Plataforma, nome: string): EndpointDL | null {
  const n = nome.trim().toLowerCase();
  if (!n) return null;
  return recursos(plataforma).find((e) => e.id === n || aliasDe(e.id) === n) ?? null;
}

/** Existe este nome de recurso em ALGUMA plataforma? (para a mensagem de erro) */
export function existeEmAlgumLado(nome: string): EndpointDL | null {
  const n = nome.trim().toLowerCase();
  return ENDPOINTS.find((e) => e.id === n || aliasDe(e.id) === n) ?? null;
}

/** Lista legível para a mensagem de validação — id, alias e o que o alvo tem de ser. */
export function listaRecursos(p: Plataforma): string {
  return recursos(p)
    .map((e) => `${e.id}${aliasDe(e.id) !== e.id ? ` / ${aliasDe(e.id)}` : ''} (${e.alvo})`)
    .join(', ');
}

// ------------------------------------------------------------------ segredo

export interface TokenEstado { token: string | null; falta: string | null }

/** Só backend. `DATALIKERS_API_KEY` nunca aparece em resposta, log ou URL guardada. */
export function token(env: NodeJS.ProcessEnv = process.env): TokenEstado {
  const t = (env.DATALIKERS_API_KEY ?? '').trim();
  return t ? { token: t, falta: null } : { token: null, falta: 'DATALIKERS_API_KEY' };
}

/** Remove a chave de qualquer texto de erro. */
export function limpar(texto: string, tk: string | null): string {
  if (!tk) return texto;
  return texto.split(tk).join('[chave]')
    .replace(/(\baccess_key=)[^\s&"']+/gi, '$1[chave]')
    .replace(/(x-access-key['":\s]+)[^\s"',}]+/gi, '$1[chave]');
}

/** URL do pedido SEM a chave: é o que entra na matriz de fontes e nos logs. */
export function urlLimpa(ep: EndpointDL, alvo: string): string {
  return `${API}${ep.caminho}?${ep.param}=${encodeURIComponent(alvo)}`;
}

// ------------------------------------------------------------------ resposta

export type EstadoDL =
  | 'READY' | 'VAZIO' | 'NOT_CONFIGURED' | 'NAO_ENCONTRADO'
  | 'VALIDACAO' | 'RATE_LIMITED' | 'ERROR';

export interface RespostaDL {
  estado: EstadoDL;
  status: number | null;
  /** O `data` da resposta, ou o objeto inteiro quando não há invólucro. */
  dados: unknown;
  ms: number;
  /** Sempre sem a chave. */
  url: string;
  nota: string;
}

function parse(body: string): { dados: unknown; erro: string | null } {
  let j: unknown;
  try { j = JSON.parse(body); } catch { return { dados: null, erro: 'resposta não é JSON' }; }
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = j as Record<string, unknown>;
    if (o.state === false) return { dados: null, erro: String(o.error ?? o.message ?? 'estado false') };
    if ('data' in o) return { dados: o.data, erro: null };
  }
  return { dados: j, erro: null };
}

function vazio(d: unknown): boolean {
  if (d == null) return true;
  if (Array.isArray(d)) return d.length === 0;
  if (typeof d === 'object') return Object.keys(d as object).length === 0;
  if (typeof d === 'string') return d.trim() === '';
  return false;
}

/**
 * Um pedido. A chave vai no header `x-access-key`; se o gateway responder 401
 * tenta-se uma vez o mecanismo documentado no Swagger (`?access_key=`) e a URL
 * guardada continua a ser `urlLimpa` — o segredo não fica em lado nenhum.
 */
export async function pedir(
  ep: EndpointDL, alvo: string, env: NodeJS.ProcessEnv = process.env,
): Promise<RespostaDL> {
  const url = urlLimpa(ep, alvo);
  const t = token(env);
  if (!t.token) {
    return { estado: 'NOT_CONFIGURED', status: null, dados: null, ms: 0, url, nota: `${t.falta} em falta` };
  }

  const t0 = Date.now();
  try {
    const r = await apiGet(url, {
      headers: { accept: 'application/json', 'x-access-key': t.token },
      timeoutMs: 20_000,
      maxBytes: 3_000_000,
    });
    let status = r.status;
    let body = r.body;

    if (status === 401 || status === 403) {
      // O OpenAPI declara `access_key` como apiKey in query: é o mecanismo
      // oficial do gateway, não um truque nosso. A URL guardada continua limpa.
      const alt = `${url}&access_key=${encodeURIComponent(t.token)}`;
      const r2 = await apiGet(alt, {
        headers: { accept: 'application/json' },
        timeoutMs: 20_000,
        maxBytes: 3_000_000,
      });
      if (r2.status >= 200 && r2.status < 300) { status = r2.status; body = r2.body; }
    }

    const ms = Date.now() - t0;
    const { dados, erro } = parse(body);

    if (status === 401 || status === 403) {
      return { estado: 'NOT_CONFIGURED', status, dados: null, ms, url, nota: `chave rejeitada pela DataLikers (${status})` };
    }
    if (status === 404) {
      return { estado: 'NAO_ENCONTRADO', status, dados: null, ms, url, nota: 'não está no cache da DataLikers (404)' };
    }
    if (status === 400 || status === 422) {
      return { estado: 'VALIDACAO', status, dados: null, ms, url, nota: limpar(`pedido recusado (${status}): ${erro ?? body.slice(0, 200)}`, t.token) };
    }
    if (status === 429) {
      return { estado: 'RATE_LIMITED', status, dados: null, ms, url, nota: '429: limite de pedidos da DataLikers' };
    }
    if (status < 200 || status >= 300) {
      return { estado: 'ERROR', status, dados: null, ms, url, nota: limpar(`HTTP ${status}: ${(erro ?? body).slice(0, 300)}`, t.token) };
    }
    if (erro) {
      return { estado: 'ERROR', status, dados: null, ms, url, nota: limpar(erro, t.token) };
    }
    if (vazio(dados)) {
      return { estado: 'VAZIO', status, dados: null, ms, url, nota: 'resposta vazia: nada em cache para este alvo' };
    }
    return { estado: 'READY', status, dados, ms, url, nota: `${ep.rotulo} · ${ms}ms` };
  } catch (e) {
    return {
      estado: 'ERROR', status: null, dados: null, ms: Date.now() - t0, url,
      nota: limpar(String((e as Error)?.message ?? e), t.token),
    };
  }
}

// ------------------------------------------------------------------- health

export interface SaudeDL {
  status: 'READY' | 'NOT_CONFIGURED' | 'ERROR';
  nota: string;
  latenciaMs: number | null;
  /** Nunca é a chave: é o saldo/formato que a conta devolve, ou null. */
  conta: string | null;
}

/**
 * Health do serviço: primeiro o `/sys/healthcheck` (responde sem chave, portanto
 * mede a disponibilidade real da API) e depois o `/sys/balance` com a chave —
 * que é o que prova que a chave é aceite. Sem chave não se faz nenhum pedido.
 */
export async function saude(env: NodeJS.ProcessEnv = process.env): Promise<SaudeDL> {
  const t = token(env);
  if (!t.token) {
    return { status: 'NOT_CONFIGURED', nota: `${t.falta} em falta — sem pedido feito`, latenciaMs: null, conta: null };
  }
  const t0 = Date.now();
  try {
    const h = await apiGet(`${API}/sys/healthcheck`, { timeoutMs: 12_000, maxBytes: 64_000 });
    if (h.status < 200 || h.status >= 300) {
      return { status: 'ERROR', nota: `/sys/healthcheck respondeu ${h.status}`, latenciaMs: Date.now() - t0, conta: null };
    }
    const b = await apiGet(`${API}/sys/balance`, {
      headers: { accept: 'application/json', 'x-access-key': t.token },
      timeoutMs: 12_000, maxBytes: 64_000,
    });
    const ms = Date.now() - t0;
    if (b.status === 401 || b.status === 403) {
      return { status: 'NOT_CONFIGURED', nota: `chave rejeitada (${b.status}) — verifique DATALIKERS_API_KEY`, latenciaMs: ms, conta: null };
    }
    if (b.status < 200 || b.status >= 300) {
      return { status: 'ERROR', nota: `/sys/balance respondeu ${b.status}`, latenciaMs: ms, conta: null };
    }
    let conta: string | null = null;
    try {
      const j = JSON.parse(b.body) as Record<string, unknown>;
      const bruto = j.balance ?? j.data ?? j.credit ?? j;
      if (typeof bruto === 'number') conta = `saldo ${bruto}`;
      else if (typeof bruto === 'string') conta = `saldo ${bruto}`;
      else if (bruto && typeof bruto === 'object') {
        const o = bruto as Record<string, unknown>;
        const v = o.balance ?? o.credit ?? o.total;
        if (v != null) conta = `saldo ${String(v)}`;
      }
    } catch { /* o saldo é informativo: sem ele não se falha o health */ }
    return { status: 'READY', nota: 'API acessível e chave aceite', latenciaMs: ms, conta };
  } catch (e) {
    return { status: 'ERROR', nota: limpar(String((e as Error)?.message ?? e), t.token), latenciaMs: Date.now() - t0, conta: null };
  }
}
