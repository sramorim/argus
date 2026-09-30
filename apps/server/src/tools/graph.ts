/**
 * Grafo investigativo: deteta o tipo do alvo, orquestra as ferramentas relevantes
 * e produz um grafo com proveniência, confiança e saltos.
 *
 * O grafo é a assinatura do ARGUS, por isso tem de ser *verdadeiro*:
 *  - cada nó e cada aresta cita a fonte que o sustenta;
 *  - "salto" só existe se o pivot foi mesmo executado (hop 2 abre de facto
 *    novos alvos, com teto, e só nos planos que o compram);
 *  - a investigação fica guardada com o run que a produziu, para se poder
 *    abrir e reler mais tarde.
 */
import { registerTool, allTools, lockState, type ToolDef } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { PLANS } from '../plans.ts';
import { db } from '../db.ts';
import { doh } from '../net/sources.ts';
import { apiGet } from '../net/ssrf.ts';

export type NodeType = 'pessoa' | 'username' | 'email' | 'telefone' | 'dominio' | 'ip' | 'conta' | 'empresa' | 'socio' | 'endereco' | 'wallet' | 'portfolio' | 'cve' | 'pacote' | 'breach' | 'documento' | 'hashtag' | 'servico';

export interface GraphNode {
  id: string; type: NodeType; label: string; value: string;
  confidence: 'confirmed' | 'corroborated' | 'indicated' | 'weak';
  sourceIds: string[]; hop: number; attrs?: Record<string, unknown>;
}
export interface GraphEdge {
  from: string; to: string; rel: string;
  confidence: 'confirmed' | 'corroborated' | 'indicated' | 'weak';
  sourceIds: string[];
}
export interface Graph {
  nodes: GraphNode[]; edges: GraphEdge[];
  runs: { toolId: string; ok: boolean; ms: number; findingCount: number; note?: string }[];
  seedType: NodeType;
}

let seq = 0;
/** IDs de nó únicos ao processo. Ao gravar, prefixa-se com o id da investigação
 *  para evitar colisão de chave primária quando o processo reinicia. */
const nid = () => `n${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function detectSeedType(raw: string): NodeType | null {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return 'servico';
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{25,62}$/i.test(v)) return 'wallet';
  if (/^CVE-\d{4}-\d{4,7}$/i.test(v)) return 'cve';
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(v)) return 'email';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) || /^[0-9a-f:]{2,}$/i.test(v) && v.includes(':')) return 'ip';
  // CEP e CNPJ são testados ANTES do telefone: "01310-100" também casa como
  // sequência de dígitos e era classificado como telefone.
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(v)) return 'empresa';
  if (/^\d{5}-?\d{3}$/.test(v)) return 'endereco';
  if (/^\+?\d{1,3}[\s-]?\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}$/.test(v)) return 'telefone';
  if (/^\+?[\d\s()-]{8,}$/.test(v)) return 'telefone';
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v)) return 'dominio';
  if (/^[a-z0-9_.-]{2,40}$/i.test(v) && !/\s/.test(v)) return 'username';
  return null;
}

interface PlanStep { toolId: string; input: Record<string, string>; }

function planFor(type: NodeType, seed: string): PlanStep[] {
  const s = seed.trim();
  switch (type) {
    case 'username': return [
      { toolId: 'username-finder', input: { username: s } },
      { toolId: 'github-osint', input: { username: s } },
    ];
    case 'email': return [
      { toolId: 'email-analyzer', input: { email: s } },
      { toolId: 'dorks-generator', input: { term: s, engine: 'sim' } },
    ];
    case 'dominio': return [
      { toolId: 'domain-analyzer', input: { domain: s } },
      { toolId: 'tls-audit', input: { host: s } },
      { toolId: 'reputation-check', input: { target: s } },
      { toolId: 'url-scanner', input: { url: `https://${s}` } },
    ];
    case 'ip': return [
      { toolId: 'ip-analyzer', input: { ip: s } },
      { toolId: 'reputation-check', input: { target: s } },
      { toolId: 'port-scanner', input: { target: s } },
    ];
    case 'servico': return [
      { toolId: 'url-scanner', input: { url: s } },
      { toolId: 'web-crawler', input: { url: s } },
      { toolId: 'reputation-check', input: { target: s } },
    ];
    case 'telefone': return [{ toolId: 'phone-analyzer', input: { phone: s } }];
    case 'wallet': return [{ toolId: 'crypto-tracer', input: { address: s } }];
    case 'cve': return [{ toolId: 'cve-lookup', input: { query: s } }];
    case 'empresa': return [{ toolId: 'company-br', input: { cnpj: s } }];
    case 'endereco': return [{ toolId: 'zipcode-br', input: { cep: s } }];
    case 'pessoa': return [{ toolId: 'dorks-generator', input: { term: s, engine: 'sim' } }];
    default: return [];
  }
}

