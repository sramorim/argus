/**
 * Rotas do Intelligence Engine — o que o motor calcula, servido ao cliente.
 *
 * Três rotas, todas autenticadas e todas sobre a investigação do próprio
 * utilizador (nóes e arestas que ele já tem):
 *
 *   GET /api/intel/perfil      Unified Profile + correlações + resoluções +
 *                              cruzamento entre plataformas + relações +
 *                              timeline e atividade
 *   GET /api/intel/radar       Presence Radar: compara com o snapshot anterior,
 *                              guarda o atual, devolve o que mudou
 *   GET /api/intel/relatorio   JSON · CSV · HTML · PDF (mesmo conteúdo)
 *
 * O que nunca fazem: afirmar identidade. Tudo o que sai daqui traz a faixa de
 * confiança e a nota que diz o que a resposta não prova.
 */
import { Hono } from 'hono';
import { q } from '../db.ts';
import { requireAuth } from '../security.ts';
import type { Entidade, Evento, TipoEntidade } from './types.ts';
import { correlacionar, biosParecidas } from './correlation.ts';
import { resolver } from './entities.ts';
import { unificar } from './unified.ts';
import { cruzar } from './cross-platform.ts';
import { relacionar } from './relationships.ts';
import { linhaTempo } from './timeline.ts';
import { historico } from './activity-history.ts';
import { capturar, carregar, guardar, presencaDe } from './snapshots.ts';
import { radar as radarFn } from './radar.ts';
import { gerarRelatorio, FORMATOS } from './reports.ts';

const intel = new Hono();

interface NodeRow {
  id: string; type: string; label: string; value: string;
  source_ids: string; confidence: string; hop: number; attrs: string | null;
}
interface EdgeRow { from_id: string; to_id: string; rel: string; confidence: string; source_ids: string }
interface InvRow { id: string; user_id: string; seed: string; seed_type: string; title: string; created_at: string; updated_at: string }

const TIPOS: Record<string, TipoEntidade> = {
  username: 'username', utilizador: 'username', conta: 'conta',
  email: 'email', mail: 'email', telefone: 'telefone', phone: 'telefone',
  dominio: 'dominio', domain: 'dominio', ip: 'outro', url: 'url', site: 'url',
  post: 'post', pessoa: 'pessoa', person: 'pessoa', nome: 'pessoa',
  organizacao: 'organizacao', empresa: 'organizacao',
};

function parseJson<T>(s: string | null, fallbacko: T): T {
  if (!s) return fallbacko;
  try { return JSON.parse(s) as T; } catch { return fallbacko; }
}

function paraEntidade(n: NodeRow): Entidade {
  const attrs = parseJson<Record<string, unknown>>(n.attrs, {});
  const limpos: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') limpos[k] = String(v);
    else if (k === 'url' && typeof v === 'object' && v && 'href' in (v as object)) limpos[k] = String((v as { href: unknown }).href);
  }
  const tipo: TipoEntidade = TIPOS[n.type.toLowerCase()] ?? 'outro';
  const atributos: Record<string, string> = { ...limpos };
  if (!atributos.username && tipo === 'username') atributos.username = n.value;
  if (!atributos.email && tipo === 'email') atributos.email = n.value;
  if (!atributos.telefone && tipo === 'telefone') atributos.telefone = n.value;
  if (!atributos.url && (tipo === 'url' || tipo === 'dominio')) atributos.url = n.value;
  if (limpos.nome && !atributos.nome) atributos.nome = limpos.nome;

  const fontes = parseJson<string[]>(n.source_ids, []);
  const provider = fontes[0] ?? 'investigacao';
  const plataformas: string[] = [];
  const p = limpos.plataforma ?? limpos.platform;
  if (p) plataformas.push(p);
  else if (['github', 'telegram', 'bluesky', 'mastodon', 'instagram', 'tiktok', 'reddit', 'x'].includes(n.type.toLowerCase())) {
    plataformas.push(n.type.toLowerCase());
  }

  const timestamp = limpos.data ?? limpos.date ?? limpos.timestamp ?? limpos.created_at ?? '';
  return {
    id: n.id, rotulo: n.label || n.value, tipo, provider, plataformas, atributos,
    evidencias: [{
      fonte: fontes.join(', ') || 'nó da investigação',
      url: atributos.url ?? null,
      provider,
      timestamp: timestamp || new Date().toISOString(),
      nota: `${n.type}: ${n.label}${n.value && n.value !== n.label ? ` (${n.value})` : ''} · confiança ${n.confidence}`,
    }],
  };
}

