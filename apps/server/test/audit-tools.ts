/**
 * Harness de auditoria das ferramentas.
 *
 * Corre cada ferramenta contra alvos REAIS e classifica o resultado com critérios
 * objetivos. Não aceita mocks nem estruturas vazias.
 *
 *   node test/audit-tools.ts
 */
import { registerTool, allTools, executeTool, type ToolDef } from '../src/registry.ts';
import type { Finding, Source, ToolRun } from '../src/net/provenance.ts';
import { db } from '../src/db.ts';

// carregar registos
await import('../src/tools/identity.ts');
await import('../src/tools/username-intel.ts');
await import('../src/tools/paste.ts');
await import('../src/tools/graph.ts');
await import('../src/tools/social-search.ts');
await import('../src/tools/osint-engine.ts');
await import('../src/tools/apify.ts');
await import('../src/tools/datalikers.ts');

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8787';
const CTX = { userId: 'audit-user', plan: 'pro_max' as const, byok: {} as Record<string, string> };
/** A auditoria corre no ambiente real: com chave exige-se resultado, sem chave recusa-se. */
const temChaveDataLikers = !!process.env.DATALIKERS_API_KEY?.trim();

interface Case { tool: string; input: Record<string, string>; label: string; expect?: (r: ToolRun) => boolean }
const CASES: Case[] = [
  // ---------- identidade (username) ----------
  { tool: 'username-finder', input: { username: 'torvalds' }, label: 'username conhecido em várias plataformas',
    expect: (r) => hasGroup(r, 'plataforma') },
  { tool: 'username-finder', input: { username: 'zzargusinexistente' + Date.now() + 'q' }, label: 'username inventado NAO pode dar confirmados',
    expect: (r) => !r.findings.some((f) => f.group === 'plataforma' && f.evidence.confidence === 'confirmed') },
  { tool: 'username-intel', input: { username: 'torvalds', modo: 'QUICK' }, label: 'username conhecido: FOUND em sites reais, 4 providers reportados',
    expect: (r) => hasGroup(r, 'encontrado') && r.findings.filter((f) => f.group === 'provider').length === 4
      && r.findings.some((f) => f.group === 'encontrado' && f.value !== null && typeof f.value === 'object') },
  { tool: 'username-intel', input: { username: 'zzq7xk9plmw' + Date.now().toString(36), modo: 'QUICK' },
    label: 'username inventado NAO pode dar FOUND em nenhum site (baseline do site)',
    expect: (r) => r.findings.length > 0 && !r.findings.some((f) => f.group === 'encontrado')
      && hasGroup(r, 'provider') },
  { tool: 'username-intel', input: { username: 'torvalds', modo: 'CUSTOM', providers: 'blackbird' },
    label: 'provider de CLI sem instalar: estado honesto, sem fabricar resultados',
    expect: (r) => r.findings.some((f) => f.group === 'provider' && f.label === 'Blackbird')
      && r.sources.some((s) => s.id === 'p-blackbird')
      && r.findings.filter((f) => f.group === 'encontrado').every((f) => f.evidence.sourceIds[0] === 'p-blackbird') },

  // ---------- exposição pública ----------
  { tool: 'paste-search', input: { term: 'example.com', exec: 'nao' }, label: 'dorks de paste sem executar',
    expect: (r) => hasGroup(r, 'dorks') },
  { tool: 'paste-search', input: { term: 'pastebin', exec: 'sim' }, label: 'pesquisa real via Bing RSS',
    expect: (r) => r.sources.some((s) => s.id === 'bing' && s.status === 'ok') },

  // ---------- investigação (grafo) ----------
  { tool: 'graph-investigation', input: { seed: 'torvalds' }, label: 'grafo de username',
    expect: (r) => r.findings.some((f) => f.group === 'grafo-completo' && String(f.value).includes('"nodes"')) },
  { tool: 'graph-investigation', input: { seed: '@@@ !!!' }, label: 'alvo nao reconhecido (tem de dizer o que reconhece)',
    expect: (r) => r.findings.some((f) => /reconhece/i.test(f.label)) },

  // ---------- motor OSINT de CLI (estado honesto por provider) ----------
  { tool: 'osint-engine', input: { alvo: 'example.com' }, label: '5 providers de CLI: cada um reporta o SEU estado real, nada fabricado',
    expect: (r) => r.findings.filter((f) => f.group === 'provider').length === 5
      && r.sources.filter((s) => s.id.startsWith('p-osint-')).length === 5
      && r.findings.filter((f) => f.group === 'provider').every((f) => /^(READY|NOT_INSTALLED|NOT_CONFIGURED|INCOMPATIBLE|ERROR)/.test(String(f.value))) },
  { tool: 'osint-engine', input: { alvo: 'example.com', providers: 'holehe' }, label: 'provider que nao aceita este tipo de alvo: INCOMPATIBLE, sem sequer correr',
    expect: (r) => r.findings.some((f) => f.group === 'provider' && String(f.value).startsWith('INCOMPATIBLE'))
      && r.sources.some((s) => s.id === 'p-osint-holehe' && s.status === 'skipped') },
  { tool: 'osint-engine', input: { alvo: 'pessoa@exemplo.com', providers: 'ghunt, holehe, openosint' }, label: 'alvo de email: os 3 que aceitam email reportam estado por provider',
    expect: (r) => r.findings.filter((f) => f.group === 'provider').length === 3
      && hasGroup(r, 'alvo')
      && r.findings.some((f) => f.label === 'Tipo detetado' && f.value === 'email') },

  // ---------- Apify (nunca corre sem token) ----------
  { tool: 'apify', input: { alvo: '@exemplo' }, label: 'sem token: NOT_CONFIGURED por actor + needs_key, APIFY_API_TOKEN no aviso',
    expect: (r) => r.findings.filter((f) => f.group === 'actor').length === 8
      && r.findings.filter((f) => f.group === 'actor').every((f) => String(f.value).startsWith('NOT_CONFIGURED'))
      && r.sources.some((s) => s.status === 'needs_key')
      && JSON.stringify(r.findings).includes('APIFY_API_TOKEN')
      && !JSON.stringify(r).includes('APIFY_TOKEN=') },
  { tool: 'apify', input: { alvo: '@exemplo', plataforma: 'instagram' }, label: 'filtro por plataforma: só os 4 actors de Instagram',
    expect: (r) => r.findings.filter((f) => f.group === 'actor').length === 4 },
  { tool: 'apify', input: { alvo: '@exemplo', actors: 'apify/instagram-scraper', confirmarCusto: 'sim' },
    label: 'confirmado mas sem token: continua NOT_CONFIGURED (nunca corre às cegas)',
    expect: (r) => r.findings.filter((f) => f.group === 'actor').length === 1
      && r.findings.every((f) => !JSON.stringify(f.value).includes('Bearer')) },

  // ---------- busca social ----------
  { tool: 'social-search', input: { name: 'Albert Einstein' }, label: 'busca de um nome no indice do Bing, agrupada por rede',
    expect: (r) => hasGroup(r, 'resumo') && r.sources.some((s) => /bing/i.test(s.id + ' ' + s.label)) },

  // ---------- DataLikers (a chave decide o que se pode exigir) ----------
  // Sem chave o contrato é o do Apify: recusa a dizer DATALIKERS_API_KEY e não
  // fabrica nada. Com chave, o pedido é real e o que se exige é apenas que a
  // fonte esteja declarada e que a credencial não apareça em lado nenhum.
  { tool: 'datalikers', input: { alvo: 'natgeo' }, label: 'perfil de Instagram: recurso derivado, um pedido, proveniência declarada',
    expect: (r) => temChaveDataLikers
      ? (r.sources.some((s) => s.id === 'dl-ig-perfil')
        && r.findings.some((f) => f.group === 'resultado')
        && !JSON.stringify(r).includes('access_key='))
      : (r.findings.some((f) => String(f.value).includes('NOT_CONFIGURED'))
        && r.sources.some((s) => s.status === 'needs_key')
        && JSON.stringify(r.findings).includes('DATALIKERS_API_KEY')) },
  { tool: 'datalikers', input: { alvo: 'https://www.instagram.com/p/AbC123/', plataforma: 'tiktok' },
    label: 'URL do Instagram com plataforma TikTok: valida em vez de adivinhar',
    expect: (r) => r.findings.some((f) => f.group === 'validacao')
      && r.sources.every((s) => s.status !== 'ok') },
];