/** Grupos que são resumo/meta e não entidades — não viram nós. */
const META_GROUPS = new Set([
  'resumo', 'passo', 'grafo', 'grafo-completo', 'validacao', 'forca',
  'auditoria', 'conclusao', 'veredicto', 'nota', 'risco', 'dorks',
  'transparencia', 'acoes', 'operadora', 'seguranca', 'ficheiro', 'alvo',
]);

/** Extrai um valor legivel de um item de array (string ou objeto). */
function displayItem(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['url', 'plataforma', 'titulo', 'nome', 'endereco', 'value', 'socio', 'porta', 'servico', 'title', 'excerpt', 'excerto']) {
      if (o[k] != null && typeof o[k] === 'string') return o[k] as string;
    }
    const s = JSON.stringify(o);
    return s.length > 2 ? s.slice(0, 80) : null;
  }
  return null;
}

const classifyValue = (s: string): NodeType | null => {
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return 'email';
  if (/^\+?[\d\s()-]{8,}$/.test(s)) return 'telefone';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return 'ip';
  if (/^(https?:\/\/|www\.)/i.test(s)) return 'servico';
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{25,62}$/i.test(s)) return 'wallet';
  if (/^CVE-\d{4}-\d{4,7}$/i.test(s)) return 'cve';
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s)) return 'dominio';
  return null;
};

/** Extrai nós/edges a partir dos findings de um run. */
function harvest(
  run: { toolId: string; findings: Finding[]; sources: { id: string; status: string }[] },
  seedId: string, hop: number, graph: Graph, seen: Set<string>,
): void {
  const goodSources = new Set(run.sources.filter((s) => s.status === 'ok').map((s) => s.id));
  const isUsername = run.toolId === 'username-finder';
  const isCompany = run.toolId === 'company-br';
  const isGitHub = run.toolId === 'github-osint';
  const isDomain = run.toolId === 'domain-analyzer';

  for (const f of run.findings) {
    if (f.evidence.confidence === 'weak') continue;
    if (META_GROUPS.has(f.group)) continue;
    const srcIds = f.evidence.sourceIds.length ? f.evidence.sourceIds : goodSources.size ? [run.toolId] : [];
    if (!srcIds.length) continue;
    const val = f.value;
    const forcedType: NodeType | null = isUsername ? 'conta' : null;
    const forcedRel: string | null = isUsername ? 'tem_conta_em' : isCompany && f.group === 'socios' ? 'socio_de' : null;

    const addNode = (raw: string, type: NodeType, rel: string, label: string, extra?: Record<string, unknown>) => {
      const key = `${type}::${raw}`;
      if (seen.has(key)) return;
      seen.add(key);
      const id = nid();
      graph.nodes.push({
        id, type, label, value: raw.length > 300 ? `${raw.slice(0, 297)}...` : raw,
        confidence: f.evidence.confidence, sourceIds: srcIds, hop,
        attrs: { group: f.group, kind: f.evidence.kind, via: run.toolId, ...extra },
      });
      graph.edges.push({ from: seedId, to: id, rel, confidence: f.evidence.confidence, sourceIds: srcIds });
    };

    if (Array.isArray(val)) {
      let made = 0;
      for (const item of val) {
        if (made >= 60) break;
        const s = displayItem(item);
        if (!s) continue;
        const t = forcedType ?? (isDomain && f.group === 'subdominios' ? 'dominio' : null) ?? classifyValue(s) ?? 'servico';
        const rel = forcedRel ?? (isDomain && f.group === 'subdominios' ? 'tem_subdominio' : 'relacionado_com');
        addNode(s, t, rel, f.label);
        made++;
      }
      continue;
    }
    if (val && typeof val === 'object') {
      const s = displayItem(val);
      if (!s) continue;
      addNode(s, forcedType ?? classifyValue(s) ?? 'servico', forcedRel ?? 'relacionado_com', f.label);
      continue;
    }
    if (val == null) continue;
    const s = String(val);
    const forced = isGitHub && f.group === 'perfil' ? 'pessoa' : null;
    const t = forcedType ?? forced ?? classifyValue(s);
    if (!t) continue;
    // Um nó escalar trivial (ex.: "Saldo (BTC)") só entra se trouxer entidade.
    if (!forced && !forcedType) {
      const informative = ['mx', 'dns', 'onchain', 'perfil', 'cve', 'breach', 'geo', 'resultados',
        'vulnerabilidade', 'empresa', 'endereco', 'repos', 'comparacao', 'exif', 'pdf', 'plataforma', 'prefixos', 'icp', 'handoff'];
      if (!informative.includes(f.group)) continue;
    }
    addNode(s, t, forcedRel ?? 'relacionado_com', f.label);
  }
}

