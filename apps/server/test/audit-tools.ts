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
await import('../src/tools/infra.ts');
await import('../src/tools/identity.ts');
await import('../src/tools/username-intel.ts');
await import('../src/tools/threat.ts');
await import('../src/tools/finance-dev-br.ts');
await import('../src/tools/tls.ts');
await import('../src/tools/graph.ts');
await import('../src/tools/social.ts');
await import('../src/tools/social-search.ts');
await import('../src/tools/osint-engine.ts');
await import('../src/tools/apify.ts');

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8787';
const CTX = { userId: 'audit-user', plan: 'pro_max' as const, byok: {} as Record<string, string> };

interface Case { tool: string; input: Record<string, string>; label: string; expect?: (r: ToolRun) => boolean }
const CASES: Case[] = [
  // ---------- infraestrutura ----------
  { tool: 'domain-analyzer', input: { domain: 'wikipedia.org' }, label: 'RDAP/DNS/CT de um domínio grande',
    expect: (r) => hasGroup(r, 'subdominios') && hasGroup(r, 'rdap') },
  { tool: 'domain-analyzer', input: { domain: 'naoexiste-mesmo-xyz123456789.com' }, label: 'domínio inexistente (deve degradas sem crash)',
    expect: (r) => r.findings.length > 0 },
  { tool: 'ip-analyzer', input: { ip: '1.1.1.1' }, label: 'IP público com tudo',
    expect: (r) => r.findings.length >= 5 },
  { tool: 'ip-analyzer', input: { ip: '192.168.1.1' }, label: 'IP privado (deve avisar, não inventar)',
    expect: (r) => r.findings.length > 0 },
  { tool: 'port-scanner', input: { target: '1.1.1.1' }, label: 'portas passivas via InternetDB',
    expect: (r) => substantive(r) },
  { tool: 'asn-lookup', input: { asn: 'AS13335' }, label: 'ASN real (Cloudflare)',
    expect: (r) => substantive(r) },
  { tool: 'url-scanner', input: { url: 'https://example.com' }, label: 'URL HTTP real',
    expect: (r) => substantive(r) },
  { tool: 'web-crawler', input: { url: 'https://example.com' }, label: 'crawler de página real',
    expect: (r) => substantive(r) },
  // ---------- identidade ----------
  { tool: 'username-finder', input: { username: 'torvalds' }, label: 'username conhecido em várias plataformas',
    expect: (r) => hasGroup(r, 'plataforma') },
  { tool: 'email-analyzer', input: { email: 'torvalds@kernel.org' }, label: 'email com MX real',
    expect: (r) => hasGroup(r, 'mx') },
  { tool: 'phone-analyzer', input: { phone: '+5511998877665' }, label: 'telefone BR',
    expect: (r) => hasGroup(r, 'validacao') },
  { tool: 'password-check', input: { password: 'password' }, label: 'password vazada (k-anonymity)',
    expect: (r) => r.findings.some((f) => /[1-9]/.test(String(f.value))) },
  // tls-audit: handshake real, sem depender de nenhuma API de terceiros
  { tool: 'tls-audit', input: { host: 'github.com' }, label: 'certificado TLS real de um dominio ativo',
    expect: (r) => r.findings.some((f) => f.label === 'Valido ate' && f.evidence.sourceIds.includes('tls'))
               && r.findings.some((f) => f.label === 'Protocolo negociado' && /TLSv1\.[23]/.test(String(f.value))) },
  { tool: 'tls-audit', input: { host: 'expired.badssl.com' }, label: 'certificado expirado (tem de DETETAR a expiracao, nao dizer que esta bem)',
    expect: (r) => r.findings.some((f) => f.label === 'Problemas detetados' && /EXPIRADO/i.test(JSON.stringify(f.value)))
               && r.findings.some((f) => f.label === 'Dias que faltam para expirar' && Number(f.value) < 0) },
  { tool: 'tls-audit', input: { host: 'nao-existe-argus-zzz.invalid' }, label: 'dominio inexistente (deve degradar, nao inventar)',
    expect: (r) => r.findings.some((f) => /Handshake falhou|Nao foi possivel/i.test(f.label)) },
  { tool: 'tls-audit', input: { host: '127.0.0.1' }, label: 'destino bloqueado pelo guard anti-SSRF (tem de dizer que foi bloqueado)',
    expect: (r) => /bloqueado/i.test(JSON.stringify(r.findings) + JSON.stringify(r.sources)) },
  { tool: 'telegram-osint', input: { target: 'durov' }, label: 'canal Telegram público real',
    expect: (r) => substantive(r) },
  // ---------- ameaça / dev ----------
  { tool: 'reputation-check', input: { target: 'debian.org' }, label: 'domínio limpo (não deve estar em blocklist)',
    expect: (r) => r.sources.some((s) => s.status === 'ok') },
  { tool: 'hash-analyzer', input: { hash: '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8' }, label: 'hash SHA-1',
    expect: (r) => r.findings.some((f) => /SHA-1/i.test(f.label)) },
  { tool: 'cve-lookup', input: { query: 'CVE-2021-44228' }, label: 'CVE conhecida (NVD formato novo)',
    expect: (r) => r.findings.some((f) => /10/.test(String(f.value)) || /CRITICAL/i.test(String(f.value))) },
  { tool: 'cve-lookup', input: { query: 'log4j' }, label: 'pesquisa por palavra-chave',
    expect: (r) => r.findings.length > 0 },
  { tool: 'package-audit', input: { ecosystem: 'npm', name: 'lodash', version: '4.17.15' }, label: 'pacote com CVE real',
    expect: (r) => r.findings.length >= 2 },
  { tool: 'package-audit', input: { ecosystem: 'npm', name: 'express', version: '4.21.2' }, label: 'pacote recente (deve estar limpo)',
    expect: (r) => substantive(r) },
  // ---------- crypto / github / dev / br / geo / web ----------
  { tool: 'crypto-tracer', input: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }, label: 'endereço BTC (bloco génesis)',
    expect: (r) => hasGroup(r, 'onchain') },
  { tool: 'github-osint', input: { username: 'torvalds' }, label: 'perfil GitHub real',
    expect: (r) => hasGroup(r, 'perfil') && r.findings.length >= 5 },
  { tool: 'github-osint', input: { username: 'utilizador-inexistente-zzz999xyz' }, label: 'GitHub inexistente (deve degradar)',
    expect: (r) => r.findings.length > 0 },
  { tool: 'dorks-generator', input: { term: 'example.com' }, label: 'dorks para domínio',
    expect: (r) => hasGroup(r, 'dorks') },
  { tool: 'dorks-generator', input: { term: 'pessoa@exemplo.com', engine: 'sim' }, label: 'dorks + busca real',
    expect: (r) => r.findings.length >= 2 },
  { tool: 'metadata-extractor', input: { url: 'https://www.python.org/static/img/python-logo.png' }, label: 'PNG real',
    expect: (r) => substantive(r) },
  { tool: 'company-br', input: { cnpj: '11222333000181' }, label: 'CNPJ que existe (Receita Federal)',
    expect: (r) => hasGroup(r, 'empresa') },
  { tool: 'zipcode-br', input: { cep: '01310-100' }, label: 'CEP real com 2 fontes',
    expect: (r) => r.sources.filter((s) => s.status === 'ok').length >= 2 },
  { tool: 'geo-lookup', input: { q: 'Sao Paulo' }, label: 'geocodificação',
    expect: (r) => hasGroup(r, 'geo') },
  { tool: 'geo-lookup', input: { q: '-23.5505,-46.6333' }, label: 'reverse-geocode de coordenadas',
    expect: (r) => substantive(r) },
  { tool: 'reverse-image', input: { url1: 'https://www.python.org/static/img/python-logo.png' }, label: 'pHash de imagem real',
    expect: (r) => r.findings.some((f) => f.label.includes('pHash') && String(f.value).length === 64) },
  { tool: 'reverse-image', input: { url1: 'https://www.python.org/static/img/python-logo.png', url2: 'https://www.python.org/static/img/python-logo.png' }, label: 'pHash de imagem consigo mesma (hamming deve ser 0)',
    expect: (r) => r.findings.some((f) => f.label.includes('Hamming') && String(f.value).trim() === '0') },
  { tool: 'paste-search', input: { term: 'example.com', exec: 'nao' }, label: 'dorks de paste sem executar',
    expect: (r) => hasGroup(r, 'dorks') },
  // ---- qualidade de resultado (nao basta devolver estrutura) ----
  { tool: 'metadata-extractor', input: { url: 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg' },
    label: 'EXIF real com GPS (deve extrair coordenadas)',
    expect: (r) => r.findings.some((f) => f.group === 'gps' && /^-?\d+\.\d+, -?\d+\.\d+$/.test(String(f.value)))
                   && r.findings.some((f) => /COOLPIX|NIKON/i.test(String(f.value))) },
  { tool: 'phone-analyzer', input: { phone: '+5511998877665' }, label: 'movel BR valido (nao pode marcar invalido)',
    expect: (r) => r.findings.some((f) => f.label === 'Comprimento valido' && f.value === 'sim')
                   && r.findings.some((f) => f.label === 'Tipo de linha' && f.value === 'Movel') },
  { tool: 'web-crawler', input: { url: 'https://example.com' }, label: 'crawler tem de achar links (HTML sem aspas)',
    expect: (r) => r.findings.some((f) => f.label.startsWith('Links encontrados') && /\d/.test(f.label)) },
  { tool: 'paste-search', input: { term: 'pastebin', exec: 'sim' }, label: 'pesquisa real via Bing RSS',
    expect: (r) => r.sources.some((s) => s.id === 'bing' && s.status === 'ok') },
  { tool: 'graph-investigation', input: { seed: 'torvalds' }, label: 'grafo de username',
    expect: (r) => r.findings.some((f) => f.group === 'grafo-completo' && String(f.value).includes('"nodes"')) },
  { tool: 'graph-investigation', input: { seed: '@@@ !!!' }, label: 'alvo nao reconhecido (tem de dizer o que reconhece)',
    expect: (r) => r.findings.some((f) => /reconhece/i.test(f.label)) },
  // ---- anti-falso-positivo: e o teste que o catalogo nao tinha ----
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
  { tool: 'reputation-check', input: { target: 'debian.org' }, label: 'dominario limpo nao pode ser alertado',
    expect: (r) => r.findings.some((f) => f.label === 'Não consta nas listas consultadas') },
  { tool: 'crypto-tracer', input: { address: 'nao-e-um-endereco' }, label: 'endereco BTC invalido (tem de recusar ANTES de consultar)',
    expect: (r) => r.findings.some((f) => /checksum/i.test(String(f.value))) && !r.sources.some((s) => s.id === 'blockchain-info') },
  { tool: 'package-audit', input: { ecosystem: 'nao-existe', name: 'x', version: '1' }, label: 'ecossistema invalido (nao pode dizer "sem vulnerabilidades")',
    expect: (r) => r.findings.some((f) => /nao reconhecido/i.test(f.label)) && !r.findings.some((f) => /Nenhuma vulnerabilidade/i.test(f.label)) },
  { tool: 'phone-analyzer', input: { phone: '+999123456789' }, label: 'telefone de pais desconhecido (nao pode chamar ao Brasil)',
    expect: (r) => !r.findings.some((f) => f.label === 'Pais' && f.value === 'Brasil') },
  { tool: 'ip-analyzer', input: { ip: '192.168.1.1' }, label: 'IP privado (nao pode devolver coordenadas inventadas)',
    expect: (r) => !r.findings.some((f) => f.label === 'Coordenadas (aproximadas)') },
  { tool: 'metadata-extractor', input: {}, label: 'sem ficheiro (tem de pedir input, nao devolver nada)',
    expect: (r) => r.findings.length > 0 && /URL|upload|Forneca|Envie/i.test(JSON.stringify(r.findings)) },
  // ---------- presença pública: redes com API aberta ----------
  { tool: 'bluesky-osint', input: { target: 'bsky.app/profile/bsky.app' }, label: 'perfil Bluesky publico (perfil + feed + rede)',
    expect: (r) => hasGroup(r, 'perfil') || hasGroup(r, 'publicacoes') },
  { tool: 'bluesky-osint', input: { target: 'nao-existe-argus-zzz.bsky.social' }, label: 'handle Bluesky inexistente (tem de avisar, nao inventar)',
    expect: (r) => r.findings.length > 0 },
  { tool: 'mastodon-osint', input: { target: 'gargron@mastodon.social' }, label: 'perfil Mastodon publico em instancia real',
    expect: (r) => hasGroup(r, 'perfil') || hasGroup(r, 'publicacoes') },
  { tool: 'social-search', input: { name: 'Albert Einstein' }, label: 'busca de um nome no indice do Bing, agrupada por rede',
    expect: (r) => hasGroup(r, 'resumo') && r.sources.some((s) => /bing/i.test(s.id + ' ' + s.label)) },
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
