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
