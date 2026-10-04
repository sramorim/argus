/**
 * DATALIKERS — Social Intelligence sobre a Cache API oficial.
 *
 * Uma ferramenta, 30 recursos: cada recurso é um endpoint documentado no
 * OpenAPI do gateway, e o utilizador escolhe plataforma + recurso + alvo.
 *
 * Três verdades que a ferramenta diz sempre:
 *
 *   1. **Sem `DATALIKERS_API_KEY` não há nada.** O estado é `NOT_CONFIGURED`
 *      com o nome exato da variável, um `needs_key` na matriz de fontes e zero
 *      achados fabricados — é o mesmo contrato do Apify, aqui ao lado.
 *   2. **Só o que a API oficial expõe.** As capacidades que existem apenas em
 *      MCP (`search_users`, `get_user_stories`, datasets…) não estão aqui: não
 *      têm REST documentado e inventá-las seria mentir sobre o que o ARGUS faz.
 *   3. **É cache, não é tempo real.** O gateway devolve o que tem guardado,
 *      independentemente da idade, e diz-o em cada execução.
 *
 * O que sai daqui chega ao Perfil Unificado, ao Correlation, ao Reports e ao
 * Presence Radar pelo único caminho que existe: os `attrs.plataforma`/`username`/
 * `url` do achado, que o grafo copia para o nó e o `paraEntidade` lê depois.
 */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding, type FindingValue } from '../net/provenance.ts';
import {
  DOCS, ENDPOINTS, PLATAFORMAS, listaRecursos, existeEmAlgumLado, pedir, recurso,
  token, limpar,
  type EndpointDL, type Plataforma, type RespostaDL,
} from '../net/datalikers.ts';
import * as creditos from '../creditos.ts';

const NOME: Record<Plataforma, string> = { instagram: 'Instagram', tiktok: 'TikTok' };

/** Campos que o próprio produto documenta no MCP de referência (perfil/user). */
const CAMPOS: [string, string][] = [
  ['id', 'ID'], ['pk', 'PK'], ['username', 'Username'], ['unique_id', 'Unique ID'],
  ['full_name', 'Nome completo'], ['nickname', 'Nome'], ['biography', 'Bio'],
  ['description', 'Descrição'], ['follower_count', 'Seguidores'], ['followers', 'Seguidores'],
  ['following_count', 'A seguir'], ['media_count', 'Publicações'], ['post_count', 'Publicações'],
  ['is_private', 'Conta privada'], ['is_verified', 'Verificada'], ['country', 'País'],
  ['external_url', 'Link externo'], ['category', 'Categoria'], ['profile_pic_url', 'Foto de perfil'],
  ['like_count', 'Curtidas'], ['comment_count', 'Comentários'], ['play_count', 'Visualizações'],
  ['share_count', 'Partilhas'], ['create_time', 'Criado em'],
];

const ehPrimitivo = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const comoTexto = (v: string | number | boolean): string | number | boolean =>
  typeof v === 'string' && v.length > 600 ? `${v.slice(0, 597)}...` : v;

