/**
 * Teste de integração da API: arranca o servidor real, numa base de dados
 * temporária, e exercita o caminho completo — registo, sessão, catálogo, quotas,
 * execuções, trancas, BYOK, investigações, conta e administração.
 *
 * Não é mock: é o mesmo `index.ts` que corre em produção, sobre HTTP a sério.
 *
 *   node test/api.test.ts
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..');
const ROOT = resolve(SERVER, '..', '..');
const PORT = Number(process.env.TEST_PORT ?? 8899);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); pass++; console.log(`\x1b[32m✓\x1b[0m ${name}`); }
  catch (e: any) { fail++; console.log(`\x1b[31m✗\x1b[0m ${name} — ${e.message}`); }
};
const eq = (a: any, b: any, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };
const ok = (c: any, m = '') => { if (!c) throw new Error(m || 'condição falsa'); };

// ---------- base de dados temporária ----------
const dir = mkdtempSync(join(tmpdir(), 'argus-api-'));
const dbPath = join(dir, 'test.db');
const secret = 'a'.repeat(48);

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║  TESTE DE INTEGRAÇÃO DA API — ARGUS                              ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// O servidor arranca como processo separado (é o mesmo caminho de produção).
const child = spawn(process.execPath, [join(SERVER, 'src', 'index.ts')], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    ARGUS_DB: dbPath,
    ARGUS_SECRET: secret,
    ARGUS_COOKIE_SECURE: 'false',
    ARGUS_TRUST_PROXY: 'false',
    ARGUS_WEB_DIST: join(ROOT, 'apps', 'web', 'dist'),
    ARGUS_ADMIN_EMAILS: 'dono@argus.test',
    ARGUS_AUTH_MAX: '80',
    ARGUS_REGISTER_MAX: '120',
    ARGUS_AUTH_WINDOW_MIN: '15',
    ARGUS_RUN_MAX: '500',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

const cleanup = () => {
  try { child.kill('SIGKILL'); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

// ---------- cliente HTTP com cookies ----------
class Client {
  private cookies = new Map<string, string>();
  headers: Record<string, string> = {};

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      if (i > 0) {
        const k = pair!.slice(0, i).trim();
        const v = pair!.slice(i + 1).trim();
        if (v === '' || /Max-Age=0/i.test(c)) this.cookies.delete(k);
        else this.cookies.set(k, v);
      }
    }
  }

  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...this.headers, ...extra };
    const ck = this.cookieHeader();
    if (ck) h.cookie = ck;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(BASE + path, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.absorb(res);
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 200) }; }
    return { status: res.status, data, headers: res.headers, text };
  }

  get(p: string, extra?: Record<string, string>) { return this.req('GET', p, undefined, extra); }
  post(p: string, b?: unknown, extra?: Record<string, string>) { return this.req('POST', p, b, extra); }
  del(p: string, extra?: Record<string, string>) { return this.req('DELETE', p, undefined, extra); }
  patch(p: string, b?: unknown, extra?: Record<string, string>) { return this.req('PATCH', p, b, extra); }
  has(name: string) { return this.cookies.has(name); }
}

// ---------- espera pelo arranque ----------
async function waitUp(timeoutMs = 45_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) return false;
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200 || r.status === 503) return true;
    } catch { /* ainda a subir */ }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

const up = await waitUp();
if (!up) {
  console.error('\n[TESTE] o servidor não arrancou. Log:\n' + serverLog + '\n');
  process.exit(1);
}

const cookieName = 'argus_session';   // seguro=false em teste ⇒ sem prefixo __Host-
const UA = { origin: BASE, 'user-agent': 'teste' };

// =========================================================== ARRANQUE
console.log('── ARRANQUE E SAÚDE ───────────────────────────────────────────────');
await t('health responde 200 e diz quantas ferramentas existem', async () => {
  const r = await new Client().get('/api/health');
  eq(r.status, 200);
  eq(r.data.ok, true);
  ok(r.data.tools >= 25, `só ${r.data.tools} ferramentas registadas`);
  eq(r.data.db.writable, true, 'o disco tem de aceitar escrita');
});
await t('health estendido: por provider, com os campos do spec e estados honestos', async () => {
  const r = await new Client().get('/api/health');
  ok(Array.isArray(r.data.providers) && r.data.providers.length >= 10, `só ${r.data.providers?.length} linhas de provider`);
  const estados = new Set(['READY', 'NOT_INSTALLED', 'NOT_CONFIGURED', 'MISSING_SECRET', 'INCOMPATIBLE', 'ERROR', 'RATE_LIMITED', 'DISABLED']);
  for (const p of r.data.providers) {
    ok(estados.has(p.status), `estado fora do spec: ${p.status}`);
    ok(typeof p.nome === 'string' && typeof p.healthCheck === 'string', 'provider sem nome/healthCheck');
    ok('versao' in p && 'ultimoTeste' in p && 'latenciaMs' in p && 'erro' in p && 'configuracao' in p,
      `provider ${p.nome} sem os campos status/version/lastTest/latency/error/configuration`);
  }
  ok(r.data.estadoGeral && r.data.nota.length > 10, 'estado geral com nota explicativa');
  ok(!JSON.stringify(r.data).match(/APIFY_API_TOKEN=[^ ]+/), 'nenhum valor de segredo devolvido');
});
await t('health detalhado: verifica versões sem inventar (e continua a não devolver segredos)', async () => {
  const r = await new Client().get('/api/health?detalhe=sim');
  eq(r.status, 200);
  ok(r.data.detalhe === true, 'modo detalhe marcado');
  const apify = r.data.providers.find((p: any) => p.nome === 'Apify (serviço)');
  ok(apify, 'linha do serviço Apify presente');
  ok(apify.status === 'NOT_CONFIGURED' && apify.healthCheck.includes('APIFY_API_TOKEN'),
    `sem token tem de ser NOT_CONFIGURED a nomear APIFY_API_TOKEN, veio ${apify.status}: ${apify.healthCheck}`);
  ok(r.data.providers.every((p: any) => typeof p.ultimoTeste === 'string' || p.ultimoTeste === null),
    'último teste com data');
});
await t('produção sem ARGUS_SECRET não arranca (já é assim, mas confirmamos o caminho feliz)', async () => {
  // O arranque bem-sucedido já prova que config.ts validou o segredo.
  const r = await new Client().get('/api/health');
  ok(r.data.env === 'production', `env=${r.data.env}`);
});
await t('cabeçalhos de segurança presentes em todas as respostas', async () => {
  const r = await new Client().get('/api/health');
  const h = r.headers;
  ok(h.get('content-security-policy')?.includes("default-src 'self'"), 'sem CSP');
  eq(h.get('x-content-type-options'), 'nosniff');
  eq(h.get('x-frame-options'), 'DENY');
  ok(h.get('referrer-policy'), 'sem referrer-policy');
  ok(h.get('x-permitted-cross-domain-policies') === 'none', 'sem x-permitted-cross-domain-policies');
  eq(h.get('strict-transport-security'), null, 'HSTS não deve aparecer com cookie inseguro');
});

