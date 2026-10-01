/**
 * Presença social pública: Bluesky e Mastodon.
 *
 * Estas duas são as únicas redes com **API pública de leitura sem chave e sem
 * aprovação de app** — é isso que permite prometer o que se entrega. Instagram,
 * TikTok, X e LinkedIn ficam de fora em separado, não por esquecimento: não há
 * API pública para os dados que se pediriam, o acesso web está fechado atrás de
 * login e o scraping viola os termos de serviço. Uma ferramenta que prometa
 * isso ou não devolve nada, ou derruba a conta do utilizador a meio da semana.
 *
 * O que se responde aqui é exatamente o que qualquer visitante vê na página
 * pública do perfil:
 *
 *   perfil → publicações recentes → quem curtiu e quem respondeu (com ranking)
 *   → quem segue a quem → o que mudou desde a última consulta
 *
 * A última parte não vem da API: nenhuma das duas diz *quando* alguém passou a
 * seguir. Comparando a lista atual com a observação anterior (guardada no ARGUS)
 * é que se responde "quem acabou de seguir" — e a resposta diz sempre desde
 * quando, para não parecer que sabemos o que não sabemos.
 */
import { registerTool, type ToolCtx } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch } from '../net/ssrf.ts';
import { snapshotGet, snapshotPut } from '../db.ts';

// ------------------------------------------------------------------ http
interface Res<T> { data: T; ms: number; url: string }

async function jget<T>(url: string, timeoutMs = 9_000): Promise<Res<T>> {
  const t0 = Date.now();
  const r = await safeFetch(url, { timeoutMs, maxBytes: 4_000_000, headers: { accept: 'application/json' } });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
  let parsed: T;
  try { parsed = JSON.parse(r.body) as T; } catch { throw new Error('resposta não é JSON'); }
  return { data: parsed, ms: Date.now() - t0, url };
}

// ------------------------------------------------------------------ tipos
interface Actor {
  did?: string; handle?: string; username?: string; acct?: string;
  displayName?: string; avatar?: string; description?: string;
  followersCount?: number; followsCount?: number; postsCount?: number;
  createdAt?: string; created_at?: string; url?: string;
}
interface FeedItem {
  post?: { uri?: string; author?: Actor; record?: { text?: string; createdAt?: string };
    likeCount?: number; replyCount?: number; repostCount?: number; indexedAt?: string };
}
interface LikesResp { likes?: { actor?: Actor; createdAt?: string }[] }
interface ThreadResp { thread?: { replies?: { post?: { author?: Actor; record?: { text?: string } } }[] } }
interface ActorsResp { subject?: Actor; followers?: Actor[]; follows?: Actor[] }