// ---------- classificadores ----------
function hasGroup(r: ToolRun, g: string): boolean { return r.findings.some((f) => f.group === g); }
function substantive(r: ToolRun): boolean {
  return r.findings.some((f) => {
    const v = f.value;
    if (v == null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    if (typeof v === 'string') return !/^(nao|n\/d|nenhum|vazio|-)$/i.test(v.trim());
    return true;
  });
}
/** Proveniência: achados de rede devem citar pelo menos uma fonte. */
function provenance(r: ToolRun): { ok: boolean; note: string } {
  // 'alvo' e o eco do input do utilizador: nao vem de fonte nenhuma, por definicao.
  // Grupos de resumo: agregam o que já foi dito, não trazem dados novos. Quando
  // não há nada, não há fonte para citar — e isso é honesto, não um buraco.
  const locais = ['local', 'validacao', 'forca', 'dorks', 'handoff', 'acoes', 'alvo', 'resumo',
    'grafo', 'grafo-completo', 'investigacao', 'passo', 'deteccao', 'conclusao', 'veredicto'];
  const external = r.findings.filter((f) => !locais.includes(f.group));
  if (!external.length) return { ok: true, note: 'só cálculo local' };
  const known = new Set(r.sources.map((s) => s.id));
  const orphans = external.filter((f) => f.evidence.sourceIds.length > 0 && f.evidence.sourceIds.every((s) => !known.has(s)));
  const semFonte = external.filter((f) => f.evidence.sourceIds.length === 0);
  if (orphans.length) return { ok: false, note: `${orphans.length} achados citam fontes inexistentes na matriz` };
  if (semFonte.length === external.length) return { ok: false, note: 'nenhum achado declara fonte' };
  return { ok: true, note: `${external.length - semFonte.length}/${external.length} com fonte declarada` };
}

// ---------- execução ----------
interface Row { c: Case; run?: ToolRun; err?: string; ms: number; prov: { ok: boolean; note: string }; verdict: string; why: string }

const rows: Row[] = [];
console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║  AUDITORIA DE FERRAMENTAS — ARGUS                                         ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

for (const c of CASES) {
  const t0 = Date.now();
  let run: ToolRun | undefined; let err: string | undefined;
  try {
    run = await executeTool(c.tool, c.input, { ...CTX });
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  const ms = Date.now() - t0;
  let verdict = 'OK'; let why = '';
  if (err) { verdict = 'ERRO'; why = err.slice(0, 70); }
  else if (run) {
    const subst = substantive(run);
    if (!subst) { verdict = 'VAZIO'; why = 'nenhum achado com conteúdo'; }
    else {
      const prov = provenance(run);
      if (!prov.ok) { verdict = 'PROV'; why = prov.note; }
      else if (c.expect && !c.expect(run)) { verdict = 'PARCIAL'; why = 'não cumpriu o critério do caso'; }
      else why = `${run.findings.length} achados · ${prov.note}`;
    }
  }
  rows.push({ c, run, err, ms, prov: run ? provenance(run) : { ok: true, note: '-' }, verdict, why });
  const mark = verdict === 'OK' ? '\x1b[32m✓\x1b[0m' : verdict === 'PARCIAL' ? '\x1b[33m~\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${mark} ${c.tool.padEnd(19)} ${String(ms).padStart(6)}ms  ${verdict.padEnd(8)} ${c.label}`);
  if (why) console.log(`    ${why}`);
  db.prepare('DELETE FROM usage').run();   // a auditoria nao deve gastar quota
  await new Promise((r) => setTimeout(r, 400));
}

// ---------- resumo ----------
const byVerdict = (v: string) => rows.filter((r) => r.verdict === v);
const toolsTested = [...new Set(rows.map((r) => r.c.tool))];
console.log(`\n─── RESUMO ───────────────────────────────────────────────────────────────`);
console.log(`ferramentas cobertas: ${toolsTested.length} / ${allTools().length}`);
console.log(`casos: ${rows.length}   OK: ${byVerdict('OK').length}   PARCIAL: ${byVerdict('PARCIAL').length}   VAZIO: ${byVerdict('VAZIO').length}   ERRO: ${byVerdict('ERRO').length}   PROV: ${byVerdict('PROV').length}`);

const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`latência: mediana ${lat[Math.floor(lat.length / 2)]}ms  máx ${lat[lat.length - 1]}ms`);

const naoTestadas = allTools().map((t: ToolDef) => t.id).filter((id) => !toolsTested.includes(id));
if (naoTestadas.length) console.log(`\nNÃO TESTADAS: ${naoTestadas.join(', ')}`);

// Inventário: o relatório final tem de sair daqui, não de memória.
console.log('\n─── INVENTÁRIO ───────────────────────────────────────────────────────');
for (const t of allTools().sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))) {
  const casos = rows.filter((r) => r.c.tool === t.id);
  const pior = casos.reduce((m, r) => Math.max(m, r.ms), 0);
  console.log(
    `  ${t.id.padEnd(20)} ${String(t.minPlan).padEnd(8)} ${String(casos.length).padStart(2)} caso(s)  ` +
    `max ${String(pior).padStart(6)}ms  ${casos.every((r) => r.verdict === 'OK') ? 'OK' : 'FALHA'}`,
  );
}

const problemas = rows.filter((r) => r.verdict !== 'OK');
if (problemas.length) {
  console.log(`\n─── A CORRIGIR ────────────────────────────────────────────────────────────`);
  for (const p of problemas) console.log(`  ${p.verdict.padEnd(8)} ${p.c.tool} (${p.c.label}): ${p.why}`);
}
console.log('');
process.exit(problemas.length ? 1 : 0);