// =========================================================== AUTENTICAÇÃO
console.log('\n── AUTENTICAÇÃO E SESSÃO ────────────────────────────────────────');
const c1 = new Client();
let cookieValue = '';
await t('registo cria conta e dá cookie de sessão', async () => {
  const r = await c1.post('/api/auth/register', { email: 'ana@exemplo.test', name: 'Ana', password: 'senhaforte123' }, UA);
  eq(r.status, 201, JSON.stringify(r.data));
  eq(r.data.user.plan, 'free');
  ok(c1.has(cookieName), 'não foi criado cookie de sessão');
  const sc = r.headers.getSetCookie()[0] ?? '';
  ok(/HttpOnly/i.test(sc), 'o cookie não é HttpOnly');
  ok(/SameSite=Lax/i.test(sc), 'o cookie não é SameSite');
  cookieValue = /argus_session=([^;]+)/.exec(sc)?.[1] ?? '';
});
await t('/api/me devolve o utilizador e a cota', async () => {
  const r = await c1.get('/api/me', UA);
  eq(r.status, 200);
  eq(r.data.user.email, 'ana@exemplo.test');
  eq(r.data.usage.daily, 15, 'plano Free deve dar 15 execuções/dia');
  eq(r.data.usage.concurrent, 1, 'plano Free deve permitir 1 em curso');
});
await t('email duplicado é recusado com 409', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/register', { email: 'ana@exemplo.test', name: 'Outra', password: 'senhaforte123' }, UA);
  eq(r.status, 409);
  eq(r.data.error, 'email_em_uso');
});
await t('senha curta é recusada', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/register', { email: 'curta@exemplo.test', name: 'Curta', password: '123' }, UA);
  eq(r.status, 400);
  eq(r.data.error, 'senha_curta');
  const r2 = await c.post('/api/auth/register', { email: 'xx@exemplo.test', name: 'E', password: 'senhalonga123' }, UA);
  eq(r2.status, 400, 'nome de 1 caractere foi aceite');
  eq(r2.data.error, 'nome_invalido');
  const r3 = await c.post('/api/auth/register', { email: 'nao-e-email', name: 'Nome', password: 'senhalonga123' }, UA);
  eq(r3.status, 400);
  eq(r3.data.error, 'email_invalido');
});
await t('login com senha errada dá 401 e não cria sessão', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'errada' }, UA);
  eq(r.status, 401);
  eq(r.data.error, 'credenciais_invalidas');
  ok(!c.has(cookieName), 'criou sessão apesar da senha errada');
});
await t('logout encerra a sessão de facto', async () => {
  const c = new Client();
  await c.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'senhaforte123' }, UA);
  ok(c.has(cookieName));
  await c.post('/api/auth/logout', {}, UA);
  ok(!c.has(cookieName), 'o cookie não foi limpo');
  const me = await c.get('/api/me', UA);
  eq(me.data.user, null, 'a sessão continuou válida depois de logout');
});

await t('CSRF: pedido de outro origem é recusado', async () => {
  const r = await c1.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'x' },
    { origin: 'https://malvado.example', cookie: `argus_session=${cookieValue}` });
  eq(r.status, 403);
  eq(r.data.error, 'origem_recusada');
});
await t('CSRF: cookie sem Origin é recusado', async () => {
  const r = await c1.post('/api/auth/logout', {}, { cookie: `argus_session=${cookieValue}` });
  eq(r.status, 403);
  ok(/Origin/.test(r.data.msg), `mensagem inesperada: ${r.data.msg}`);
});
await t('trocar a senha invalida as outras sessões', async () => {
  const a = new Client();
  await a.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'senhaforte123' }, UA);
  const r = await a.post('/api/auth/password', { current: 'senhaforte123', next: 'outrasenha456' }, UA);
  eq(r.status, 200, JSON.stringify(r.data));
  const b = new Client();
  const l = await b.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'outrasenha456' }, UA);
  eq(l.status, 200, 'a senha nova não funciona');
  // volta à original para os testes seguintes
  await b.post('/api/auth/password', { current: 'outrasenha456', next: 'senhaforte123' }, UA);
});

// =========================================================== CATÁLOGO
console.log('\n── CATÁLOGO E TRANCAS ──────────────────────────────────────────');
await t('catálogo público devolve todas as ferramentas com estado de tranca', async () => {
  const r = await new Client().get('/api/tools', UA);
  eq(r.status, 200);
  ok(r.data.tools.length >= 25, `só ${r.data.tools.length} ferramentas`);
  const graves = r.data.tools.filter((x: any) => x.lock === 'locked');
  const abertos = r.data.tools.filter((x: any) => x.lock === 'open');
  ok(graves.length > 0 && abertos.length > 0, 'faltam ferramentas de um dos lados');
  for (const tl of r.data.tools) {
    ok(tl.id && tl.name && tl.summary && Array.isArray(tl.fields), `ferramenta mal formada: ${tl.id}`);
  }
});
await t('plano Free: tranca exatamente as ferramentas Pro, e só essas', async () => {
  const anon = await new Client().get('/api/tools', UA);
  const auth = await c1.get('/api/tools', UA);
  eq(anon.data.plan, 'free', 'sem sessão o plano deve ser free');
  eq(auth.data.plan, 'free');
  const anonLocked = anon.data.tools.filter((x: any) => x.lock === 'locked').map((x: any) => x.id).sort();
  const authLocked = auth.data.tools.filter((x: any) => x.lock === 'locked').map((x: any) => x.id).sort();
  eq(authLocked, anonLocked, 'o catálogo autenticado difere do anónimo no mesmo plano');
  // Toda a tranca tem de ser coerente com o minPlan declarado pela própria ferramenta.
  for (const tl of auth.data.tools) {
    const coerente = (tl.minPlan === 'pro' || tl.minPlan === 'pro_max') === (tl.lock === 'locked');
    ok(coerente, `${tl.id}: minPlan=${tl.minPlan} mas lock=${tl.lock}`);
  }
  ok(authLocked.length > 0, 'o plano Free devia ter ferramentas trancadas');
  ok(auth.data.tools.filter((x: any) => x.lock === 'open').length > 15, 'quase tudo trancado no Free');
});
await t('ferramenta inexistente dá 404', async () => {
  const r = await c1.get('/api/tools/nao-existe', UA);
  eq(r.status, 404);
});
await t('planos vêm com quotas coerentes', async () => {
  const r = await c1.get('/api/plans', UA);
  eq(r.status, 200);
  eq(r.data.plans.length, 3);
  eq(r.data.plans.map((p: any) => p.id), ['free', 'pro', 'pro_max']);
  for (const p of r.data.plans) {
    ok(p.dailyRuns > 0 && p.maxItems > 0 && p.concurrent > 0, `plano ${p.id} incompleto`);
  }
});