function usernameDe(o: Record<string, unknown>): string | null {
  for (const k of ['username', 'unique_id', 'user_name', 'handle']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function urlDe(plataforma: Plataforma, username: string): string {
  const u = encodeURIComponent(username).replace(/^%40/, '');
  return plataforma === 'tiktok'
    ? `https://www.tiktok.com/@${u}`
    : `https://www.instagram.com/${u}/`;
}

function nomeDe(o: Record<string, unknown>): string {
  return usernameDe(o)
    ?? ['full_name', 'nickname', 'name', 'title', 'label']
      .map((k) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null))
      .find(Boolean) as string | null
    ?? (o.id != null ? String(o.id) : null)
    ?? 'sem identificação';
}

function jsonResumido(d: unknown): string {
  let s: string;
  try { s = JSON.stringify(d, null, 1) ?? String(d); } catch { s = String(d); }
  return s.length > 4000 ? `${s.slice(0, 3997)}...` : s;
}

/**
 * Quando o utilizador não diz o recurso, deriva-se do alvo — e diz-se que se
 * derivou. Nada aqui adivinha conteúdo: só a forma do alvo (URL, número, resto).
 * `alvo` só vem preenchido quando a URL traz o handle lá dentro.
 */
function derivar(plataforma: Plataforma, alvo: string):
  { ep: EndpointDL | null; alvo?: string; nota?: string } {
  if (/^https?:\/\//i.test(alvo)) {
    if (plataforma === 'instagram') {
      if (/\/(p|reel|tv)\//.test(alvo)) return { ep: recurso(plataforma, 'publicacao-url'), nota: 'recurso derivado da URL (publicação)' };
      if (/\/stories\/highlights\//.test(alvo)) return { ep: recurso(plataforma, 'destaque-url'), nota: 'recurso derivado da URL (destaque)' };
      if (/\/stories\//.test(alvo)) return { ep: recurso(plataforma, 'story-url'), nota: 'recurso derivado da URL (story)' };
      return { ep: null, nota: 'URL não corresponde a publicação, story ou destaque — escolha o recurso' };
    }
    const m = /tiktok\.com\/@([A-Za-z0-9._-]+)/i.exec(alvo);
    if (m) return { ep: recurso(plataforma, 'perfil'), alvo: m[1], nota: 'recurso e handle derivados da URL' };
    return { ep: null, nota: 'URL não corresponde a um recurso desta plataforma — escolha o recurso' };
  }
  if (/^\d+$/.test(alvo)) {
    const ep = recurso(plataforma, 'perfil-id');
    return { ep, nota: ep ? 'recurso derivado do alvo numérico (perfil por PK)' : undefined };
  }
  const ep = recurso(plataforma, 'perfil');
  return { ep, nota: ep ? 'recurso por omissão: perfil' : undefined };
}

/** O que um objeto devolve, em achados rotulados — sem inventar campos. */
function deObjeto(obj: Record<string, unknown>, src: string, out: Finding[]): number {
  let n = 0;
  for (const [k, rotulo] of CAMPOS) {
    if (!(k in obj)) continue;
    const v = obj[k];
    if (!ehPrimitivo(v)) continue;
    out.push(finding('perfil', rotulo, comoTexto(v), [src], { kind: 'fact', confidence: 'indicated' }));
    n++;
  }
  const chaves = Object.keys(obj).slice(0, 60);
  if (chaves.length) {
    out.push(finding('resultado', 'Chaves devolvidas pela API', chaves, [src], { kind: 'fact', confidence: 'indicated' }));
    n++;
  }
  out.push(finding('resultado', 'Resposta (JSON)', jsonResumido(obj), [src], { kind: 'fact', confidence: 'indicated' }));
  return n + 1;
}

registerTool({
  id: 'datalikers',
  name: 'DataLikers',
  category: 'pessoa',
  summary: 'Perfis, publicações, seguidores, comentários e hashtags de Instagram e TikTok pela Cache API oficial da DataLikers.',
  longDesc: 'Um só acesso à Cache API da DataLikers (Instagram e TikTok) com a chave apenas no backend: escolhe plataforma, recurso e alvo, e o ARGUS faz exatamente um pedido ao endpoint documentado. Há 30 recursos — perfis por username ou PK, publicações por PK/shortcode/URL, stories, destaques, seguidores, comentários, hashtags, localizações, áudios no lado Instagram; perfis, vídeos, comentários, hashtags e playlists no lado TikTok. Sem DATALIKERS_API_KEY o estado é NOT_CONFIGURED e a ferramenta recusa, dizendo o nome da variável em falta. Os dados vêm de cache: o gateway devolve o que tem guardado independentemente da idade, por isso isto é observação, não tempo real. As capacidades que só existem em MCP (pesquisa livre de utilizadores, datasets) não estão aqui, porque não têm REST documentado.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['datalikers', 'instagram', 'tiktok', 'cache', 'perfil', 'seguidores', 'comentarios', 'hashtag'],
  fields: [
    { name: 'alvo', label: 'Alvo', type: 'text', placeholder: 'ex: @perfil · 1234567 · https://www.instagram.com/p/AbC123/', required: true, hint: 'Username, PK numérico, shortcode ou URL — depende do recurso escolhido.' },
    { name: 'plataforma', label: 'Plataforma', type: 'text', placeholder: 'instagram | tiktok', required: false, hint: 'Por omissão: instagram.' },
    { name: 'recurso', label: 'Recurso', type: 'text', placeholder: 'ex: perfil · seguidores · publicacao · publicacoes · hashtag', required: false, hint: 'Vazio deriva do alvo; escolha para outro recurso. Validos em instagram: ver nota da execução.' },
  ],

  async run(input, ctx) {
    const alvoBruto = String(input.alvo ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];
    const src = (ep: EndpointDL) => `dl-${ep.id}`;

    if (!alvoBruto || alvoBruto.length > 300 || /[\s<>"]/.test(alvoBruto)) {
      out.push(finding('validacao', 'Alvo', alvoBruto ? `inválido: "${alvoBruto.slice(0, 80)}"` : 'em falta',
        [], { kind: 'claim', confidence: 'confirmed' }));
      notes.push('O alvo não pode estar vazio, ter espaços, aspas ou mais de 300 caracteres.');
      return { findings: out, log, notes };
    }

    const plat = String(input.plataforma ?? '').trim().toLowerCase();
    if (plat && !(PLATAFORMAS as readonly string[]).includes(plat)) {
      out.push(finding('validacao', 'Plataforma', `desconhecida: "${plat.slice(0, 40)}"`, [], { kind: 'claim', confidence: 'confirmed' }));
      notes.push(`Plataformas aceites: ${PLATAFORMAS.join(', ')}`);
      return { findings: out, log, notes };
    }
    const plataforma = (plat || 'instagram') as Plataforma;

    const pedido = String(input.recurso ?? '').trim().toLowerCase();
    let ep: EndpointDL | null = pedido ? recurso(plataforma, pedido) : null;
    let notaDerivacao: string | undefined;
    if (pedido && !ep) {
      const existe = existeEmAlgumLado(pedido);
      out.push(finding('validacao', 'Recurso',
        existe ? `"${pedido}" não pertence à plataforma ${plataforma}` : `desconhecido: "${pedido.slice(0, 40)}"`,
        [], { kind: 'claim', confidence: 'confirmed' }));
      notes.push(existe
        ? `"${pedido}" é de ${existe.plataforma}. Recursos de ${plataforma}: ${listaRecursos(plataforma)}`
        : `Recursos de ${plataforma}: ${listaRecursos(plataforma)}`);
      return { findings: out, log, notes };
    }
    let alvoBase = alvoBruto;
    if (!ep) {
      const d = derivar(plataforma, alvoBruto);
      ep = d.ep;
      notaDerivacao = d.nota;
      if (d.alvo) alvoBase = d.alvo;
      if (!ep) {
        out.push(finding('validacao', 'Recurso', 'não foi possível derivar do alvo', [], { kind: 'claim', confidence: 'confirmed' }));
        notes.push(notaDerivacao ?? `Recursos de ${plataforma}: ${listaRecursos(plataforma)}`);
        return { findings: out, log, notes };
      }
    }
    if (notaDerivacao) notes.push(notaDerivacao);

    const alvo = ep.param === 'username' || ep.param === 'name'
      ? alvoBase.replace(/^@/, '').replace(/\/+$/, '') : alvoBase;

    // O alvo é o que o utilizador escreveu: o cálculo (validação, derivação do
    // recurso) é local e declara-se como tal.
    log.local(1, 'alvo e recurso introduzidos pelo utilizador — derivação do recurso é cálculo local');
    out.push(finding('alvo', 'Alvo', alvo, ['local'], { kind: 'fact', confidence: 'confirmed' }));
    out.push(finding('alvo', 'Endpoint', `${ep.rotulo} · ${ep.caminho}`, ['local'], { kind: 'fact', confidence: 'confirmed' }));

    /*
     * Modelo híbrido. A ordem importa e é deliberada:
     *   1. há chave do próprio utilizador? usa-se essa e não há limite nosso;
     *   2. senão a chave partilhada do servidor — o fluxo normal, o que a
     *      maioria vê e nunca tem de pensar em chaves;
     *   3. sem crédito partilhado, o pedido NÃO sai. O erro vai para a rota,
     *      que o transforma no ecrã "Limite do plano atingido" com um botão.
     */
    const credit = creditos.chaveEfetiva(ctx.userId, creditos.TOOL_CREDITOS);
    const t = credit.origem === 'nenhuma'
      ? { token: null as string | null, falta: token().falta }
      : { token: credit.env.DATALIKERS_API_KEY ?? null, falta: null };

    if (!t.token) {
      const nota = `${t.falta} em falta — a DataLikers do ARGUS está desligada (a chave só existe no backend e nunca é devolvida pela API)`;
      log.needsKey('dl', 'DataLikers', DOCS, `${t.falta} em falta`);
      log.skipped(src(ep), ep.rotulo, `${ep.caminho}?${ep.param}=${encodeURIComponent(alvo)}`,
        `NOT_CONFIGURED — ${t.falta} em falta`);
      out.push(finding('resultado', ep.rotulo, `NOT_CONFIGURED — ${t.falta} em falta`, [src(ep)],
        { kind: 'fact', confidence: 'confirmed' }));
      notes.push(nota);
      notes.push(`Declare ${t.falta} no ambiente do servidor (backend/secret manager) para ativar os ${ENDPOINTS.length} recursos da DataLikers.`);
      notes.push(`Recursos desta plataforma: ${listaRecursos(plataforma)}`);
      return { findings: out, log, notes };
    }

    /*
     * Só a chave partilhada tem limite nosso. Com chave própria o consumo é da
     * conta de quem a trouxe, e meter-lhe um tecto nosso seria cobrar duas
     * vezes pelo mesmo pedido.
     */
    if (credit.origem === 'servidor') {
      const est = creditos.estado(ctx.userId, creditos.TOOL_CREDITOS, ctx.plan);
      if (est.esgotado) {
        log.skipped(src(ep), ep.rotulo, `${ep.caminho}?${ep.param}=${encodeURIComponent(alvo)}`,
          `créditos partilhados esgotados (${est.usados}/${est.limite} em ${est.periodo})`);
        throw new creditos.CreditosEsgotadosError(est.usados, est.limite);
      }
    }

    const r = await pedir(ep, alvo, credit.env);
    // Contado só depois de o pedido ter saído para o fornecedor.
    if (credit.origem === 'servidor' && r.estado !== 'NOT_CONFIGURED') {
      creditos.consumir(ctx.userId, creditos.TOOL_CREDITOS);
    }

    normalizar(r, ep, plataforma, alvo, log, out, notes, t.token);
    notes.push(`Chave usada: ${credit.origem === 'propria' ? 'a sua conta DataLikers' : 'conta partilhada do ARGOS'}.`);
    notes.push(`Créditos partilhados usados este mês: ${credit.origem === 'propria' ? '— (a sua chave não conta para o limite partilhado)' : `${creditos.estado(ctx.userId, creditos.TOOL_CREDITOS, ctx.plan).usados}/${creditos.estado(ctx.userId, creditos.TOOL_CREDITOS, ctx.plan).limite}`}.`);
    notes.push(`Recursos desta plataforma: ${listaRecursos(plataforma)}`);
    return { findings: out, log, notes };
  },
});

/** Traduz a resposta em achados honestos — e nunca deixa a chave passar. */
function normalizar(
  r: RespostaDL, ep: EndpointDL, plataforma: Plataforma, alvo: string,
  log: SourceLog, out: Finding[], notes: string[], tk: string | null,
): void {
  const id = `dl-${ep.id}`;

  if (r.estado === 'NOT_CONFIGURED') {
    const causa = r.status ? limpar(`chave rejeitada pela DataLikers (${r.status})`, tk)
      : `${ep.caminho} sem chave`;
    log.needsKey('dl', 'DataLikers', DOCS, causa);
    log.skipped(id, ep.rotulo, r.url, `NOT_CONFIGURED — ${causa}`);
    out.push(finding('resultado', ep.rotulo, `NOT_CONFIGURED — ${causa}`, [id],
      { kind: 'fact', confidence: 'confirmed' }));
    notes.push(`NOT_CONFIGURED: ${causa}. Verifique DATALIKERS_API_KEY no backend.`);
    return;
  }

  if (r.estado === 'NAO_ENCONTRADO') {
    log.empty(id, ep.rotulo, r.url, r.ms, r.nota);
    out.push(finding('resultado', ep.rotulo, 'NAO_ENCONTRADO — não está no cache da DataLikers', [id],
      { kind: 'fact', confidence: 'confirmed' }));
    notes.push(r.nota);
    notes.push('A Cache API só devolve o que já foi recolhido: não há fallback ao vivo para este caminho.');
    return;
  }

  if (r.estado === 'VALIDACAO' || r.estado === 'ERROR' || r.estado === 'RATE_LIMITED') {
    const estado = r.estado;
    log.error(id, ep.rotulo, r.url, limpar(r.nota, tk), r.ms);
    out.push(finding('resultado', ep.rotulo, `${estado} — ${limpar(r.nota, tk)}`, [id],
      { kind: 'fact', confidence: 'confirmed' }));
    notes.push(`${estado}: ${limpar(r.nota, tk)}`);
    return;
  }

  if (r.estado === 'VAZIO') {
    log.empty(id, ep.rotulo, r.url, r.ms, r.nota);
    out.push(finding('resultado', ep.rotulo, 'VAZIO — nada em cache para este alvo', [id],
      { kind: 'fact', confidence: 'confirmed' }));
    notes.push(r.nota);
    return;
  }

  const dados = r.dados;
  const count = Array.isArray(dados) ? dados.length : 1;
  log.ok(id, ep.rotulo, r.url, r.ms, count, r.nota);
  out.push(finding('resultado', ep.rotulo, `READY — ${count} item(ns) · ${r.ms}ms`, [id],
    { kind: 'fact', confidence: 'indicated' }));

  const urlPresenca = presenca(plataforma, ep, alvo, dados);
  if (urlPresenca) {
    const username = usernamePresenca(ep, alvo, dados) ?? alvo;
    const rotulo = NOME[plataforma];
    // É ESTE achado que alimenta o Perfil Unificado: `attrs.plataforma` vira
    // `Entidade.plataformas`, que vira `ContaUnificada`, que vira a linha do
    // Presence Radar. Sem attrs aqui, o resto da cadeia não tem o que ler.
    out.push(finding('plataforma', rotulo, urlPresenca, [id], {
      kind: 'fact', confidence: 'indicated', link: urlPresenca,
      attrs: { plataforma: rotulo, username, url: urlPresenca },
    }));
    out.push(finding('perfil', `${rotulo} · perfil`, urlPresenca, [id],
      { kind: 'fact', confidence: 'indicated', link: urlPresenca }));
  }

  if (Array.isArray(dados)) {
    out.push(finding('resultado', 'Itens devolvidos', dados.length, [id],
      { kind: 'fact', confidence: 'indicated' }));
    if (!dados.length) {
      notes.push('A API devolveu uma lista vazia.');
      return;
    }
    const primeiro = dados.find((d) => d && typeof d === 'object');
    if (primeiro && typeof primeiro === 'object' && !Array.isArray(primeiro)) {
      deObjeto(primeiro as Record<string, unknown>, id, out);
    }
    let feitos = 0;
    for (const item of dados) {
      if (feitos >= 40) break;
      let valor: FindingValue = null;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        valor = nomeDe(o);
        const u = usernameDe(o);
        out.push(finding('resultados', `${NOME[plataforma]} · ${feitos + 1}`, valor, [id],
          { kind: 'fact', confidence: 'indicated', ...(u ? { attrs: { plataforma: NOME[plataforma], username: u, url: urlDe(plataforma, u) } } : {}) }));
      } else if (typeof item === 'string' || typeof item === 'number') {
        valor = item;
        out.push(finding('resultados', `${NOME[plataforma]} · ${feitos + 1}`, valor, [id],
          { kind: 'fact', confidence: 'indicated' }));
      } else continue;
      feitos++;
    }
    notes.push(`${feitos} de ${dados.length} itens listados (teto de 40 por execução).`);
    return;
  }

  if (dados && typeof dados === 'object') {
    deObjeto(dados as Record<string, unknown>, id, out);
    return;
  }

  out.push(finding('resultado', ep.rotulo, String(dados), [id],
    { kind: 'fact', confidence: 'indicated' }));
}

/** URL de presença que a resposta sustenta — null quando não há perfil a citar. */
function presenca(plataforma: Plataforma, ep: EndpointDL, alvo: string, dados: unknown): string | null {
  // Consulta por handle: o próprio pedido prova que o perfil existe no cache,
  // e a conta é a que foi pedida — nunca a do primeiro item de uma lista
  // (num pedido de seguidores o primeiro item é um SEGUIDOR, não o alvo).
  if (ep.param === 'username') {
    const obj = dados && typeof dados === 'object' && !Array.isArray(dados)
      ? dados as Record<string, unknown> : null;
    const u = obj ? usernameDe(obj) : null;
    return urlDe(plataforma, u ?? alvo);
  }
  if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
    const u = usernameDe(dados as Record<string, unknown>);
    return u ? urlDe(plataforma, u) : null;
  }
  return null;
}

/** O handle a registar como conta — o da resposta, ou o pedido quando é handle. */
function usernamePresenca(ep: EndpointDL, alvo: string, dados: unknown): string | null {
  const obj = dados && typeof dados === 'object' && !Array.isArray(dados)
    ? dados as Record<string, unknown> : null;
  const u = obj ? usernameDe(obj) : null;
  if (u) return u;
  return ep.param === 'username' ? alvo : null;
}
