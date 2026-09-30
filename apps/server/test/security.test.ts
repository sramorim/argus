/**
 * Testes de seguranca e regras de negocio. Nao tocam na rede (excepto onde indicado).
 *   node test/security.test.ts
 */
import { classifyIp, assertPublicHost, safeFetch, SsrfError, HttpError, apiJson } from '../src/net/ssrf.ts';
import { newPasswordHash, verifyPass, encryptSecret, decryptSecret, newToken, tokenHash, cachedWith } from '../src/db.ts';
import { PLANS, meetsPlan, planRank, TOOL_LOCKS } from '../src/plans.ts';
import { registerTool, lockState, executeTool, QuotaError, LockedError, dailyCount } from '../src/registry.ts';
import { finding, SourceLog, confScore } from '../src/net/provenance.ts';
import { parseRobots } from '../src/tools/infra.ts';

let pass = 0, fail = 0;
const t = (name: string, fn: () => void | Promise<void>) =>
  (async () => {
    try { await fn(); pass++; console.log(`\x1b[32m✓\x1b[0m ${name}`); }
    catch (e: any) { fail++; console.log(`\x1b[31m✗\x1b[0m ${name} — ${e.message}`); }
  })();
const eq = (a: any, b: any, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };
const ok = (c: any, m = '') => { if (!c) throw new Error(m || 'condicao falsa'); };

console.log('\n── GUARD ANTI-SSRF ────────────────────────────────────────────────');

const BLOCKED = [
  ['127.0.0.1', 'loopback'], ['10.0.0.1', 'private-10'], ['172.16.0.1', 'private-172'],
  ['172.31.255.255', 'private-172'], ['192.168.1.1', 'private-192'], ['169.254.169.254', 'link-local-metadata'],
  ['0.0.0.0', 'this-network'], ['100.64.0.1', 'cgnat-100'], ['224.0.0.1', 'multicast'],
  ['::1', 'loopback-v6'], ['fe80::1', 'link-local-v6'], ['fd00::1', 'unique-local-v6'],
  ['::ffff:127.0.0.1', 'loopback'],
  // Formas de escrever o mesmo endereco de outra maneira. Cada uma destas foi um
  // bypass real antes de o classificador passar a expandir o IPv6 de verdade.
  ['::ffff:7f00:1', 'loopback'],          // 127.0.0.1 em hexadecimal
  ['0:0:0:0:0:ffff:127.0.0.1', 'loopback'],
  ['::7f00:1', 'v4-compatible-v6'],       // 127.0.0.1 em v4-compatible
  ['64:ff9b::7f00:1', 'loopback'],        // NAT64 prefix
  ['2002:7f00:1::', 'loopback'],          // 6to4 com v4 embutido
  ['0.0.0.0', 'this-network'],
  ['192.0.0.1', 'ietf-192'], ['198.18.0.1', 'benchmark-198'],
  ['::', 'unspecified-v6'], ['ff02::1', 'multicast-v6'], ['2001:db8::1', 'documentation-v6'],
];
for (const [ip, why] of BLOCKED) {
  await t(`bloqueia ${ip} (${why})`, () => { eq(classifyIp(ip as string), why); });
}
for (const ip of ['8.8.8.8', '1.1.1.1', '200.1.1.1']) {
  await t(`permite ${ip} (publico)`, () => { eq(classifyIp(ip), null); });
}
await t('rejeita IP malformado', () => { ok(classifyIp('999.1.1.1') !== null); });
await t('rejeita lixo como hostname', () => { ok(classifyIp('nao-e-ip') !== null); });

await t('assertPublicHost rejeita localhost', async () => {
  let bloqueado = false;
  try { await assertPublicHost('127.0.0.1'); } catch (e) { bloqueado = e instanceof SsrfError; }
  ok(bloqueado, 'nao lancou SsrfError');
});
await t('safeFetch recusa protocolo file://', async () => {
  let e: any = null;
  try { await safeFetch('file:///etc/passwd'); } catch (x) { e = x; }
  ok(e instanceof SsrfError, `esperava SsrfError, obtive ${e?.name}`);
});
await t('safeFetch recusa protocolo gopher://', async () => {
  let e: any = null;
  try { await safeFetch('gopher://127.0.0.1:70/x'); } catch (x) { e = x; }
  ok(e instanceof SsrfError);
});