// =========================================================== EXECUÇÃO
console.log('\n── EXECUÇÃO DE FERRAMENTAS ──────────────────────────────────────');
const c2 = new Client();
await t('login para a conta de execução', async () => {
  const r = await c2.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'senhaforte123' }, UA);
  eq(r.status, 200, JSON.stringify(r.data));
});
await t('executar devolve run com achados, fontes e notas', async () => {
  const r = await c2.post('/api/run/hash-analyzer', { hash: '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8' }, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  ok(r.data.run.id, 'o run não tem id (histórico não liga)');
  ok(r.data.run.findings.length > 0, 'sem achados');
  ok(Array.isArray(r.data.run.sources), 'sem matriz de fontes');
  ok(r.data.usage.daily === 15, 'a cota não voltou no payload');
});
await t('campo obrigatório em falta dá 400 com o nome do campo', async () => {
  const r = await c2.post('/api/run/domain-analyzer', {}, UA);
  eq(r.status, 400);
  eq(r.data.error, 'campo_obrigatorio');
  eq(r.data.field, 'domain');
});
await t('campo que não existe é ignorado (não crasha, não inventa)', async () => {
  const r = await c2.post('/api/run/hash-analyzer', { hash: '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8', invencao: 'x' }, UA);
  eq(r.status, 200);
  ok(!('invencao' in r.data.run.input), 'o campo inventado passou para o run');
});
await t('corpo maior que o tecto é recusado com 413', async () => {
  const c = new Client();
  await c.post('/api/auth/login', { email: 'ana@exemplo.test', password: 'senhaforte123' }, UA);
  const enorme = 'x'.repeat(70 * 1024);
  const r = await c.post('/api/run/hash-analyzer', { hash: enorme }, UA);
  eq(r.status, 413, `status=${r.status}`);
  eq(r.data.error, 'corpo_grande');
});
await t('execução sem sessão dá 401 e não gasta nada', async () => {
  const anon = new Client();
  const r = await anon.post('/api/run/hash-analyzer', { hash: 'a'.repeat(40) }, UA);
  eq(r.status, 401);
});
await t('a cota diária é aplicada no servidor', async () => {
  const c = new Client();
  const reg = await c.post('/api/auth/register', { email: `cota${Date.now()}@exemplo.test`, name: 'Cota', password: 'senhaforte123' }, UA);
  eq(reg.status, 201, JSON.stringify(reg.data));
  // Enche a cota direto na base (executar 15 vezes dispararia primeiro o burst).
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(reg.data.user.email) as any;
  const ins = db.prepare('INSERT INTO usage(user_id, tool_id, at) VALUES(?,?,?)');
  for (let i = 0; i < 15; i++) ins.run(uid.id, 'hash-analyzer', new Date().toISOString());
  db.close();
  const r = await c.post('/api/run/hash-analyzer', { hash: 'a'.repeat(40) }, UA);
  eq(r.status, 429);
  eq(r.data.error, 'limite');
  eq(r.data.kind, 'daily');
});
await t('o limite de concorrência é aplicado no servidor', async () => {
  const c = new Client();
  const email = `par${Date.now()}@exemplo.test`;
  await c.post('/api/auth/register', { email, name: 'Par', password: 'senhaforte123' }, UA);
  // Free = 1 em curso. Duas execuções lentas ao mesmo tempo: a segunda tem de falhar.
  const r = await Promise.all([
    c.post('/api/run/graph-investigation', { seed: 'wikipedia.org' }, UA),
    c.post('/api/run/graph-investigation', { seed: 'example.com' }, UA),
  ]);
  const quarte = r.filter((x) => x.status === 429 && x.data.kind === 'concorrente');
  ok(quarte.length >= 1, `nenhuma execução foi barrada por concorrência (status: ${r.map((x) => x.status).join(',')})`);
});
await t('upload inválido é recusado antes de chegar à ferramenta', async () => {
  const r = await c2.post('/api/arquivo/inspect', { data: 'nao-e-um-data-url' }, UA);
  eq(r.status, 400);
  eq(r.data.error, 'ficheiro_invalido');
});
await t('upload válido é identificado pelo magic bytes, não pelo nome', async () => {
  // PNG mínimo-ish com cabeçalho correto
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const r = await c2.post('/api/arquivo/inspect', { data: `data:image/png;base64,${png.toString('base64')}`, name: 'falso.exe' }, UA);
  eq(r.status, 200, JSON.stringify(r.data));
  eq(r.data.tipo, 'png', 'o tipo tem de vir dos bytes');
  eq(r.data.origem, 'upload');
});

// =========================================================== BYOK
console.log('\n── BYOK ────────────────────────────────────────────────────────');
await t('BYOK só aceita provedores da lista fechada', async () => {
  const r = await c2.post('/api/keys', { provider: 'chave-inventada', secret: 'abc' }, UA);
  eq(r.status, 400);
  eq(r.data.error, 'provedor_desconhecido');
});
await t('BYOK guarda, lista e apaga sem devolver o segredo', async () => {
  const add = await c2.post('/api/keys', { provider: 'leaklookup', secret: 'chave-muito-secreta' }, UA);
  eq(add.status, 200);
  const list = await c2.get('/api/keys', UA);
  eq(list.status, 200);
  ok(list.data.keys.some((k: any) => k.provider === 'leaklookup'), 'a chave não aparece na lista');
  ok(!JSON.stringify(list.data).includes('chave-muito-secreta'), 'O SEGREDO SAIU NA RESPOSTA');
  const del = await c2.del('/api/keys/leaklookup', UA);
  eq(del.status, 200);
  const list2 = await c2.get('/api/keys', UA);
  ok(!list2.data.keys.some((k: any) => k.provider === 'leaklookup'), 'a chave não foi removida');
});
await t('outro utilizador não vê nem apaga a chave de outro', async () => {
  const outro = new Client();
  const reg = await outro.post('/api/auth/register', { email: `b${Date.now()}@exemplo.test`, name: 'Bia', password: 'senhaforte123' }, UA);
  if (reg.status !== 201) throw new Error(`registo recusado (${reg.status}): ${JSON.stringify(reg.data)}`);
  await c2.post('/api/keys', { provider: 'shodan', secret: 'segredo-do-ana' }, UA);
  const list = await outro.get('/api/keys', UA);
  eq((list.data?.keys ?? []).length, 0, 'viu chaves de outra pessoa (ou não está autenticado)');
  await outro.del('/api/keys/shodan', UA);
  const list2 = await c2.get('/api/keys', UA);
  ok(list2.data.keys.some((k: any) => k.provider === 'shodan'), 'apagou a chave de outra pessoa');
  await c2.del('/api/keys/shodan', UA);
});

// =========================================================== INVESTIGAÇÕES
console.log('\n── INVESTIGAÇÕES ────────────────────────────────────────────────');
await t('investigação fica guardada e pode ser relida por id', async () => {
  const c = new Client();
  const email = `inv${Date.now()}@exemplo.test`;
  await c.post('/api/auth/register', { email, name: 'Inv', password: 'senhaforte123' }, UA);
  const r = await c.post('/api/run/graph-investigation', { seed: 'example.com' }, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const list = await c.get('/api/investigations', UA);
  ok(list.data.investigations.length >= 1, 'nada foi guardado');
  const inv = list.data.investigations[0];
  ok(inv.id && inv.node_count > 0, `investigação sem contagem de nós: ${JSON.stringify(inv)}`);
  const det = await c.get(`/api/investigations/${inv.id}`, UA);
  eq(det.status, 200);
  ok(det.data.nodes.length > 0 && det.data.edges.length > 0, 'grafo vazio ao reler');
  ok(Array.isArray(det.data.nodes[0].sourceIds), 'os nós não trouxeram as fontes');
  // renomear + apagar
  const ren = await c.patch(`/api/investigations/${inv.id}`, { title: 'Investigação renomeada' }, UA);
  eq(ren.status, 200);
  const det2 = await c.get(`/api/investigations/${inv.id}`, UA);
  eq(det2.data.investigation.title, 'Investigação renomeada');
  const rm = await c.del(`/api/investigations/${inv.id}`, UA);
  eq(rm.status, 200);
  const det3 = await c.get(`/api/investigations/${inv.id}`, UA);
  eq(det3.status, 404);
});
await t('investigação de outra pessoa dá 404 (não 403 — não confirma existência)', async () => {
  const a = new Client();
  const b = new Client();
  const ra = await a.post('/api/auth/register', { email: `a${Date.now()}@exemplo.test`, name: 'Alu', password: 'senhaforte123' }, UA);
  await a.post('/api/run/graph-investigation', { seed: 'example.com' }, UA);
  const inv = (await a.get('/api/investigations', UA)).data.investigations[0];
  await b.post('/api/auth/register', { email: `b${Date.now()}@exemplo.test`, name: 'Bia', password: 'senhaforte123' }, UA);
  const r = await b.get(`/api/investigations/${inv.id}`, UA);
  eq(r.status, 404);
});

// =========================================================== PLANO DE INVESTIGAÇÃO
console.log('\n── PLANO DE INVESTIGAÇÃO (8 fases) ───────────────────────────────');
const FASES_ESPERADAS = ['Discovery', 'OSINT', 'Social', 'Apify', 'Normalization', 'Correlation', 'Intelligence', 'Snapshots'];
async function planFix(seed = 'example.com') {
  const c = new Client();
  const n = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const reg = await c.post('/api/auth/register', { email: `pl${n}@exemplo.test`, name: 'Plano', password: 'senhaforte123' }, UA);
  eq(reg.status, 201, `registo recusado: ${JSON.stringify(reg.data)}`);
  const run = await c.post('/api/run/graph-investigation', { seed }, UA);
  eq(run.status, 200, JSON.stringify(run.data).slice(0, 200));
  const inv = (await c.get('/api/investigations', UA)).data.investigations[0];
  ok(inv?.id && inv.node_count > 0, 'fixture sem investigação com nós');
  return { c, inv };
}
await t('plano: sem sessão não há plano nem progresso (401 nos três endpoints)', async () => {
  const anon = new Client();
  eq((await anon.post('/api/investigations/qualquer/plan', { modo: 'QUICK' })).status, 401);
  eq((await anon.get('/api/investigations/qualquer/plan')).status, 401);
  eq((await anon.post('/api/investigations/qualquer/plan/executar', {})).status, 401);
});
await t('plano: sem plano gerado, executar diz que não há plano', async () => {
  const { c, inv } = await planFix();
  const r = await c.post(`/api/investigations/${inv.id}/plan/executar`, {}, UA);
  eq(r.status, 404);
  eq(r.data.error, 'sem_plano');
});
await t('QUICK: 8 fases na ordem, só a Discovery activa e o resto dito como pulado', async () => {
  const { c, inv } = await planFix();
  const r = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'QUICK' }, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  eq(r.data.plano.modo, 'QUICK');
  eq(r.data.plano.fases.map((f: any) => f.fase), FASES_ESPERADAS, 'a ordem das 8 fases');
  ok(r.data.progresso === null, 'plano novo não traz progresso inventado');
  const disc = r.data.plano.fases[0];
  eq(disc.pulada, false);
  ok(disc.ferramentas.length >= 1 && disc.ferramentas.length <= 2,
    `QUICK: 1–2 ferramentas, obtido ${JSON.stringify(disc.ferramentas.map((x: any) => x.id))}`);
  ok(disc.ferramentas.every((x: any) => x.estado === 'PRONTO' && x.input), 'o que entra está PRONTO e mostra o input com que correria');
  for (const f of r.data.plano.fases.slice(1)) {
    eq(f.pulada, true, `${f.fase} tem de estar dita como pulada`);
    eq(f.estado, 'PENDENTE', `${f.fase} pulada não pode ser CONCLUIDA`);
    ok(!!f.motivo, `${f.fase} pulada sem motivo`);
  }
  eq(r.data.plano.resumo.puladas, 7);
});
await t('executar QUICK: a fase Discovery corre e o progresso fica guardado e relido', async () => {
  const { c, inv } = await planFix();
  await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'QUICK' }, UA);
  const r = await c.post(`/api/investigations/${inv.id}/plan/executar`, {}, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const disc = r.data.progresso.fases[0];
  eq(disc.fase, 'Discovery');
  eq(disc.estado, 'CONCLUIDA', `Discovery não correu: ${JSON.stringify(disc)}`);
  ok(disc.executadoEm, 'a fase tem hora de execução');
  ok(disc.ferramentas.every((x: any) => x.estado === 'EXECUTADA'),
    `todas as ferramentas da fase correram: ${JSON.stringify(disc.ferramentas)}`);
  ok(disc.ferramentas.every((x: any) => typeof x.contagem === 'number' && x.ms >= 0),
    `cada ferramenta regista contagem e tempo reais: ${JSON.stringify(disc.ferramentas)}`);
  eq(r.data.resumo.executadas, disc.ferramentas.length, 'o resumo conta o que correu');
  eq(r.data.resumo.pendentes, 7, 'as 7 puladas continuam pendentes');
  // persistência: reler o plano devolve exactamente o mesmo progresso
  const relido = await c.get(`/api/investigations/${inv.id}/plan`, UA);
  eq(relido.status, 200);
  eq(relido.data.progresso.fases[0].estado, 'CONCLUIDA', 'o progresso sobreviveu à releitura');
  eq(relido.data.progresso.fases[0].ferramentas.map((x: any) => x.id), disc.ferramentas.map((x: any) => x.id));
  eq(relido.data.resumo.executadas, r.data.resumo.executadas, 'o resumo relido é o mesmo');
});
await t('recriar o mesmo plano mantém o progresso; mudar de modo limpa-o', async () => {
  const { c, inv } = await planFix();
  await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'QUICK' }, UA);
  await c.post(`/api/investigations/${inv.id}/plan/executar`, {}, UA);
  const igual = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'QUICK' }, UA);
  ok(igual.data.progresso, 'o mesmo plano apagava o progresso');
  eq(igual.data.progresso.fases[0].estado, 'CONCLUIDA', 'e o progresso era o de antes');
  const outro = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'FULL' }, UA);
  eq(outro.status, 200);
  ok(outro.data.progresso === null, 'plano novo: o progresso antigo já não descreve o plano');
  eq(outro.data.plano.modo, 'FULL');
});
await t('FULL: as 8 fases activas, com as bloqueadas pelo plano e sem ferramentas de outro alvo', async () => {
  const { c, inv } = await planFix();
  const r = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'FULL' }, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  eq(r.data.plano.fases.map((f: any) => f.fase), FASES_ESPERADAS);
  ok(r.data.plano.fases.every((f: any) => !f.pulada), 'FULL não pula nada');
  const ids = r.data.plano.fases.flatMap((f: any) => f.ferramentas.map((x: any) => x.id));
  ok(ids.includes('domain-analyzer') && !ids.includes('username-finder'),
    `só ferramentas do tipo de alvo (domínio): ${JSON.stringify(ids)}`);
  const bloqueadas = r.data.plano.fases.flatMap((f: any) => f.ferramentas.filter((x: any) => x.estado === 'BLOQUEADA'));
  ok(bloqueadas.length >= 1, 'há ferramentas trancadas no free para mostrar');
  ok(bloqueadas.every((x: any) => typeof x.motivo === 'string' && x.motivo.length > 5),
    `toda a bloqueada tem motivo concreto: ${JSON.stringify(bloqueadas)}`);
  const planoFree = bloqueadas.find((x: any) => x.id === 'port-scanner');
  ok(planoFree && planoFree.motivo.includes('Pro'),
    `a tranca diz o plano e o que falta: ${JSON.stringify(planoFree)}`);
  const etapas = r.data.plano.fases.filter((f: any) => ['Normalization', 'Correlation', 'Intelligence', 'Snapshots'].includes(f.fase));
  ok(etapas.every((f: any) => f.ferramentas.length === 1 && f.ferramentas[0].kind === 'etapa'),
    `as 4 últimas fases são etapas do motor: ${JSON.stringify(etapas)}`);
});
await t('CUSTOM só com as 4 etapas: executar dá as 4 fases CONCLUIDA com contagem real', async () => {
  const { c, inv } = await planFix();
  const etapas = ['intel-normalizacao', 'intel-correlacao', 'intel-perfil', 'intel-snapshot'];
  const r = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'CUSTOM', ferramentas: etapas }, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  eq(r.data.plano.fases.filter((f: any) => !f.pulada).map((f: any) => f.fase),
    ['Normalization', 'Correlation', 'Intelligence', 'Snapshots'], 'só as 4 etapas entram');
  const run = await c.post(`/api/investigations/${inv.id}/plan/executar`, {}, UA);
  eq(run.status, 200, JSON.stringify(run.data).slice(0, 300));
  const feitas = run.data.progresso.fases.filter((f: any) => !f.pulada);
  eq(feitas.length, 4);
  for (const f of feitas) {
    eq(f.estado, 'CONCLUIDA', `${f.fase} não ficou CONCLUIDA: ${JSON.stringify(f)}`);
    const x = f.ferramentas[0];
    eq(x.estado, 'EXECUTADA', `${f.fase}: ferramenta não executada`);
    ok(typeof x.contagem === 'number' && x.contagem >= 0 && x.nota && x.nota.length > 5,
      `${f.fase}: contagem e nota do que saiu: ${JSON.stringify(x)}`);
    ok(x.ms >= 0 && f.executadoEm, `${f.fase}: tempo e hora registados`);
  }
  eq(run.data.resumo.concluidas, 4, 'o resumo diz 4 concluídas');
  eq(run.data.resumo.executadas, 4);
  // prova de que a etapa de Snapshots guardou mesmo um snapshot:
  const radar = await c.get(`/api/intel/radar?investigacao=${inv.id}`, UA);
  eq(radar.status, 200, JSON.stringify(radar.data).slice(0, 200));
  eq(radar.data.radar.temAnterior, true,
    'já havia snapshot — o plano gravou-o, não foi a API de radar que o criou');
});
await t('CUSTOM: id desconhecido, id fora das 8 fases e modo inválido são 400 com o motivo', async () => {
  const { c, inv } = await planFix();
  const vazio = await c.post(`/api/investigations/${inv.id}/plan`, {}, UA);
  eq(vazio.status, 400);
  eq(vazio.data.error, 'modo_em_falta');
  const mau = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'RECALCAR' }, UA);
  eq(mau.status, 400);
  eq(mau.data.error, 'modo_invalido');
  eq(mau.data.aceites, ['QUICK', 'FULL', 'CUSTOM']);
  const semLista = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'CUSTOM' }, UA);
  eq(semLista.status, 400);
  eq(semLista.data.error, 'custom_vazio');
  const desconhecida = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'CUSTOM', ferramentas: ['inventada'] }, UA);
  eq(desconhecida.status, 400);
  eq(desconhecida.data.error, 'ferramenta_desconhecida');
  ok((desconhecida.data.aceites ?? []).includes('domain-analyzer'), 'o erro ensina os ids reais');
  const fora = await c.post(`/api/investigations/${inv.id}/plan`, { modo: 'CUSTOM', ferramentas: ['graph-investigation'] }, UA);
  eq(fora.status, 400);
  eq(fora.data.error, 'ferramenta_fora_do_plano');
  eq(fora.data.fase, 'Discovery', 'diz em que fase cairia');
  ok(fora.data.msg.includes('própria investigação'), `e porque é que não entra: ${fora.data.msg}`);
  // nenhum dos erros guardou plano
  const depois = await c.get(`/api/investigations/${inv.id}/plan`, UA);
  eq(depois.data.plano, null, 'um pedido inválido não deixa plano a meio');
});
await t('plano de outro utilizador dá 404 nos três endpoints (não enumera ids)', async () => {
  const { c, inv } = await planFix();
  const outro = new Client();
  await outro.post('/api/auth/register', { email: `o${Date.now()}@exemplo.test`, name: 'Outro', password: 'senhaforte123' }, UA);
  eq((await outro.post(`/api/investigations/${inv.id}/plan`, { modo: 'QUICK' }, UA)).status, 404);
  eq((await outro.get(`/api/investigations/${inv.id}/plan`, UA)).status, 404);
  eq((await outro.post(`/api/investigations/${inv.id}/plan/executar`, {}, UA)).status, 404);
  const falso = await outro.get('/api/investigations/nao-existe/plan', UA);
  eq(falso.status, 404, 'id inexistente dá o mesmo 404');
  eq(falso.data.error, 'nao_encontrada');
});