export interface PivotResult { nodes: { type: NodeType; value: string; label: string; detail: string }[]; notes: string[] }

/**
 * Salto 2 — abre de facto o que foi descoberto no salto 1, com teto.
 *
 * Só pivota para valores que são, por si sós, um alvo legítimo: domínios e IPs.
 * Para cada um, uma consulta barata e verificável (DNS). É isto que distingue
 * um "grafo" de um desenho: o nó novo foi really visto numa fonte.
 */
async function pivot(nodes: GraphNode[], max: number, log: SourceLog): Promise<PivotResult> {
  const out: PivotResult = { nodes: [], notes: [] };
  const alvos = nodes
    .filter((n) => (n.type === 'dominio' || n.type === 'ip') && n.hop === 1)
    .filter((n) => n.value !== n.label)
    .slice(0, max);
  if (!alvos.length) {
    out.notes.push('Salto 2: o salto 1 nao descobriu dominios nem IPs por onde continuar.');
    return out;
  }
  const results = await Promise.all(alvos.map(async (n) => {
    if (n.type === 'dominio') {
      const [a, mx] = await Promise.all([doh(n.value, 'A', log), doh(n.value, 'MX', log)]);
      const ips = (a?.Answer ?? []).filter((x) => x.type === 1).map((x) => x.data);
      const mxs = (mx?.Answer ?? []).filter((x) => x.type === 15).map((x) => x.data);
      return {
        parent: n,
        add: [
          ...ips.slice(0, 3).map((ip) => ({ type: 'ip' as NodeType, value: ip, label: 'Resolved to', detail: `A de ${n.value} (DNS-over-HTTPS)` })),
          ...mxs.slice(0, 2).map((mx) => ({ type: 'dominio' as NodeType, value: mx, label: 'MX', detail: `Servidor de email de ${n.value} (DNS-over-HTTPS)` })),
        ],
      };
    }
    const r = await doh(`${n.value.split('.').reverse().join('.')}.in-addr.arpa`, 'PTR', log);
    const ptr = (r?.Answer ?? []).filter((x) => x.type === 12).map((x) => x.data);
    return {
      parent: n,
      add: ptr.map((p) => ({ type: 'dominio' as NodeType, value: p, label: 'Reverse DNS (PTR)', detail: `PTR de ${n.value} (DNS-over-HTTPS)` })),
    };
  }));
  for (const r of results) {
    for (const a of r.add) {
      if (out.nodes.length >= max) break;
      out.nodes.push(a);
    }
  }
  if (out.nodes.length) out.notes.push(`Salto 2: ${out.nodes.length} nós novos a partir de ${alvos.length} alvos abertos no salto 1.`);
  else out.notes.push('Salto 2: os alvos abertos no salto 1 nao devolveram nada novo em DNS.');
  return out;
}