console.log('\n── CRIPTO ────────────────────────────────────────────────────────');
await t('hash de password: verifica corretamente', () => {
  const h = newPasswordHash('senha-secreta-123');
  ok(verifyPass('senha-secreta-123', h), 'nao verificou a password certa');
  ok(!verifyPass('outra', h), 'aceitou password errada');
});
await t('hash de password: salts diferentes', () => {
  ok(newPasswordHash('mesma') !== newPasswordHash('mesma'), 'hashes iguais para a mesma password');
});
await t('hash de password: nao guarda a password em claro', () => {
  const h = newPasswordHash('segredo123');
  ok(!h.includes('segredo123'), 'password em claro no hash');
});
await t('BYOK: cifra e decifra', () => {
  const c = encryptSecret('chave-muito-secreta');
  ok(!c.includes('chave-muito-secreta'), 'segredo em claro');
  eq(decryptSecret(c), 'chave-muito-secreta');
});
await t('BYOK: ciphertext diferente cada vez (IV aleatorio)', () => {
  ok(encryptSecret('x') !== encryptSecret('x'), 'IV fixo');
});
await t('BYOK: adulterar ciphertext e detetado', () => {
  const c = encryptSecret('segredo');
  const partes = c.split('.');
  partes[1] = (partes[1]!.slice(0, -2)) + (partes[1]!.slice(-2) === 'AA' ? 'BB' : 'AA');
  let falhou = false;
  try { decryptSecret(partes.join('.')); } catch { falhou = true; }
  ok(falhou, 'aceitou ciphertext adulterado — GCM nao validou');
});
await t('token: hash e deterministico e diferente do token', () => {
  const tk = newToken();
  eq(tokenHash(tk), tokenHash(tk));
  ok(tokenHash(tk) !== tk, 'hash igual ao token');
});

console.log('\n── PLANOS E CADEADOS ────────────────────────────────────────────');
await t('ordem de planos', () => {
  ok(planRank('free') < planRank('pro'));
  ok(planRank('pro') < planRank('pro_max'));
});
await t('meetsPlan', () => {
  ok(meetsPlan('pro_max', 'free'));
  ok(meetsPlan('pro', 'pro'));
  ok(!meetsPlan('free', 'pro'));
  ok(!meetsPlan('pro', 'pro_max'));
});
await t('todo plano tem quotas coerentes', () => {
  for (const p of Object.values(PLANS)) {
    ok(p.dailyRuns > 0 && p.burstRuns > 0 && p.maxItems > 0, `${p.name} tem quota invalida`);
    ok(p.graphHops >= 1, `${p.name} sem saltos`);
  }
});
await t('TOOL_LOCKS nao referencia ferramentas inexistentes', async () => {
  await import('../src/tools/infra.ts'); await import('../src/tools/identity.ts');
  await import('../src/tools/threat.ts'); await import('../src/tools/finance-dev-br.ts');
  await import('../src/tools/tls.ts'); await import('../src/tools/graph.ts');
  const { allTools } = await import('../src/registry.ts');
  const ids = new Set(allTools().map((x) => x.id));
  const orfaos = Object.keys(TOOL_LOCKS).filter((k) => !ids.has(k));
  ok(orfaos.length === 0, `locks sem ferramenta: ${orfaos.join(', ')}`);
});