/** Eventos com data real: os nós que trazem data e os marcos da investigação. */
function eventosDe(inv: InvRow, nodes: NodeRow[]): Evento[] {
  const out: Evento[] = [
    { quando: inv.created_at, tipo: 'investigacao', descricao: `Investigação "${inv.title}" criada`, entidade: inv.seed },
  ];
  for (const n of nodes) {
    const attrs = parseJson<Record<string, unknown>>(n.attrs, {});
    const data = [attrs.data, attrs.date, attrs.timestamp, attrs.created_at, attrs.takenAt]
      .map((v) => (typeof v === 'string' ? v : ''))
      .find((v) => v && Number.isFinite(Date.parse(v)));
    if (!data) continue;
    out.push({
      quando: data, tipo: n.type, descricao: `${n.label}${n.value && n.value !== n.label ? ` (${n.value})` : ''}`,
      plataforma: typeof attrs.plataforma === 'string' ? attrs.plataforma : undefined,
      url: typeof attrs.url === 'string' ? attrs.url : undefined,
      entidade: n.id,
    });
  }
  if (inv.updated_at && inv.updated_at !== inv.created_at) {
    out.push({ quando: inv.updated_at, tipo: 'investigacao', descricao: 'Última atualização da investigação', entidade: inv.seed });
  }
  return out;
}

/**
 * Devolve a investigação só se for do próprio utilizador.
 *
 * Devolve `null` e não uma Response: o `@hono/node-server` troca o `Response`
 * global por uma classe própria neste processo, e o `instanceof Response` deixa
 * de ser fiável (verificado a 2026-10-01, Node 26.4). O 404 é montado no
 * handler, com `c.json`, como todo o resto da API.
 *
 * 404 e não 403: um 403 confirmaria que o id existe — o mesmo truque de
 * enumeração que já é rejeitado no resto da API (ver test/api.test.ts).
 */
function carregarInvestigacao(invId: string, userId: string): InvRow | null {
  const inv = q('SELECT id, user_id, seed, seed_type, title, created_at, updated_at FROM investigations WHERE id = ?')
    .get(invId) as InvRow | undefined;
  if (!inv || inv.user_id !== userId) return null;
  return inv;
}

/**
 * Tudo o que o motor calcula a partir dos nós da investigação.
 *
 * Exportado porque é o mesmo cálculo que as etapas do plano de investigação
 * (FASE F) executam — duplicar a leitura dos nós seria uma segunda verdade.
 */
export function calcular(inv: InvRow) {
  const nodes = q('SELECT id, type, label, value, source_ids, confidence, hop, attrs FROM nodes WHERE inv_id = ?')
    .all(inv.id) as unknown as NodeRow[];
  const edges = q('SELECT from_id, to_id, rel, confidence, source_ids FROM edges WHERE inv_id = ?')
    .all(inv.id) as unknown as EdgeRow[];
  const entidades = nodes.map((n) => paraEntidade(n));
  const correlacoes = [...correlacionar(entidades), ...biosParecidas(entidades)]
    .sort((a, b) => b.total - a.total);
  const resolucoes = resolver(entidades);
  const perfil = unificar(entidades, correlacoes, resolucoes);
  const cruzamento = cruzar(entidades);
  const relacoes = relacionar(entidades, correlacoes);
  const eventos = eventosDe(inv, nodes);
  const tempo = linhaTempo(eventos);
  const atividade = historico(eventos);
  return { nodes, edges, entidades, correlacoes, resolucoes, perfil, cruzamento, relacoes, eventos, tempo, atividade };
}