// ------------------------------------------------------------------ ajuda
/** `@ana`, `bsky.app/profile/ana` e a URL completa são o mesmo alvo. */
function normHandle(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const m = /bsky\.app\/profile\/([^/?#]+)/i.exec(s);
  if (m) s = m[1];
  return s.replace(/^@/, '').replace(/\/+$/, '');
}

function fmtData(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function primeiroNome(nome: string, handle: string): string {
  return (nome || handle || '').trim() || handle;
}

/** Índice de engajamento 1-10, normalizado pelo mais ativo da amostra. */
function indice(total: number, max: number): number {
  if (max <= 0 || total <= 0) return 0;
  return Math.max(1, Math.min(10, Math.round((10 * total) / max)));
}

const NOTA_INDICE = 'Índice = interações desta pessoa nas publicações observadas, normalizado para o mais ativo (10). Cálculo local, não é confiança nem prova.';

/**
 * Compara a lista atual com a observação anterior e guarda a atual.
 * Devolve `null` na primeira consulta — aí não há diferença que se possa afirmar.
 */
function diffSeguidores(
  ctx: ToolCtx, ferramenta: string, alvo: string, atuais: string[],
  log: SourceLog,
): { novos: string[]; desde: string } | null {
  const prev = snapshotGet(ctx.userId, ferramenta, alvo, 'followers');
  const conjunto = new Set(atuais.map((h) => h.toLowerCase()));
  snapshotPut(ctx.userId, ferramenta, alvo, 'followers', atuais);
  if (!prev) {
    log.note(`Primeira observação dos seguidores de ${alvo}: não há lista anterior para comparar. A próxima execução já mostrará quem passou a seguir desde então.`);
    return null;
  }
  const anteriores = new Set(prev.members.map((h) => h.toLowerCase()));
  const novos = atuais.filter((h) => !anteriores.has(h.toLowerCase()));
  log.note(`Diferença face à observação anterior de ${fmtData(prev.at)}: ${conjunto.size} seguidores na lista atual, ${novos.length} novos.`);
  return { novos, desde: fmtData(prev.at) };
}

// ================================================================ BLUESKY
const BSKY = 'https://public.api.bsky.app/xrpc';

async function runBluesky(input: Record<string, string>, ctx: ToolCtx) {
  const log = new SourceLog();
  const out: Finding[] = [];
  const handle = normHandle(input.target ?? '');
  const compare = normHandle(input.compare ?? '');

  if (!handle) {
    log.empty('bsky-perfil', 'Bluesky', `${BSKY}/app.bsky.actor.getProfile`, 0, 'sem alvo indicado');
    out.push(finding('perfil', 'Consulta ao perfil',
      'Sem alvo indicado. Escreve o handle (@ana), o link do perfil ou o DID que queres ler.',
      ['bsky-perfil'], { kind: 'inference', confidence: 'confirmed' }));
    return { findings: out, log };
  }

  // 1. perfil -------------------------------------------------------------
  let profile: Actor | null = null;
  const urlPerfil = `${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`;
  try {
    const r = await jget<Actor>(urlPerfil);
    if (!r.data?.handle) throw new Error('perfil não encontrado');
    profile = r.data;
    log.ok('bsky-perfil', 'Bluesky · perfil público', urlPerfil, r.ms, 1);
  } catch (e) {
    log.error('bsky-perfil', 'Bluesky · perfil público', urlPerfil, String((e as Error).message).slice(0, 60));
    log.note(`Não foi possível ler @${handle} no Bluesky. Verifica se o handle existe — o Bluesky devolve erro para contas removidas e para handles mal escritos.`);
    out.push(finding('perfil', 'Consulta ao perfil',
      `Não foi possível ler @${handle} no Bluesky. Pode não existir, ter sido removido, ou ter sido mal escrito — a fonte devolveu erro e não há nada que confirmar.`,
      ['bsky-perfil'], { kind: 'inference', confidence: 'indicated' }));
    return { findings: out, log };
  }

  const handleReal = profile.handle ?? handle;
  const bskyUrl = `https://bsky.app/profile/${encodeURIComponent(profile.did ?? handleReal)}`;

  out.push(finding('perfil', 'Handle', `@${handleReal}`, ['bsky-perfil'], { confidence: 'confirmed', link: bskyUrl }));
  out.push(finding('perfil', 'Nome exibido', profile.displayName || '(sem nome exibido)', ['bsky-perfil'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Bio', (profile.description || '').trim() || '(vazia)', ['bsky-perfil'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Seguidores', profile.followersCount ?? 0, ['bsky-perfil'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'A seguir', profile.followsCount ?? 0, ['bsky-perfil'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Publicações', profile.postsCount ?? 0, ['bsky-perfil'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Conta criada', fmtData(profile.createdAt), ['bsky-perfil'], { confidence: 'confirmed' }));
  if (profile.avatar) out.push(finding('perfil', 'Foto', profile.avatar, ['bsky-perfil'], { confidence: 'confirmed', link: profile.avatar }));
  out.push(finding('perfil', 'Perfil', bskyUrl, ['bsky-perfil'], { confidence: 'confirmed', link: bskyUrl }));

  // 2. publicações recentes ------------------------------------------------
  const urlFeed = `${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handleReal)}&limit=10`;
  let feed: FeedItem[] = [];
  try {
    const r = await jget<{ feed?: FeedItem[] }>(urlFeed);
    feed = (r.data.feed ?? []).filter((f) => f.post);
    log.ok('bsky-feed', 'Bluesky · publicações recentes', urlFeed, r.ms, feed.length);
  } catch (e) {
    log.error('bsky-feed', 'Bluesky · publicações recentes', urlFeed, String((e as Error).message).slice(0, 60));
  }

  const posts = feed.slice(0, 10).map((f) => {
    const p = f.post!;
    const texto = String(p.record?.text ?? '').replace(/\s+/g, ' ').trim();
    return {
      Data: fmtData(p.record?.createdAt ?? p.indexedAt),
      Texto: texto ? texto.slice(0, 160) : '(sem texto)',
      Curtidas: p.likeCount ?? 0,
      Respostas: p.replyCount ?? 0,
      Reposts: p.repostCount ?? 0,
      Link: `https://bsky.app/profile/${encodeURIComponent(profile!.did ?? handleReal)}/post/${(p.uri ?? '').split('/').pop() ?? ''}`,
    };
  });
  if (posts.length) out.push(finding('publicações', 'Publicações recentes', posts, ['bsky-feed'], { confidence: 'confirmed' }));

  // 3. engajamento: quem curtiu e quem respondeu ----------------------------
  const amostra = feed.slice(0, 5);
  const contas = new Map<string, { key: string; nome: string; handle: string; curtidas: number; respostas: number }>();

  const marcar = (a: Actor | undefined, campo: 'curtidas' | 'respostas') => {
    if (!a) return;
    const key = (a.did || a.handle || '').toLowerCase();
    if (!key) return;
    const cur = contas.get(key) ?? { key, nome: a.displayName ?? '', handle: a.handle ?? '', curtidas: 0, respostas: 0 };
    if (!cur.nome && a.displayName) cur.nome = a.displayName;
    if (!cur.handle && a.handle) cur.handle = a.handle;
    cur[campo] += 1;
    contas.set(key, cur);
  };

  const jobs: Promise<Res<LikesResp | ThreadResp>>[] = [];
  const tipo: ('likes' | 'replies')[] = [];
  for (const f of amostra) {
    const uri = f.post?.uri;
    if (!uri) continue;
    jobs.push(jget<LikesResp>(`${BSKY}/app.bsky.feed.getLikes?uri=${encodeURIComponent(uri)}&limit=50`, 8_000));
    tipo.push('likes');
    jobs.push(jget<ThreadResp>(`${BSKY}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1`, 8_000));
    tipo.push('replies');
  }
  const resultados = await Promise.allSettled(jobs);
  let likesOk = 0; let repliesOk = 0;
  resultados.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      log.error('bsky-engajamento', 'Bluesky · interações', BSKY, String((r.reason as Error)?.message ?? r.reason).slice(0, 60));
      return;
    }
    if (tipo[i] === 'likes') {
      likesOk++;
      const likes = (r.value as Res<LikesResp>).data;
      for (const l of likes.likes ?? []) marcar(l.actor, 'curtidas');
    } else {
      repliesOk++;
      const thread = (r.value as Res<ThreadResp>).data;
      for (const rep of thread.thread?.replies ?? []) marcar(rep.post?.author, 'respostas');
    }
  });
  if (likesOk || repliesOk) {
    log.ok('bsky-engajamento', 'Bluesky · quem interagiu', `${BSKY}/app.bsky.feed.getLikes + getPostThread`, 0,
      contas.size, `${likesOk} publicações com lista de curtidores, ${repliesOk} com respostas`);
  }

  const ordenado = [...contas.values()]
    .map((c) => ({ ...c, total: c.curtidas + c.respostas }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total || a.handle.localeCompare(b.handle))
    .slice(0, 10);
  const max = ordenado[0]?.total ?? 0;

  // Perfil completo do topo: seguidores e foto de cada um.
  const dids = [...contas.keys()].filter((k) => k.startsWith('did:')).slice(0, 10);
  const perfisEnriquecidos = new Map<string, Actor>();
  if (dids.length) {
    const urlBatch = dids.map((d) => `actors=${encodeURIComponent(d)}`).join('&');
    try {
      const r = await jget<{ profiles?: Actor[] }>(`${BSKY}/app.bsky.actor.getProfiles?${urlBatch}`);
      for (const p of r.data.profiles ?? []) if (p.did) perfisEnriquecidos.set(p.did.toLowerCase(), p);
      log.ok('bsky-perfis', 'Bluesky · perfis de quem interagiu', `${BSKY}/app.bsky.actor.getProfiles`, r.ms, perfisEnriquecidos.size);
    } catch (e) {
      log.error('bsky-perfis', 'Bluesky · perfis de quem interagiu', `${BSKY}/app.bsky.actor.getProfiles`, String((e as Error).message).slice(0, 60));
    }
  }

  const detalhe: Record<string, string | number>[] = [];
  if (ordenado.length) {
    log.local(ordenado.length, NOTA_INDICE);
    const linhas = ordenado.map((c) => {
      const perfil = perfisEnriquecidos.get(c.key) ?? null;
      const link = `https://bsky.app/profile/${encodeURIComponent(perfil?.did ?? c.key)}`;
      detalhe.push({
        Nome: primeiroNome(c.nome, c.handle),
        Handle: `@${c.handle}`,
        Seguidores: perfil?.followersCount ?? '—',
        Curtidas: c.curtidas,
        Respostas: c.respostas,
        Perfil: link,
      });
      return {
        Pessoa: primeiroNome(c.nome, c.handle),
        Handle: `@${c.handle}`,
        Total: c.total,
        Índice: indice(c.total, max),
        Perfil: link,
      };
    });
    out.push(finding('engajamento', 'Quem mais interagiu', linhas, ['bsky-engajamento'], {
      kind: 'inference', confidence: 'indicated',
    }));
    out.push(finding('engajamento', 'Como o índice é calculado', NOTA_INDICE, ['local'], { kind: 'inference', confidence: 'indicated' }));
    out.push(finding('perfis', 'Perfis de quem interagiu', detalhe, ['bsky-perfis'], { confidence: 'confirmed' }));
  } else {
    log.note('Não foi possível determinar quem interagiu: as publicações da amostra não devolveram listas de curtidores nem respostas.');
  }

  // 4. rede: seguidores, novos e comparação ---------------------------------
  const urlSeg = `${BSKY}/app.bsky.graph.getFollowers?actor=${encodeURIComponent(handleReal)}&limit=200`;
  let seguidores: Actor[] = [];
  try {
    const r = await jget<ActorsResp>(urlSeg);
    seguidores = r.data.followers ?? [];
    log.ok('bsky-seguidores', 'Bluesky · seguidores', urlSeg, r.ms, seguidores.length);
  } catch (e) {
    log.error('bsky-seguidores', 'Bluesky · seguidores', urlSeg, String((e as Error).message).slice(0, 60));
  }

  const alvo = handleReal.toLowerCase();
  if (seguidores.length) {
    const handles = seguidores.map((s) => s.handle ?? s.did ?? '').filter(Boolean);
    const diff = diffSeguidores(ctx, 'bluesky', alvo, handles, log);
    out.push(finding('rede', 'Seguidores observados (amostra)', `${handles.length} de ${profile.followersCount ?? handles.length}`, ['bsky-seguidores'], { confidence: 'confirmed' }));
    if (diff) {
      out.push(finding('rede', `Novos seguidores desde ${diff.desde}`,
        diff.novos.length ? diff.novos.slice(0, 50).map((h) => `@${h}`) : 'nenhum — a lista não mudou',
        ['bsky-seguidores'], { confidence: 'confirmed' }));
    }
  }

  if (compare) {
    const urlOutro = `${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(compare)}`;
    try {
      const outro = await jget<Actor>(urlOutro);
      log.ok('bsky-compara', 'Bluesky · perfil de comparação', urlOutro, outro.ms, 1);
      const [seguemR, seguemR2, outroSegR] = await Promise.allSettled([
        jget<ActorsResp>(`${BSKY}/app.bsky.graph.getFollows?actor=${encodeURIComponent(handleReal)}&limit=200`, 8_000),
        jget<ActorsResp>(`${BSKY}/app.bsky.graph.getFollowers?actor=${encodeURIComponent(handleReal)}&limit=200`, 8_000),
        jget<ActorsResp>(`${BSKY}/app.bsky.graph.getFollowers?actor=${encodeURIComponent(outro.data.handle ?? compare)}&limit=200`, 8_000),
      ]);
      const meuSegue = seguemR.status === 'fulfilled' ? (seguemR.value.data.follows ?? []) : [];
      const meusSeg = seguemR2.status === 'fulfilled' ? (seguemR2.value.data.followers ?? []) : [];
      const seguemOutro = outroSegR.status === 'fulfilled' ? (outroSegR.value.data.followers ?? []) : [];

      const a = handleReal.toLowerCase();
      const b = (outro.data.handle ?? compare).toLowerCase();
      const euSegueEle = meuSegue.some((x) => (x.handle ?? '').toLowerCase() === b);
      const eleSegueMe = seguemOutro.some((x) => (x.handle ?? '').toLowerCase() === a);
      const emComum = meusSeg
        .map((x) => (x.handle ?? '').toLowerCase())
        .filter((h) => seguemOutro.some((o) => (o.handle ?? '').toLowerCase() === h));

      out.push(finding('rede', 'Relação entre as contas',
        `${a} segue ${b}: ${euSegueEle ? 'sim' : 'não'} · ${b} segue ${a}: ${eleSegueMe ? 'sim' : 'não'}`,
        ['bsky-compara', 'bsky-seguidores'], { confidence: 'confirmed' }));
      out.push(finding('rede', 'Seguidores em comum',
        emComum.length ? emComum.slice(0, 60).map((h) => `@${h}`) : 'nenhum nas amostras consultadas',
        ['bsky-seguidores'], { confidence: 'indicated' }));
      out.push(finding('rede', 'Amostra consultada',
        `${meusSeg.length} seguidores de ${a} · ${seguemOutro.length} de ${b} (limite de 200 por lista)`,
        ['bsky-seguidores'], { kind: 'inference', confidence: 'indicated' }));
    } catch (e) {
      log.error('bsky-compara', 'Bluesky · perfil de comparação', urlOutro, String((e as Error).message).slice(0, 60));
      log.note(`A conta de comparação @${compare} não pôde ser lida.`);
    }
  }

  return { findings: out, log };
}

// ================================================================ MASTODON
function normAcct(raw: string): { user: string; host: string } {
  let s = String(raw ?? '').trim();
  if (!s) return { user: '', host: '' };
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const url = /^([a-z0-9.-]+\.[a-z]{2,})\/@([A-Za-z0-9_.-]+)/i.exec(s);
  if (url) return { user: url[2], host: url[1].toLowerCase() };
  s = s.replace(/^@/, '');
  const at = s.lastIndexOf('@');
  if (at > 0) return { user: s.slice(0, at), host: s.slice(at + 1).toLowerCase() };
  return { user: s, host: 'mastodon.social' };
}

interface MastStatus {
  id?: string; created_at?: string; content?: string; url?: string;
  favourites_count?: number; reblogs_count?: number; replies_count?: number;
}
const stripHtml = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function runMastodon(input: Record<string, string>, ctx: ToolCtx) {
  const log = new SourceLog();
  const out: Finding[] = [];
  const alvo = normAcct(input.target ?? '');
  const comp = normAcct(input.compare ?? '');

  if (!alvo.user || !alvo.host) {
    log.empty('mast-lookup', 'Mastodon', 'https://mastodon.social/api/v1/accounts/lookup', 0, 'sem alvo indicado');
    out.push(finding('perfil', 'Consulta ao perfil',
      'Sem alvo indicado. Escreve a conta como utilizador@instancia (ex.: gargron@mastodon.social) ou o link do perfil.',
      ['mast-lookup'], { kind: 'inference', confidence: 'confirmed' }));
    return { findings: out, log };
  }

  const urlLookup = `https://${alvo.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(alvo.user)}`;
  let conta: (Actor & { id?: string; url?: string; bot?: boolean; locked?: boolean }) | null = null;
  try {
    const r = await jget<{ id?: string } & Actor>(urlLookup);
    if (!r.data?.id) throw new Error('conta não encontrada');
    conta = r.data;
    log.ok('mast-lookup', `Mastodon · perfil em ${alvo.host}`, urlLookup, r.ms, 1);
  } catch (e) {
    log.error('mast-lookup', `Mastodon · perfil em ${alvo.host}`, urlLookup, String((e as Error).message).slice(0, 60));
    log.note(`Não foi possível ler @${alvo.user} em ${alvo.host}. Confirma a instância: no Mastodon o utilizador pode estar em qualquer servidor.`);
    out.push(finding('perfil', 'Consulta ao perfil',
      `Não foi possível ler @${alvo.user} em ${alvo.host}. A conta pode não existir, a instância pode estar errada, ou o servidor pode estar inacessível — a fonte devolveu erro e não há nada que confirmar.`,
      ['mast-lookup'], { kind: 'inference', confidence: 'indicated' }));
    return { findings: out, log };
  }

  const acct = conta.acct ?? alvo.user;
  const perfilUrl = conta.url ?? `https://${alvo.host}/@${alvo.user}`;

  out.push(finding('perfil', 'Conta', `@${acct}`, ['mast-lookup'], { confidence: 'confirmed', link: perfilUrl }));
  out.push(finding('perfil', 'Nome exibido', conta.displayName || '(sem nome exibido)', ['mast-lookup'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Bio', stripHtml(String(conta.description ?? '')) || '(vazia)', ['mast-lookup'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Seguidores', conta.followersCount ?? 0, ['mast-lookup'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'A seguir', conta.followsCount ?? 0, ['mast-lookup'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Publicações', conta.postsCount ?? 0, ['mast-lookup'], { confidence: 'confirmed' }));
  out.push(finding('perfil', 'Conta criada', fmtData(conta.createdAt ?? conta.created_at), ['mast-lookup'], { confidence: 'confirmed' }));
  if (conta.avatar) out.push(finding('perfil', 'Foto', conta.avatar, ['mast-lookup'], { confidence: 'confirmed', link: conta.avatar }));
  out.push(finding('perfil', 'Perfil', perfilUrl, ['mast-lookup'], { confidence: 'confirmed', link: perfilUrl }));

  // publicações recentes
  const urlStatus = `https://${alvo.host}/api/v1/accounts/${conta.id}/statuses?limit=10`;
  let statuses: MastStatus[] = [];
  try {
    const r = await jget<MastStatus[]>(urlStatus);
    statuses = Array.isArray(r.data) ? r.data : [];
    log.ok('mast-status', 'Mastodon · publicações recentes', urlStatus, r.ms, statuses.length);
  } catch (e) {
    log.error('mast-status', 'Mastodon · publicações recentes', urlStatus, String((e as Error).message).slice(0, 60));
  }

  const linhasPosts = statuses.slice(0, 10).map((s) => {
    const texto = stripHtml(String(s.content ?? ''));
    return {
      Data: fmtData(s.created_at),
      Texto: texto ? texto.slice(0, 160) : '(sem texto)',
      Curtidas: s.favourites_count ?? 0,
      Reposts: s.reblogs_count ?? 0,
      Respostas: s.replies_count ?? 0,
      Link: s.url ?? perfilUrl,
    };
  });
  if (linhasPosts.length) out.push(finding('publicações', 'Publicações recentes', linhasPosts, ['mast-status'], { confidence: 'confirmed' }));

  // engajamento
  const contas2 = new Map<string, { nome: string; acct: string; curtidas: number; respostas: number }>();
  const marcar2 = (a: Actor | undefined, campo: 'curtidas' | 'respostas') => {
    if (!a) return;
    const key = (a.acct ?? a.username ?? a.handle ?? '').toLowerCase();
    if (!key) return;
    const cur = contas2.get(key) ?? { nome: a.displayName ?? '', acct: key, curtidas: 0, respostas: 0 };
    if (!cur.nome && a.displayName) cur.nome = a.displayName;
    cur[campo] += 1;
    contas2.set(key, cur);
  };

  const amostra2 = statuses.slice(0, 5);
  const jobs2: Promise<Res<Actor[] | { descendants?: { account?: Actor }[] }>>[] = [];
  const tipo2: ('fav' | 'ctx')[] = [];
  for (const s of amostra2) {
    if (!s.id) continue;
    jobs2.push(jget<Actor[]>(`https://${alvo.host}/api/v1/statuses/${s.id}/favourited_by`, 8_000));
    tipo2.push('fav');
    jobs2.push(jget<{ descendants?: { account?: Actor }[] }>(`https://${alvo.host}/api/v1/statuses/${s.id}/context`, 8_000));
    tipo2.push('ctx');
  }
  const rs2 = await Promise.allSettled(jobs2);
  let favOk = 0; let ctxOk = 0;
  rs2.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      log.error('mast-engajamento', 'Mastodon · interações', `https://${alvo.host}`, String((r.reason as Error)?.message ?? r.reason).slice(0, 60));
      return;
    }
    if (tipo2[i] === 'fav') {
      favOk++;
      const favs = (r.value as Res<Actor[]>).data;
      if (Array.isArray(favs)) for (const a of favs) marcar2(a, 'curtidas');
    } else {
      ctxOk++;
      const ctx = (r.value as Res<{ descendants?: { account?: Actor }[] }>).data;
      for (const d of ctx.descendants ?? []) marcar2(d.account, 'respostas');
    }
  });
  if (favOk || ctxOk) {
    log.ok('mast-engajamento', 'Mastodon · quem interagiu',
      `https://${alvo.host}/api/v1/statuses/{id}/favourited_by + /context`, 0, contas2.size,
      `${favOk} publicações com curtidores, ${ctxOk} com conversa`);
  }

  const ord2 = [...contas2.values()]
    .map((c) => ({ ...c, total: c.curtidas + c.respostas }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total || a.acct.localeCompare(b.acct))
    .slice(0, 10);
  const max2 = ord2[0]?.total ?? 0;

  if (ord2.length) {
    log.local(ord2.length, NOTA_INDICE);
    const linhas = ord2.map((c) => ({
      Pessoa: primeiroNome(c.nome, c.acct),
      Conta: `@${c.acct}`,
      Total: c.total,
      Índice: indice(c.total, max2),
      Perfil: `https://${c.acct.includes('@') ? c.acct.split('@')[1] : alvo.host}/@${c.acct.split('@')[0]}`,
    }));
    out.push(finding('engajamento', 'Quem mais interagiu', linhas, ['mast-engajamento'], { kind: 'inference', confidence: 'indicated' }));
    out.push(finding('engajamento', 'Como o índice é calculado', NOTA_INDICE, ['local'], { kind: 'inference', confidence: 'indicated' }));
  } else {
    log.note('Não foi possível determinar quem interagiu nas publicações observadas.');
  }

  // rede
  const urlFollowers = `https://${alvo.host}/api/v1/accounts/${conta.id}/followers?limit=40`;
  let followers: Actor[] = [];
  try {
    const r = await jget<Actor[]>(urlFollowers);
    followers = Array.isArray(r.data) ? r.data : [];
    log.ok('mast-followers', 'Mastodon · seguidores', urlFollowers, r.ms, followers.length);
  } catch (e) {
    log.error('mast-followers', 'Mastodon · seguidores', urlFollowers, String((e as Error).message).slice(0, 60));
  }

  if (followers.length) {
    const ids = followers.map((f) => f.acct ?? f.username ?? '').filter(Boolean);
    const diff = diffSeguidores(ctx, 'mastodon', `${alvo.user}@${alvo.host}`.toLowerCase(), ids, log);
    out.push(finding('rede', 'Seguidores observados (amostra)', `${followers.length} de ${conta.followersCount ?? followers.length}`, ['mast-followers'], { confidence: 'confirmed' }));
    if (diff) {
      out.push(finding('rede', `Novos seguidores desde ${diff.desde}`,
        diff.novos.length ? diff.novos.slice(0, 50).map((h) => `@${h}`) : 'nenhum — a lista não mudou',
        ['mast-followers'], { confidence: 'confirmed' }));
    }
  }

  if (comp.user && comp.host) {
    const urlComp = `https://${comp.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(comp.user)}`;
    try {
      const r = await jget<{ id?: string } & Actor>(urlComp);
      if (!r.data.id) throw new Error('conta de comparação não encontrada');
      log.ok('mast-compara', `Mastodon · perfil de comparação em ${comp.host}`, urlComp, r.ms, 1);
      const [euSegR, euSeguidoR, eleSegR] = await Promise.allSettled([
        jget<Actor[]>(`https://${alvo.host}/api/v1/accounts/${conta.id}/following?limit=40`, 8_000),
        jget<Actor[]>(`https://${alvo.host}/api/v1/accounts/${conta.id}/followers?limit=40`, 8_000),
        jget<Actor[]>(`https://${comp.host}/api/v1/accounts/${r.data.id}/followers?limit=40`, 8_000),
      ]);
      const euSegue = euSegR.status === 'fulfilled' ? (Array.isArray(euSegR.value.data) ? euSegR.value.data : []) : [];
      const meusSeg = euSeguidoR.status === 'fulfilled' ? (Array.isArray(euSeguidoR.value.data) ? euSeguidoR.value.data : []) : [];
      const seguemEle = eleSegR.status === 'fulfilled' ? (Array.isArray(eleSegR.value.data) ? eleSegR.value.data : []) : [];

      const a = `${alvo.user}@${alvo.host}`.toLowerCase();
      const b = `${comp.user}@${comp.host}`.toLowerCase();
      const euSegueEle = euSegue.some((x) => (x.acct ?? '').toLowerCase() === b || (x.username ?? '').toLowerCase() === comp.user.toLowerCase());
      const eleSegueMe = seguemEle.some((x) => (x.acct ?? '').toLowerCase() === a || (x.username ?? '').toLowerCase() === alvo.user.toLowerCase());
      const comum = meusSeg
        .map((x) => (x.acct ?? '').toLowerCase())
        .filter((h) => seguemEle.some((o) => (o.acct ?? '').toLowerCase() === h));

      out.push(finding('rede', 'Relação entre as contas',
        `${a} segue ${b}: ${euSegueEle ? 'sim' : 'não'} · ${b} segue ${a}: ${eleSegueMe ? 'sim' : 'não'}`,
        ['mast-compara', 'mast-followers'], { confidence: 'confirmed' }));
      out.push(finding('rede', 'Seguidores em comum',
        comum.length ? comum.slice(0, 60).map((h) => `@${h}`) : 'nenhum nas amostras consultadas',
        ['mast-followers'], { confidence: 'indicated' }));
      out.push(finding('rede', 'Amostra consultada',
        `${meusSeg.length} seguidores de ${a} · ${seguemEle.length} de ${b} (limite de 40 por lista)`,
        ['mast-followers'], { kind: 'inference', confidence: 'indicated' }));
    } catch (e) {
      log.error('mast-compara', `Mastodon · perfil de comparação em ${comp.host}`, urlComp, String((e as Error).message).slice(0, 60));
      log.note(`A conta ${comp.user}@${comp.host} não pôde ser lida.`);
    }
  }

  return { findings: out, log };
}

// ------------------------------------------------------------------ tool
registerTool({
  id: 'bluesky-osint',
  name: 'Bluesky OSINT',
  category: 'pessoa',
  summary: 'Perfil, publicações recentes, quem curtiu e respondeu, quem segue quem e novos seguidores desde a última consulta.',
  longDesc: 'Lê a API pública do Bluesky: perfil, 10 publicações recentes, ranking de quem mais interagiu (com seguidores e foto de cada um), rede de seguidores e a diferença face à última observação. Sem chave de API. Apenas dados visíveis a qualquer visitante do perfil.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['bluesky', 'atproto', 'rede social', 'engajamento', 'seguidores'],
  fields: [
    { name: 'target', label: 'Handle ou link do perfil', type: 'text', placeholder: '@ana ou bsky.app/profile/ana', required: true,
      hint: 'Aceita o handle, a URL do perfil ou o DID.' },
    { name: 'compare', label: 'Comparar com outra conta (opcional)', type: 'text', placeholder: '@outra', required: false,
      hint: 'Devolve se as duas contas se seguem mutuamente e os seguidores em comum.' },
  ],
  run: runBluesky,
});

registerTool({
  id: 'mastodon-osint',
  name: 'Mastodon OSINT',
  category: 'pessoa',
  summary: 'Perfil em qualquer instância do Mastodon, publicações recentes, ranking de engajamento, rede e novos seguidores.',
  longDesc: 'Lê a API pública de qualquer servidor Mastodon: perfil, 10 publicações recentes, quem curtiu e quem respondeu, seguidores observados e a diferença face à última consulta. Sem chave de API e sem conta na rede.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['mastodon', 'fediverso', 'rede social', 'engajamento', 'seguidores'],
  fields: [
    { name: 'target', label: 'Conta (utilizador@instância)', type: 'text', placeholder: 'gargron@mastodon.social', required: true,
      hint: 'Também aceita a URL do perfil. Sem instância, assume mastodon.social.' },
    { name: 'compare', label: 'Comparar com outra conta (opcional)', type: 'text', placeholder: 'outra@instancia.social', required: false,
      hint: 'Devolve se as duas contas se seguem mutuamente e os seguidores em comum.' },
  ],
  run: runMastodon,
});