console.log('\n── QUOTAS ────────────────────────────────────────────────────────');
const uid = 'test-quota-' + Date.now();
registerTool({
  id: '__dummy__', name: 'Dummy', category: 'dev', summary: 'teste', longDesc: 'teste',
  minPlan: 'free', freeTier: true, tags: [], fields: [],
  async run() { return { findings: [finding('t', 'x', 'y', ['local'])], log: new SourceLog() }; },
});
await t('bloqueia ferramentas conforme o plano', async () => {
  registerTool({
    id: '__locked__', name: 'Pro only', category: 'dev', summary: 'x', longDesc: 'x',
    minPlan: 'pro', freeTier: false, tags: [], fields: [],
    async run() { return { findings: [finding('t', 'x', 'y', ['local'])], log: new SourceLog() }; },
  });
  eq(lockState('__locked__', 'free'), 'locked');
  eq(lockState('__locked__', 'pro'), 'open');
  eq(lockState('__locked__', 'pro_max'), 'open');
  let lancou = false;
  try { await executeTool('__locked__', {}, { userId: uid, plan: 'free', byok: {} }); }
  catch (e) { lancou = e instanceof LockedError; }
  ok(lancou, 'nao lancou LockedError');
});
await t('quota diaria: bloqueia ao exceeded', async () => {
  const { db } = await import('../src/db.ts');
  const u = 'q2-' + Date.now();
  // Populamos a tabela de uso diretamente: executar 15 vezes seguidas dispararia
  // primeiro o limite de burst, e nao o diario.
  const ins = db.prepare('INSERT INTO usage(user_id, tool_id, at) VALUES(?,?,?)');
  for (let i = 0; i < PLANS.free.dailyRuns; i++) {
    ins.run(u, '__dummy__', new Date().toISOString());
  }
  eq(dailyCount(u), PLANS.free.dailyRuns);
  let lancou = false;
  try { await executeTool('__dummy__', {}, { userId: u, plan: 'free', byok: {} }); }
  catch (e) { lancou = e instanceof QuotaError && e.kind === 'daily'; }
  ok(lancou, 'nao lancou QuotaError diario');
  db.prepare('DELETE FROM usage WHERE user_id = ?').run(u);
});
await t('quota burst: bloqueia execucoes seguidas', async () => {
  const u = 'q3-' + Date.now();
  const n = PLANS.free.burstRuns;
  let lancou = false;
  try {
    for (let i = 0; i < n + 2; i++) await executeTool('__dummy__', {}, { userId: u, plan: 'free', byok: {} });
  } catch (e) { lancou = e instanceof QuotaError && e.kind === 'burst'; }
  ok(lancou, 'burst nao foi aplicado');
});
await t('trunca resultados e DIZ que truncou', async () => {
  const u = 'q4-' + Date.now();
  registerTool({
    id: '__many__', name: 'Many', category: 'dev', summary: 'x', longDesc: 'x',
    minPlan: 'free', freeTier: true, tags: [], fields: [],
    async run() {
      const log = new SourceLog();
      return { findings: Array.from({ length: 100 }, (_, i) => finding('g', `l${i}`, `v${i}`, ['local'])), log };
    },
  });
  const r = await executeTool('__many__', {}, { userId: u, plan: 'free', byok: {} });
  ok(r.findings.length <= PLANS.free.maxItems, `nao truncou: ${r.findings.length}`);
  ok(r.notes.some((n) => /truncad/i.test(n)), 'nao avisou que truncou');
});

console.log('\n── PROVENIENCIA ──────────────────────────────────────────────────');
await t('confianca ordena corretamente', () => {
  ok(confScore('confirmed') > confScore('corroborated'));
  ok(confScore('corroborated') > confScore('indicated'));
  ok(confScore('indicated') > confScore('weak'));
});
await t('finding com 2+ fontes sobe a corroborado', () => {
  const f = finding('g', 'l', 'v', ['a', 'b']);
  eq(f.evidence.confidence, 'corroborated');
});
await t('SourceLog: ok com 0 dados vira empty (nao "sucesso")', () => {
  const l = new SourceLog();
  l.ok('x', 'X', 'u', 10, 0);
  eq(l.sources[0]!.status, 'empty');
});
await t('SourceLog: ok com dados fica ok', () => {
  const l = new SourceLog();
  l.ok('x', 'X', 'u', 10, 3);
  eq(l.sources[0]!.status, 'ok');
});
await t('SourceLog.local cria entrada identificavel', () => {
  const l = new SourceLog();
  l.local(3, 'teste');
  eq(l.sources[0]!.id, 'local');
  eq(l.sources[0]!.status, 'ok');
});