registerTool({
  id: 'graph-investigation',
  name: 'Investigação (Grafo)',
  category: 'pessoa',
  summary: 'Deteta o alvo, escolhe as ferramentas certas, executa-as e monta um grafo com proveniencia, confianca e saltos.',
  longDesc: 'Comeca por um alvo (dominio, IP, username, email, URL, telefone, carteira, CVE, CNPJ, CEP) e decide quais as ferramentas que fazem sentido. Corre-as em paralelo, junta o que encontraram num grafo onde cada no e cada ligacao dizem de que fonte vem e com que confianca, e - nos planos Pro e Pro Max - abre o que descobriu num segundo salto real (resolucoes DNS e reverse DNS). No fim guarda a investigacao, ligada ao run que a produziu, para se poder reler.',
  minPlan: 'free',
  freeTier: true,
  tags: ['grafo', 'investigacao', 'correlacao', 'pivot'],
  fields: [{ name: 'seed', label: 'Alvo', type: 'text', required: true, placeholder: 'exemplo.com · 8.8.8.8 · username · email · CVE-2021-44228', hint: 'O ARGUS detecta o tipo sozinho.' }],
  async run(input, ctx) {
    const seed = String(input.seed ?? '').trim();
    const type = detectSeedType(seed);
    const log = new SourceLog();
    const out: Finding[] = [];

    if (!type) {
      log.empty('deteccao', 'Deteccao de tipo', seed || '(vazio)', 0, 'nao reconhecido');
      out.push(finding('investigacao', 'Alvo não reconhecido', seed || '(vazio)', [], { kind: 'inference', confidence: 'confirmed' }));
      out.push(finding('investigacao', 'O que o ARGUS reconhece',
        ['domínio (exemplo.com)', 'endereço IP (8.8.8.8)', 'URL (https://exemplo.com/x)', 'email (a@b.com)',
          'username (torvalds)', 'telefone (+5511999999999)', 'carteira Bitcoin (1A1z… ou bc1…)',
          'CVE (CVE-2021-44228)', 'CNPJ (11.222.333/0001-81)', 'CEP (01310-100)'],
        [], { kind: 'fact', confidence: 'confirmed' }));
      return { findings: out, log };
    }

    const plan = PLANS[ctx.plan] ?? PLANS.free;
    const maxHops = plan.graphHops;
    out.push(finding('investigacao', 'Tipo do alvo', type, [], { kind: 'fact', confidence: 'confirmed' }));
    out.push(finding('alvo', 'Alvo', seed, [], { kind: 'fact', confidence: 'confirmed' }));

    const seedId = nid();
    const graph: Graph = { nodes: [], edges: [], runs: [], seedType: type };
    graph.nodes.push({ id: seedId, type, label: 'Alvo', value: seed, confidence: 'confirmed', sourceIds: [], hop: 0 });
    const seen = new Set<string>([`${type}::${seed}`]);

    const steps = planFor(type, seed);
    const registry = new Map(allTools().map((t) => [t.id, t]));

    if (!steps.length) {
      log.note('Não há ferramentas associadas a este tipo de alvo.');
      out.push(finding('conclusao', 'Sem plano', `Não existe um conjunto de ferramentas associado a "${type}". Use uma ferramenta diretamente.`, [], { kind: 'inference', confidence: 'weak' }));
    }

    // As ferramentas do plano são independentes entre si: paralelismo limitado
    // pelo que o plano do utilizador permite em simultâneo.
    const executaveis = steps.filter((s) => {
      const def = registry.get(s.toolId);
      if (!def) return false;
      if (lockState(s.toolId, ctx.plan) === 'locked') {
        log.skipped(s.toolId, def.name, s.toolId, `bloqueada no plano ${ctx.plan} (exige ${def.minPlan})`);
        return false;
      }
      return true;
    });

    const outSemOrdem: { idx: number; res: { toolId: string; findings: Finding[]; log: SourceLog } | null; ms: number; err?: string }[] = [];
    // Escalonamento com N workers (sem `p-limit`: uma dependência a menos).
    const limite = Math.max(1, Math.min(plan.concurrent, executaveis.length));
    const nextIdx = { i: 0 };
    const worker = async () => {
      for (;;) {
        const i = nextIdx.i++;
        if (i >= executaveis.length) return;
        const step = executaveis[i]!;
        const def = registry.get(step.toolId)!;
        const t0 = Date.now();
        try {
          const res = await def.run(step.input, ctx);
          outSemOrdem.push({ idx: i, res: { toolId: step.toolId, findings: res.findings, log: res.log }, ms: Date.now() - t0 });
        } catch (e) {
          outSemOrdem.push({ idx: i, res: null, ms: Date.now() - t0, err: String((e as Error).message).slice(0, 90) });
        }
      }
    };
    await Promise.all(Array.from({ length: limite }, worker));
    outSemOrdem.sort((a, b) => a.idx - b.idx);

    for (const item of outSemOrdem) {
      const step = executaveis[item.idx]!;
      const def = registry.get(step.toolId)!;
      if (!item.res) {
        graph.runs.push({ toolId: step.toolId, ok: false, ms: item.ms, findingCount: 0, note: 'erro' });
        log.error(step.toolId, def.name, step.toolId, item.err ?? 'erro');
        out.push(finding('passo', `${def.name}`, `falhou: ${item.err ?? 'erro'}`, [step.toolId], { kind: 'inference', confidence: 'confirmed' }));
        continue;
      }
      graph.runs.push({ toolId: step.toolId, ok: item.res.findings.length > 0, ms: item.ms, findingCount: item.res.findings.length });
      harvest({ toolId: step.toolId, findings: item.res.findings, sources: item.res.log.sources }, seedId, 1, graph, seen);
      log.ok(step.toolId, def.name, `${step.toolId}(${JSON.stringify(step.input)})`, item.ms, item.res.findings.length);
      out.push(finding('passo', def.name, `${item.res.findings.length} achados em ${item.ms} ms`, [step.toolId], { kind: 'fact', confidence: 'corroborated' }));
    }

    // Salto 2 — só quando o plano o compra e existe por onde seguir.
    if (maxHops >= 2) {
      const pv = await pivot(graph.nodes, Math.min(8, plan.maxItems / 25), log);
      for (const n of pv.notes) log.note(n);
      for (const n of pv.nodes) {
        const key = `${n.type}::${n.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const origem = n.detail.match(/de (.+) \(/)?.[1] ?? '';
        const parent = graph.nodes.find((x) => x.value === origem) ?? seedId;
        const id = nid();
        graph.nodes.push({ id, type: n.type, label: n.label, value: n.value, confidence: 'corroborated', sourceIds: ['doh'], hop: 2, attrs: { group: 'pivot', kind: 'fact', detail: n.detail } });
        graph.edges.push({ from: typeof parent === 'string' ? parent : parent.id, to: id, rel: 'resolve_para', confidence: 'corroborated', sourceIds: ['doh'] });
      }
      if (pv.nodes.length) {
        out.push(finding('passo', 'Salto 2 (pivot DNS)', `${pv.nodes.length} nós novos`, ['doh'], { kind: 'fact', confidence: 'corroborated' }));
      }
    } else {
      log.note('Salto 2 disponível nos planos Pro e Pro Max. Este plano para no salto 1.');
    }

    const trimmed = trimGraph(graph, maxHops);
    out.push(finding('grafo', 'Grafo gerado', {
      nos: trimmed.nodes.length, arestas: trimmed.edges.length, saltos: maxHops, ferramentas: trimmed.runs,
    }, [], { kind: 'fact', confidence: 'corroborated' }));
    out.push(finding('grafo-completo', 'Grafo (JSON)', JSON.stringify(trimmed), [], { kind: 'fact' }));

    // Persistir a investigação, ligada ao run que a produziu.
    let savedAs: string | null = null;
    try {
      const limit = plan.investigations;
      const n = db.prepare('SELECT COUNT(*) c FROM investigations WHERE user_id = ?').get(ctx.userId) as { c: number };
      if ((n?.c ?? 0) < limit) {
        const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        db.prepare('INSERT INTO investigations(id,user_id,seed,seed_type,title,created_at,updated_at,run_id,node_count,edge_count,tools) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(invId, ctx.userId, seed, type, `Investigação: ${seed}`, now, now, null, trimmed.nodes.length, trimmed.edges.length, JSON.stringify(trimmed.runs));
        const insNode = db.prepare('INSERT INTO nodes(id,inv_id,type,label,value,source_ids,confidence,hop,attrs) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const nd of trimmed.nodes) {
          insNode.run(`${invId}:${nd.id}`, invId, nd.type, nd.label, nd.value, JSON.stringify(nd.sourceIds), nd.confidence, nd.hop, nd.attrs ? JSON.stringify(nd.attrs) : null);
        }
        const insEdge = db.prepare('INSERT INTO edges(id,inv_id,from_id,to_id,rel,confidence,source_ids) VALUES(?,?,?,?,?,?,?)');
        for (const [i, ed] of trimmed.edges.entries()) {
          insEdge.run(`e:${invId}:${i}`, invId, `${invId}:${ed.from}`, `${invId}:${ed.to}`, ed.rel, ed.confidence, JSON.stringify(ed.sourceIds));
        }
        savedAs = invId;
        log.ok('db', 'Investigação guardada', invId, 0, trimmed.nodes.length, `${trimmed.nodes.length} nós, ${trimmed.edges.length} arestas`);
      } else {
        log.skipped('db', 'Guardar investigação', 'db', `limite de ${limit} investigações guardadas no plano ${ctx.plan} — apague uma para guardar esta`);
      }
    } catch (e) { log.error('db', 'Guardar investigação', 'db', String((e as Error).message).slice(0, 80)); }

    return {
      findings: out,
      log,
      notes: [
        `Investigação com até ${maxHops} salto(s) (plano ${ctx.plan}). Cada nó tem proveniência e confiança.`,
        ...(savedAs ? [`Grafo gravado como ${savedAs}.`] : ['O grafo não foi gravado (ver matriz de fontes). O resultado acima está completo.']),
      ],
    };
  },
});

function trimGraph(g: Graph, maxHops: number): Graph {
  const keep = new Set(g.nodes.filter((n) => n.hop <= maxHops).map((n) => n.id));
  return {
    ...g,
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}