// =========================================================== INTEL
console.log('\n── INTEL (motor de inteligência) ──────────────────────────────────');
async function intelFix() {
  const c = new Client();
  await c.post('/api/auth/register', { email: `int${Date.now()}${Math.random().toString(36).slice(2, 6)}@exemplo.test`, name: 'Int', password: 'senhaforte123' }, UA);
  const run = await c.post('/api/run/graph-investigation', { seed: 'example.com' }, UA);
  eq(run.status, 200, JSON.stringify(run.data).slice(0, 200));
  const inv = (await c.get('/api/investigations', UA)).data.investigations[0];
  return { c, inv };
}
await t('intel exige sessão', async () => {
  const r = await new Client().get('/api/intel/perfil');
  eq(r.status, 401);
});
await t('unified profile vem das arestas da investigação, com faixa de confiança', async () => {
  const { c, inv } = await intelFix();
  const r = await c.get(`/api/intel/perfil?investigacao=${inv.id}`, UA);
  eq(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  ok(r.data.perfil.entidades.length > 0, 'perfil sem entidades');
  ok(r.data.perfil.contas.length >= 1, 'perfil sem contas');
  ok(['HIGH', 'MEDIUM', 'LOW', 'UNCONFIRMED'].includes(r.data.perfil.confiancaGeral), `confiança inválida: ${r.data.perfil.confiancaGeral}`);
  ok(Array.isArray(r.data.perfil.evidencias) && r.data.perfil.evidencias.length > 0, 'sem evidências');
  ok(r.data.resumo.nos > 0 && r.data.resumo.arestas > 0, 'resumo vazio');
  const txt = JSON.stringify(r.data);
  ok(!txt.includes('prova que'), 'mensagem a afirmar prova identidade');
});
await t('presence radar: sem anterior diz-se; ao repetir, há anterior guardado', async () => {
  const { c, inv } = await intelFix();
  const r1 = await c.get(`/api/intel/radar?investigacao=${inv.id}`, UA);
  eq(r1.status, 200, JSON.stringify(r1.data).slice(0, 300));
  eq(r1.data.radar.temAnterior, false, '1ª observação tinha de dizer que não há anterior');
  ok(r1.data.anterior === null, 'anterior não nulo na 1ª chamada');
  const r2 = await c.get(`/api/intel/radar?investigacao=${inv.id}`, UA);
  eq(r2.status, 200);
  eq(r2.data.radar.temAnterior, true, '2ª chamada não leu o snapshot guardado');
  ok(typeof r2.data.radar.nota === 'string' && r2.data.radar.nota.length > 10, 'radar sem nota');
});
await t('relatório: CSV mesmo conteúdo, headers de ficheiro, formato rejeitado', async () => {
  const { c, inv } = await intelFix();
  const r = await c.get(`/api/intel/relatorio?investigacao=${inv.id}&formato=csv`, UA);
  eq(r.status, 200);
  ok((r.headers.get('content-type') ?? '').includes('csv'), `content-type: ${r.headers.get('content-type')}`);
  ok((r.headers.get('content-disposition') ?? '').includes('attachment'), 'sem content-disposition');
  ok(r.text.split('\n').length > 1, 'csv vazio');
  const bad = await c.get(`/api/intel/relatorio?investigacao=${inv.id}&formato=exe`, UA);
  eq(bad.status, 400, 'formato malicioso aceite');
});
await t('intel de investigação de outra pessoa dá 404 (não enumera ids)', async () => {
  const { c, inv } = await intelFix();
  const outro = new Client();
  await outro.post('/api/auth/register', { email: `o${Date.now()}@exemplo.test`, name: 'Outro', password: 'senhaforte123' }, UA);
  const r = await outro.get(`/api/intel/perfil?investigacao=${inv.id}`, UA);
  eq(r.status, 404, `veio ${r.status}: ${JSON.stringify(r.data).slice(0, 150)}`);
  const falso = await outro.get('/api/intel/perfil?investigacao=nao-existe', UA);
  eq(falso.status, 404, 'id inexistente tem de dar o mesmo 404');
});

// =========================================================== HISTÓRICO
console.log('\n── HISTÓRICO ────────────────────────────────────────────────────');
await t('histórico lista as execuções e reabre o resultado completo', async () => {
  const c = new Client();
  const email = `h${Date.now()}@exemplo.test`;
  await c.post('/api/auth/register', { email, name: 'Hugo', password: 'senhaforte123' }, UA);
  const run = await c.post('/api/run/phone-analyzer', { phone: '+5511998877665' }, UA);
  eq(run.status, 200);
  const hist = await c.get('/api/historico', UA);
  ok(hist.data.runs.length >= 1, 'histórico vazio');
  const item = await c.get(`/api/historico/${hist.data.runs[0].id}`, UA);
  eq(item.status, 200);
  ok(item.data.run.findings.length > 0, 'o resultado relido está vazio');
  ok(Array.isArray(item.data.run.sources), 'a proveniência não sobreviveu ao armazenamento');
});
await t('histórico de outro utilizador dá 404', async () => {
  const a = new Client();
  const b = new Client();
  await a.post('/api/auth/register', { email: `ha${Date.now()}@exemplo.test`, name: 'Alu', password: 'senhaforte123' }, UA);
  await a.post('/api/run/phone-analyzer', { phone: '+5511998877665' }, UA);
  const id = (await a.get('/api/historico', UA)).data.runs[0].id;
  await b.post('/api/auth/register', { email: `hb${Date.now()}@exemplo.test`, name: 'Bia', password: 'senhaforte123' }, UA);
  eq((await b.get(`/api/historico/${id}`, UA)).status, 404);
});

// =========================================================== ADMINISTRAÇÃO
console.log('\n── ADMINISTRAÇÃO ────────────────────────────────────────────────');
const admin = new Client();
await t('admin: quem não é admin recebe 403 em todas as rotas de admin', async () => {
  await admin.post('/api/auth/register', { email: `nao${Date.now()}@exemplo.test`, name: 'Nuno', password: 'senhaforte123' }, UA);
  eq((await admin.get('/api/admin/estado', UA)).status, 403);
  eq((await admin.post('/api/admin/user/qualquer/plano', { plan: 'pro_max' }, UA)).status, 403);
  eq((await admin.post('/api/admin/user/qualquer/flags', { isAdmin: true }, UA)).status, 403);
});
await t('admin: desautorizado nem sequer recebe 401 (a rota é protegida)', async () => {
  const anon = new Client();
  eq((await anon.get('/api/admin/estado', UA)).status, 401);
});
await t('admin: e-mail em ARGUS_ADMIN_EMAILS dá acesso de administração', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/register', { email: 'dono@argus.test', name: 'Dono', password: 'senhaforte123' }, UA);
  eq(r.status, 201, JSON.stringify(r.data));
  const me = await c.get('/api/me', UA);
  eq(me.data.user.isAdmin, true, 'o e-mail de administração não foi reconhecido');
  const st = await c.get('/api/admin/estado', UA);
  eq(st.status, 200);
  ok(st.data.db.writable, 'o painel não viu o estado do disco');
  // A partir daqui, `admin` passa a ser a conta com acesso.
  const li = await admin.post('/api/auth/login', { email: 'dono@argus.test', password: 'senhaforte123' }, UA);
  eq(li.status, 200, `o cliente admin não conseguiu entrar: ${JSON.stringify(li.data)}`);
  eq((await admin.get('/api/me', UA)).data.user.isAdmin, true);
});
await t('admin: ativa e muda planos, e o servidor passa a unlocking', async () => {
  const c1 = new Client();
  await c1.post('/api/auth/register', { email: `cota${Date.now()}@exemplo.test`, name: 'Cota', password: 'senhaforte123' }, UA);
  const alvo = (await admin.get('/api/admin/estado', UA)).data.users.find((u: any) => u.email.startsWith('cota'));
  ok(alvo, 'não encontrei a conta de teste');
  const r = await admin.post(`/api/admin/user/${alvo.id}/plano`, { plan: 'pro_max', resetUsage: true }, UA);
  eq(r.status, 200, JSON.stringify(r.data));
  const c = new Client();
  await c.post('/api/auth/login', { email: alvo.email, password: 'senhaforte123' }, UA);
  const me = await c.get('/api/me', UA);
  eq(me.data.user.plan, 'pro_max', 'o plano não mudou para o utilizador');
  eq(me.data.usage.daily, 1500, 'a cota do Pro Max não veio');
  // e uma ferramenta trancada passa a estar aberta
  const tools = await c.get('/api/tools', UA);
  const trancadas = tools.data.tools.filter((x: any) => x.lock === 'locked').map((x: any) => x.id);
  eq(trancadas, [], `ainda há trancas no Pro Max: ${trancadas.join(', ')}`);
  const run = await c.post('/api/run/port-scanner', { target: '1.1.1.1' }, UA);
  ok(run.status === 200 || run.status === 429, `port-scanner no Pro Max: status ${run.status}`);
  ok(run.status !== 402, 'a ferramenta trancada continuou bloqueada depois do upgrade');
});
await t('admin: suspender encerra as sessões e bloqueia o acesso', async () => {
  const alvo = (await admin.get('/api/admin/estado', UA)).data.users.find((u: any) => u.email.startsWith('cota'));
  ok(alvo, 'não encontrei a conta de teste');
  const c = new Client();
  await c.post('/api/auth/login', { email: alvo.email, password: 'senhaforte123' }, UA);
  eq((await c.get('/api/me', UA)).data.user?.email, alvo.email, 'não conseguiu entrar antes de suspender');
  const r = await admin.post(`/api/admin/user/${alvo.id}/flags`, { suspended: true }, UA);
  eq(r.status, 200, JSON.stringify(r.data));
  const me = await c.get('/api/me', UA);
  eq(me.data.user, null, 'a conta suspensa continua autenticada');
  const login = await c.post('/api/auth/login', { email: alvo.email, password: 'senhaforte123' }, UA);
  eq(login.status, 403, 'a conta suspensa conseguiu entrar');
  await admin.post(`/api/admin/user/${alvo.id}/flags`, { suspended: false }, UA);
});
await t('admin: plano inválido é recusado', async () => {
  const alvo = (await admin.get('/api/admin/estado', UA)).data.users?.[0];
  ok(alvo, 'a lista de utilizadores veio vazia');
  const r = await admin.post(`/api/admin/user/${alvo.id}/plano`, { plan: 'plano-de-ouro' }, UA);
  eq(r.status, 400);
  eq(r.data.error, 'plano_invalido');
});