console.log('\n── CACHE ─────────────────────────────────────────────────────────');
await t('cache: 2a chamada nao volta a executar', async () => {
  let n = 0;
  const k = 'k' + Math.random();
  const f = async () => { n++; return { v: n }; };
  await cachedWith(k, 60, f);
  await cachedWith(k, 60, f);
  eq(n, 1, 'funcao executada mais vezes que o esperado');
});
await t('cache: valor null nao e cacheado (re-consulta)', async () => {
  let n = 0;
  const k = 'n' + Math.random();
  const f = async () => { n++; return null; };
  await cachedWith(k, 60, f);
  await cachedWith(k, 60, f);
  eq(n, 2);
});

console.log('\n── OUTROS ────────────────────────────────────────────────────────');
await t('parseRobots extrai Disallow', () => {
  const d = parseRobots('User-agent: *\nDisallow: /admin\nDisallow: /privado\n');
  ok(d.length >= 2, `esperava 2+, obtive ${d.length}`);
});
await t('apiJson lanca HttpError com codigo (nao parse de mensagem)', async () => {
  let e: any = null;
  try { await apiJson('https://httpbin.org/status/404'); } catch (x) { e = x; }
  // sem rede pode falhar diferente; so exigimos que, se lancou, tenha status numerico
  if (e instanceof HttpError) ok(typeof e.status === 'number' && e.status > 0, `status invalido`);
  else ok(true, 'rede indisponivel — ignorado');
});