intel.get('/perfil', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const invId = (c.req.query('investigacao') ?? '').trim();
  if (!invId) return c.json({ error: 'investigacao_em_falta', msg: 'Indique ?investigacao=<id>.' }, 400);
  const inv = carregarInvestigacao(invId, u.userId);
  if (!inv) return c.json({ error: 'nao_encontrada', msg: 'Investigação não existe.' }, 404);
  const r = calcular(inv);
  if (!r.entidades.length) {
    return c.json({
      error: 'sem_entidades',
      msg: 'Esta investigação ainda não tem nós: nada para unificar. Corra primeiro as ferramentas sobre o alvo.',
    }, 404);
  }
  return c.json({
    investigacao: { id: inv.id, titulo: inv.title, alvo: inv.seed, tipo: inv.seed_type, atualizado: inv.updated_at },
    perfil: r.perfil,
    cruzamento: r.cruzamento,
    correlacoes: r.correlacoes,
    resolucoes: r.resolucoes,
    relacoes: r.relacoes,
    timeline: r.tempo,
    atividade: r.atividade,
    resumo: {
      entidades: r.entidades.length, nos: r.nodes.length, arestas: r.edges.length,
      correlacoes: r.correlacoes.length, resolucoes: r.resolucoes.length,
      relacoes: r.relacoes.length, eventos: r.eventos.length,
    },
  });
});

intel.get('/radar', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const invId = (c.req.query('investigacao') ?? '').trim();
  if (!invId) return c.json({ error: 'investigacao_em_falta', msg: 'Indique ?investigacao=<id>.' }, 400);
  const inv = carregarInvestigacao(invId, u.userId);
  if (!inv) return c.json({ error: 'nao_encontrada', msg: 'Investigação não existe.' }, 404);
  const r = calcular(inv);
  if (!r.entidades.length) {
    return c.json({ error: 'sem_entidades', msg: 'Sem nós não há presença para observar.' }, 404);
  }
  // lê o anterior ANTES de guardar o novo — trocar a ordem apagaria a comparação
  const anterior = carregar(u.userId, inv.seed);
  const perfil = r.perfil;
  const atual = capturar(inv.seed, presencaDe(perfil));
  const resultado = radarFn(anterior, atual);
  guardar(u.userId, inv.seed, atual);
  return c.json({
    investigacao: { id: inv.id, titulo: inv.title, alvo: inv.seed },
    radar: resultado,
    anterior: anterior ? { capturadoEm: anterior.capturadoEm } : null,
    atual: { capturadoEm: atual.capturadoEm },
    nota: resultado.temAnterior
      ? 'Comparação entre dois snapshots guardados pelo ARGOS.'
      : 'Primeira observação: guarde este estado e volte a pedir o radar depois de repetir as ferramentas.',
  });
});

intel.get('/relatorio', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const invId = (c.req.query('investigacao') ?? '').trim();
  const formato = (c.req.query('formato') ?? 'json').toLowerCase();
  if (!FORMATOS.includes(formato as never)) {
    return c.json({ error: 'formato_invalido', msg: `Formatos aceites: ${FORMATOS.join(', ')}.` }, 400);
  }
  if (!invId) return c.json({ error: 'investigacao_em_falta', msg: 'Indique ?investigacao=<id>.' }, 400);
  const inv = carregarInvestigacao(invId, u.userId);
  if (!inv) return c.json({ error: 'nao_encontrada', msg: 'Investigação não existe.' }, 404);
  const r = calcular(inv);
  if (!r.entidades.length) return c.json({ error: 'sem_entidades', msg: 'Sem nós não há relatório.' }, 404);

  const rel = gerarRelatorio({
    alvo: inv.seed, perfil: r.perfil, formato: formato as never,
    geradoPor: `argos · ${inv.title}`,
  });
  const corpo = rel.conteudo;
  return c.body(corpo as never, 200, {
    'Content-Type': rel.mime,
    'Content-Disposition': `attachment; filename="${rel.nome}"`,
    'Cache-Control': 'no-store',
  });
});

intel.get('/', (c) => c.json({
  rotas: ['GET /api/intel/perfil', 'GET /api/intel/radar', 'GET /api/intel/relatorio'],
  formatos: FORMATOS,
  nota: 'Todas exigem sessão e só devolvem dados da investigação do próprio utilizador.',
}));

export default intel;