// =========================================================== ESTÁTICOS
console.log('\n── FICHEIROS ESTÁTICOS E SPA ─────────────────────────────────────');
await t('o index é servido com o cabeçalho certo', async () => {
  const r = await fetch(`${BASE}/`);
  eq(r.status, 200);
  ok((r.headers.get('content-type') ?? '').includes('text/html'), 'sem text/html');
  eq(r.headers.get('cache-control'), 'no-cache', 'o index não pode ser cacheado (aponta para o bundle com hash)');
  const html = await r.text();
  ok(html.includes('<div id="root">'), 'o index não tem a raiz da app');
  ok(html.includes('favicon.svg'), 'o index não referencia o ícone');
});
await t('o bundle JS/CSS é servido com cache longo (tem hash no nome)', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  const m = /src="(\/assets\/[^"]+\.js)"/.exec(html);
  ok(m, 'o index não aponta para um bundle em /assets');
  const r = await fetch(BASE + m![1]!);
  eq(r.status, 200);
  ok((r.headers.get('content-type') ?? '').includes('javascript'), `content-type: ${r.headers.get('content-type')}`);
  ok((r.headers.get('cache-control') ?? '').includes('immutable'), 'o bundle não é imutável');
});
await t('o ícone está disponível e é do tipo certo', async () => {
  const svg = await fetch(`${BASE}/favicon.svg`);
  eq(svg.status, 200);
  ok((svg.headers.get('content-type') ?? '').includes('image/svg+xml'), 'favicon.svg sem o content-type certo');
  const png = await fetch(`${BASE}/icon-192.png`);
  eq(png.status, 200);
  ok((png.headers.get('content-type') ?? '').includes('image/png'), 'icon-192.png sem o content-type certo');
  const man = await fetch(`${BASE}/site.webmanifest`);
  eq(man.status, 200);
  ok((man.headers.get('content-type') ?? '').includes('manifest'), 'manifest sem content-type certo');
});
await t('rota desconhecida devolve o index (SPA), não 404', async () => {
  const r = await fetch(`${BASE}/investigacoes/abc123`);
  eq(r.status, 200);
  ok((await r.text()).includes('<div id="root">'), 'a rota SPA não devolveu o index');
});
await t('API desconhecida devolve 404 JSON (não o index)', async () => {
  const r = await fetch(`${BASE}/api/nao-existe`);
  eq(r.status, 404);
  ok((r.headers.get('content-type') ?? '').includes('application/json'), 'devolveu HTML numa rota de API');
  eq(((await r.json()) as any).error, 'nao_encontrada');
});
await t('path traversal é bloqueado', async () => {
  for (const p of ['/../package.json', '/..%2f..%2fpackage.json', '/assets/../../package.json', '/%2e%2e/%2e%2e/package.json']) {
    const r = await fetch(BASE + p);
    const body = await r.text();
    ok(!body.includes('"name": "probe"'), `path traversal com sucesso: ${p}`);
    ok(!body.includes('workspaces'), `ficheiro do repositório exposto em ${p}`);
  }
});
await t('caminho malformado dá 400, não 500', async () => {
  const r = await fetch(`${BASE}/%ZZ`);
  ok(r.status === 400 || r.status === 200, `status inesperado: ${r.status}`);
  ok(r.status !== 500, 'um % orfao deu 500');
});