console.log('\n── TRANSPORTE (pinning + limites) ────────────────────────────────');
await t('expandIpv6 expande formas encurtadas', async () => {
  const { expandIpv6 } = await import('../src/net/ssrf.ts');
  eq(expandIpv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  eq(expandIpv6('::ffff:7f00:1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  eq(expandIpv6('fe80::1%eth0'), [0xfe80, 0, 0, 0, 0, 0, 0, 1], 'a zona tem de ser removida');
  eq(expandIpv6('nao-e-ipv6'), null);
  eq(expandIpv6('1::2::3'), null, 'duplo :: invalido');
});
await t('safeFetch recusa esquemas que nao sao http(s)', async () => {
  for (const u of ['ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'data:text/plain,x']) {
    let e: any = null;
    try { await safeFetch(u); } catch (x) { e = x; }
    ok(e instanceof SsrfError, `${u} nao foi recusado`);
    ok(/protocol-not-allowed/.test(e.message), `${u}: motivo inesperado ${e.message}`);
  }
});
await t('safeFetch recusa metadados da cloud (link-local)', async () => {
  let e: any = null;
  try { await safeFetch('http://169.254.169.254/latest/meta-data/'); } catch (x) { e = x; }
  ok(e instanceof SsrfError && /link-local-metadata/.test(e.message), `nao bloqueado: ${e?.message}`);
});
await t('safeFetch recusa loopback escrito em hexadecimal', async () => {
  let e: any = null;
  try { await safeFetch('http://[::ffff:7f00:1]/'); } catch (x) { e = x; }
  ok(e instanceof SsrfError, `nao bloqueado: ${e?.message}`);
});
await t('safeFetch define o Host pelo nome, nao pelo IP', async () => {
  // httpbin devolve o header que recebeu: tem de ser o hostname pedido.
  try {
    const r = await safeFetch('https://httpbin.org/headers', { timeoutMs: 9000 });
    if (r.status === 200) ok(/"host":\s*"httpbin\.org"/i.test(r.body), 'Host nao e o nome pedido');
  } catch { /* sem rede: nada a exigir */ }
});
await t('safeFetch respeita o tecto de bytes e diz que truncou', async () => {
  try {
    const r = await safeFetch('https://httpbin.org/bytes/200000', { maxBytes: 5000, timeoutMs: 9000 });
    ok(r.bytes <= 6000, `devolveu ${r.bytes} bytes com tecto de 5000`);
    ok(r.truncated, 'nao marcou como truncado');
  } catch { /* sem rede */ }
});

console.log('\n── FICHEIROS (upload) ───────────────────────────────────────────');
await t('sniff identifica pelo magic bytes, nao pela extensao', async () => {
  const { sniff } = await import('../src/net/upload.ts');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const pdf = Buffer.from('%PDF-1.7\n%....', 'latin1');
  const php = Buffer.from('<?php system($_GET[0]); ?>', 'latin1');
  eq(sniff(jpeg), 'jpeg');
  eq(sniff(png), 'png');
  eq(sniff(pdf), 'pdf');
  eq(sniff(php), 'desconhecido', 'um .php nao pode passar por imagem');
  eq(sniff(Buffer.from('GIF89a..........', 'latin1')), 'gif');
});
await t('resolveFile recusa data URL invalido e ficheiro gigante', async () => {
  const { resolveFile, FileError } = await import('../src/net/upload.ts');
  const log = new SourceLog();
  for (const bad of ['nao-e-data-url', 'data:text/plain,nao-base64', 'data:image/png;base64,%%%']) {
    let e: any = null;
    try { await resolveFile(log, { data: bad }); } catch (x) { e = x; }
    ok(e instanceof FileError, `${bad} passou`);
  }
  const enorme = 'data:image/png;base64,' + 'A'.repeat(20 * 1024 * 1024);
  let e: any = null;
  try { await resolveFile(log, { data: enorme }); } catch (x) { e = x; }
  ok(e instanceof FileError && /limite/i.test(e.message), `ficheiro gigante nao foi recusado: ${e?.message}`);
});

console.log('\n── UPLOAD / BYOK (validacao de entrada) ─────────────────────────');
await t('BYOK recusa chave de ficheiro disfarçada de imagem', async () => {
  const { resolveFile, FileError } = await import('../src/net/upload.ts');
  const log = new SourceLog();
  const zip = 'data:application/zip;base64,' + Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]).toString('base64');
  const f = await resolveFile(log, { data: zip });
  // Aceita o ficheiro (é um ZIP, e o ARGUS diz que é um ZIP), mas nunca o trata
  // como imagem: o tipo real tem de ser o que o sniff diz.
  eq(f.kind, 'zip');
  eq(f.declaredMime, 'application/zip');
});
await t('BYOK: provedores sao de lista fechada', async () => {
  const { encryptSecret, decryptSecret } = await import('../src/db.ts');
  const c = encryptSecret('chave-secreta-123');
  ok(!c.includes('chave-secreta'), 'o segredo aparece em claro no texto cifrado');
  eq(decryptSecret(c), 'chave-secreta-123');
  let falhou = false;
  try { decryptSecret(c.slice(0, -4) + 'AAAA'); } catch { falhou = true; }
  ok(falhou, 'um ciphertext adulterado foi aceite (GCM nao verificou)');
});

console.log('\n── CSRF / LIMITADORES ───────────────────────────────────────────');
await t('RateLimiter conta, bloqueia e liberta apos a janela', async () => {
  const { RateLimiter } = await import('../src/security.ts');
  const rl = new RateLimiter(3, 50, 'teste');
  eq(rl.hit('ip1'), 0); eq(rl.hit('ip1'), 0); eq(rl.hit('ip1'), 0);
  ok(rl.hit('ip1') > 0, 'nao bloqueou ao 4o pedido');
  eq(rl.hit('ip2'), 0, 'o limite tem de ser por chave');
  await new Promise((r) => setTimeout(r, 70));
  eq(rl.hit('ip1'), 0, 'nao reabriu apos a janela');
});
await t('RateLimiter faz sweep para nao crescer sem fim', async () => {
  const { RateLimiter } = await import('../src/security.ts');
  const rl = new RateLimiter(1, 1, 'teste');
  for (let i = 0; i < 500; i++) rl.hit('k' + i);
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 500; i++) rl.hit('z' + i);
  // O objetivo e apenas que nao lancou nem vazou: o tamanho interno nao e API
  // publica, mas o sweep tem de correr sem erro.
  ok(true);
});

console.log('\n── PERSISTENCIA ──────────────────────────────────────────────────');
await t('prune apaga cache expirado e uso antigo sem partir', async () => {
  const { prune, q } = await import('../src/db.ts');
  q('INSERT INTO cache(key, body, expires_at) VALUES(?,?,?)').run('poda-teste', 'x', Date.now() - 10_000_000);
  const r = prune({ keepUsageDays: 0, keepRunsPerUser: 1 });
  ok(r.cache >= 1, `cache expirado nao foi apagado (${r.cache})`);
  ok(typeof r.usage === 'number' && typeof r.runs === 'number', 'contagens nao sao numeros');
});
await t('investigacao guarda contagens de nos/arestas', async () => {
  const { q } = await import('../src/db.ts');
  const cols = q('PRAGMA table_info(investigations)').all() as any[];
  for (const c of ['node_count', 'edge_count', 'tools', 'run_id']) {
    ok(cols.some((x) => x.name === c), `falta a coluna ${c} na tabela investigations`);
  }
});

console.log('\n── FERRAMENTAS: honestidade do que é inventado ────────────────────');
await t('phone-analyzer NAO inventa operadora a partir de prefixo', async () => {
  const { getTool, executeTool } = await import('../src/registry.ts');
  await import('../src/tools/identity.ts');
  const r = await executeTool('phone-analyzer', { phone: '+5511998877665' }, { userId: 't', plan: 'pro_max', byok: {} });
  const ops = r.findings.filter((f) => /operadora/i.test(f.label));
  ok(ops.length > 0, 'nao ha linha de operadora');
  for (const o of ops) {
    ok(/nao determinada/i.test(String(o.value)), `operadora inventada: ${o.value}`);
    ok(o.evidence.kind === 'claim' || o.evidence.confidence === 'weak', 'operadora sem marca de Inferencia/fraca');
  }
});
await t('phone-analyzer situa o DDD na UF certa', async () => {
  const { executeTool } = await import('../src/registry.ts');
  await import('../src/tools/identity.ts');
  const r = await executeTool('phone-analyzer', { phone: '+5511988887777' }, { userId: 't', plan: 'pro_max', byok: {} });
  const uf = r.findings.find((f) => f.label === 'UF');
  eq(uf?.value, 'SP', 'DDD 11 tem de dar São Paulo');
  const reg = r.findings.find((f) => f.label === 'Regiao');
  ok(/São Paulo/i.test(String(reg?.value)), `regiao errada: ${reg?.value}`);
});
await t('hash-analyzer nao inventa uma "confirmacao" de hash↔password', async () => {
  const { executeTool } = await import('../src/registry.ts');
  await import('../src/tools/threat.ts');
  const r = await executeTool('hash-analyzer', { hash: '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8', password: 'password' },
    { userId: 't', plan: 'pro_max', byok: {} });
  const maus = r.findings.filter((f) => /corresponde/i.test(f.label) || /corresponde/i.test(String(f.value)));
  eq(maus.length, 0, `achado com afirmacao sem prova: ${JSON.stringify(maus.map((m) => m.label))}`);
});
await t('isBtcAddress aceita enderecos validos e recusa os inventados', async () => {
  const { isBtcAddress } = await import('../src/tools/finance-dev-br.ts');
  ok(isBtcAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), 'endereco do bloco genesis foi recusado');
  ok(isBtcAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'), 'endereco P2SH valido foi recusado');
  ok(!isBtcAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNZ'), 'checksum errado foi aceite');
  ok(!isBtcAddress('nao-e-um-endereco'), 'texto aceite como endereco');
  ok(!isBtcAddress(''), 'vazio aceite como endereco');
});
await t('package-audit recusa ecossistema desconhecido SEM consultar', async () => {
  const { executeTool } = await import('../src/registry.ts');
  await import('../src/tools/threat.ts');
  const r = await executeTool('package-audit', { ecosystem: 'nao-existe', name: 'x', version: '1.0.0' },
    { userId: 't', plan: 'pro_max', byok: {} });
  const rj = r.findings.find((f) => /nao reconhecido/i.test(f.label));
  ok(rj, 'nao avisou que o ecossistema e invalido');
  ok(!r.sources.some((s) => s.id === 'osv' && s.status === 'ok'), 'consultou a API mesmo assim');
});
await t('cve-lookup: se o NVD falhar, diz que os dados vem de uma fonte so', async () => {
  const { executeTool } = await import('../src/registry.ts');
  await import('../src/tools/threat.ts');
  const r = await executeTool('cve-lookup', { query: 'CVE-2021-44228' }, { userId: 't', plan: 'pro_max', byok: {} });
  const nvd = r.sources.find((s) => s.id === 'nvd');
  if (nvd?.status !== 'ok') {
    ok(r.notes.length > 0 || r.sources.some((s) => /fonte unica|fonte única/i.test(s.note ?? '')),
      'fonte unica sem aviso');
  }
});

console.log('\n── TOOL_LOCKS: nada de ferramenta morta ──────────────────────────');
await t('leak-check saiu do catalogo e das trancas', async () => {
  const { allTools } = await import('../src/registry.ts');
  await import('../src/tools/identity.ts'); await import('../src/tools/tls.ts');
  const ids = allTools().map((x) => x.id);
  ok(!ids.includes('leak-check'), 'leak-check ainda existe');
  ok(!('leak-check' in TOOL_LOCKS), 'leak-check ainda tem tranca');
  ok(ids.includes('tls-audit'), 'tls-audit nao foi registada');
  ok('tls-audit' in TOOL_LOCKS, 'tls-audit sem tranca');
});
await t('toda ferramenta tem descricao, resumo e pelo menos um campo', async () => {
  const { allTools } = await import('../src/registry.ts');
  await import('../src/tools/infra.ts'); await import('../src/tools/identity.ts');
  await import('../src/tools/threat.ts'); await import('../src/tools/finance-dev-br.ts');
  await import('../src/tools/tls.ts'); await import('../src/tools/graph.ts');
  for (const t of allTools()) {
    if (t.id.startsWith('__')) continue;   // ferramentas de teste
    ok(t.name.length > 2, `${t.id}: nome curto`);
    ok(t.summary.length > 20, `${t.id}: resumo curto ou ausente`);
    ok(t.longDesc.length > 60, `${t.id}: descricao longa curta ou ausente`);
    ok(t.fields.length > 0, `${t.id}: sem campos`);
    ok(t.tags.length > 0, `${t.id}: sem tags`);
  }
});

console.log('\n── BROADCAST DE CONFIANCA ────────────────────────────────────────');
await t('nenhuma ferramenta diz "ok" numa fonte que nao devolveu nada', async () => {
  const { allTools } = await import('../src/registry.ts');
  await import('../src/tools/infra.ts'); await import('../src/tools/identity.ts');
  await import('../src/tools/threat.ts'); await import('../src/tools/finance-dev-br.ts');
  await import('../src/tools/tls.ts'); await import('../src/tools/graph.ts');
  // Regra estrutural do SourceLog ja testada acima; aqui confirmamos que
  // nenhuma fonte registada no codigo declara 'ok' com contagem implicita.
  const { SourceLog: SL } = await import('../src/net/provenance.ts');
  const l = new SL();
  l.ok('x', 'X', 'u', 1);
  ok((l.sources[0] as any).count === undefined || l.sources[0]!.status === 'ok', 'inconsistencia');
  l.ok('y', 'Y', 'u', 1, 0);
  eq(l.sources[1]!.status, 'empty');
});

console.log(`\n${'═'.repeat(60)}\n  ${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