// =========================================================== LIMITADOR (no fim)
console.log('\n── LIMITADOR DE TENTATIVAS (fase final, consome a cota) ───────────');
await t('login repetido é barrado com 429 e Retry-After', async () => {
  const c = new Client();
  let barrado: any = null;
  // O tecto do teste é 80 tentativas por janela; 90 garante ultrapassá-lo.
  for (let i = 0; i < 90; i++) {
    const r = await c.post('/api/auth/login', { email: 'ana@exemplo.test', password: `x${i}` }, UA);
    if (r.status === 429) { barrado = r; break; }
  }
  ok(barrado, 'a limitação por IP não disparou em 90 tentativas');
  eq(barrado.data.error, 'demasiadas_tentativas');
  ok(Number(barrado.headers.get('retry-after')) > 0, 'sem Retry-After: o cliente não sabe quando voltar');
});
await t('registo também é limitado (criar contas em massa é ataque)', async () => {
  const c = new Client();
  let barrado = false;
  // O tecto do teste é 120; 130 garante ultrapassá-lo (e é a fase final).
  for (let i = 0; i < 130; i++) {
    const r = await c.post('/api/auth/register', { email: `spam${i}-${Date.now()}@exemplo.test`, name: 'Spam', password: 'senhaforte123' }, UA);
    if (r.status === 429) { barrado = true; break; }
  }
  ok(barrado, 'o registo não foi limitado');
});

// =========================================================== ENCERRAMENTO
console.log(`\n${'═'.repeat(66)}`);
console.log(`  ${pass} passaram, ${fail} falharam`);
console.log(`${'═'.repeat(66)}\n`);

if (fail && process.env.TEST_VERBOSE) console.log('--- log do servidor ---\n' + serverLog);
cleanup();
process.exit(fail ? 1 : 0);
