/**
 * Smoke test de PRODUÇÃO.
 *
 * Diferença para `api.test.ts`: aqui não se testa comportamento, testa-se o que
 * impede o serviço de subir. Simula o arranque no Render — `NODE_ENV=production`,
 * disco persistente num caminho absoluto, `HOST=0.0.0.0`, cookie `Secure` com
 * prefixo `__Host-` — e confirma que o ARGUS **recusa arrancar** quando a
 * configuração de produção está errada, e que arranca bem quando está certa.
 *
 *   node test/smoke-prod.ts
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..');
const ROOT = resolve(SERVER, '..', '..');
const WEB_DIST = join(ROOT, 'apps', 'web', 'dist');

// ---------------------------------------------------------------- cliente
class Client {
  private cookies = new Map<string, string>();
  private base: string;
  // Campos explícitos (e não "parameter properties"): o arranque usa o
  // strip-types nativo do Node, que não remove essa sintaxe.
  constructor(base: string) { this.base = base; }
  private ck(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method: string, path: string, body?: unknown) {
    const h: Record<string, string> = { origin: this.base };
    const c = this.ck(); if (c) h.cookie = c;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of (r.headers.getSetCookie?.() ?? [])) {
      const [pair] = sc.split(';');
      const i = pair!.indexOf('=');
      if (i > 0) {
        const k = pair!.slice(0, i).trim(); const v = pair!.slice(i + 1).trim();
        if (v === '' || /Max-Age=0/i.test(sc)) this.cookies.delete(k); else this.cookies.set(k, v);
      }
    }
    const txt = await r.text();
    let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    return { status: r.status, body: data };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b?: unknown) { return this.req('POST', p, b); }
}

let pass = 0, fail = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); pass++; console.log(`\x1b[32m✓\x1b[0m ${name}`); }
  catch (e: any) { fail++; console.log(`\x1b[31m✗\x1b[0m ${name} — ${e.message}`); }
};
const eq = (a: any, b: any, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };
const ok = (c: any, m = '') => { if (!c) throw new Error(m || 'condição falsa'); };

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║  SMOKE TEST DE PRODUÇÃO — ARGUS                                    ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

interface Run { code: number | null; out: string; ms: number }

/** Arranca o servidor e recolhe o resultado. `waitMs` = quanto tempo esperar por
 *  um arranque bem-sucedido; se não arrancar, espera que o processo morra. */
let spawnN = 0;
async function runServer(env: Record<string, string>, waitMs = 12_000): Promise<Run> {
  // Cada arranque usa uma porta diferente: dois processos no mesmo puerto
  // rebentam com EADDRINUSE e o teste falha por uma razão que não tem a ver com
  // o que está a ser testado.
  const p = String(PORT + 20 + (spawnN++ % 60));
  const child = spawn(process.execPath, [join(SERVER, 'src', 'index.ts')], {
    env: { ...process.env, NODE_ENV: 'production', PORT: p, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Um 'error' do filho (porta ocupada, binário em falta) não pode derrubar o teste.
  child.on('error', (e) => { out += `\n[spawn] ${e.message}`; });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  const alive = new Promise<'alive'>((r) => setTimeout(() => r('alive'), waitMs));
  const quem = await Promise.race([exited, alive]);
  const ms = Date.now() - t0;
  let code: number | null = quem === 'alive' ? null : (quem as number);
  if (code === null) { child.kill('SIGKILL'); await exited; }
  return { code, out, ms };
}

const dir = mkdtempSync(join(tmpdir(), 'argus-prod-'));
// Porta livre, para não colidir com um teste anterior que ficou pendurado.
const PORT = 8800 + (process.pid % 90);   // porta do servidor principal
const P = String(PORT);
const db = join(dir, 'argus.db');
const secretOk = 'f'.repeat(64);
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

// =========================================================== RECUSA DE ARRANQUE
console.log('── CONFIGURAÇÃO DE PRODUÇÃO: o que tem de ser recusado ────────────');
await t('sem ARGUS_SECRET: não arranca', async () => {
  const r = await runServer({ ARGUS_DB: db, ARGUS_SECRET: '', ARGUS_WEB_DIST: WEB_DIST }, 8000);
  ok(r.code !== 0, `arrancou mesmo assim (code=${r.code})`);
  ok(/ARGUS_SECRET/.test(r.out), `o erro não menciona ARGUS_SECRET:\n${r.out}`);
});
await t('segredo curto demais: não arranca', async () => {
  const r = await runServer({ ARGUS_DB: db, ARGUS_SECRET: 'curto', ARGUS_WEB_DIST: WEB_DIST }, 8000);
  ok(r.code !== 0, 'arrancou com segredo de 5 caracteres');
  ok(/minimo 32/.test(r.out), `mensagem errada:\n${r.out}`);
});
await t('segredo de exemplo: não arranca', async () => {
  const r = await runServer({ ARGUS_DB: db, ARGUS_SECRET: 'probe-dev-secret-change-in-production', ARGUS_WEB_DIST: WEB_DIST }, 8000);
  ok(r.code !== 0, 'arrancou com o segredo de exemplo');
  ok(/exemplo/.test(r.out), `mensagem errada:\n${r.out}`);
});
await t('ARGUS_DB relativo: não arranca (o disco efemérico apaga tudo)', async () => {
  const r = await runServer({ ARGUS_DB: 'data/argus-prod-relativo.db', ARGUS_SECRET: secretOk, ARGUS_WEB_DIST: WEB_DIST }, 8000);
  ok(r.code !== 0, 'arrancou com caminho relativo em produção');
  ok(/absolut/i.test(r.out), `mensagem errada:\n${r.out}`);
});
await t('cookie sem Secure em 0.0.0.0: não arranca', async () => {
  const r = await runServer({ ARGUS_DB: db, ARGUS_SECRET: secretOk, ARGUS_COOKIE_SECURE: 'false', HOST: '0.0.0.0', ARGUS_WEB_DIST: WEB_DIST }, 8000);
  ok(r.code !== 0, 'arrancou com cookie inseguro exposto');
  ok(/SECURE|Secure/.test(r.out), `mensagem errada:\n${r.out}`);
});
await t('CORS com "*": não arranca', async () => {
  const r = await runServer({ ARGUS_DB: db, ARGUS_SECRET: secretOk, ARGUS_ALLOWED_ORIGINS: '*', ARGUS_WEB_DIST: WEB_DIST }, 8000);
  ok(r.code !== 0, 'arrancou com CORS wildcard');
  ok(/wildcard|\\*/.test(r.out), `mensagem errada:\n${r.out}`);
});
await t('sem o build do frontend: não arranca (servir só API é serviço partido)', async () => {
  const r = await runServer({ ARGUS_DB: db, ARGUS_SECRET: secretOk, ARGUS_WEB_DIST: join(dir, 'nao-existe') }, 8000);
  ok(r.code !== 0, 'arrancou sem frontend');
  ok(/frontend|build/i.test(r.out), `mensagem errada:\n${r.out}`);
});

// =========================================================== ARRANQUE CORRETO
console.log('\n── ARRANQUE CORRETO E PERSISTÊNCIA ───────────────────────────────');
const child = spawn(process.execPath, [join(SERVER, 'src', 'index.ts')], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: P,
    HOST: '127.0.0.1',
    ARGUS_DB: db,
    ARGUS_SECRET: secretOk,
    ARGUS_COOKIE_SECURE: 'false',   // aceite só porque o bind é loopback
    ARGUS_TRUST_PROXY: 'true',
    ARGUS_PUBLIC_ORIGIN: 'https://argus.senhoramorim.com.br',
    ARGUS_WEB_DIST: WEB_DIST,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.on('error', () => {});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
const stop = () => { try { child.kill('SIGKILL'); } catch {} };
process.on('exit', stop);

const B = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`${B}/api/health`); if (r.status === 200) break; } catch { /* ainda a subir */ }
  await new Promise((r) => setTimeout(r, 300));
}

await t('arranca com a configuração completa e diz o que está a fazer', async () => {
  ok(/ferramentas registadas/.test(log), `log sem o número de ferramentas:\n${log}`);
  ok(/rate_limit=login/.test(log), 'o log não mostra a configuração de limitação');
  ok(/origens=mesma origem/.test(log), 'o log não mostra a política de CORS');
});
await t('o cookie usa o prefixo __Host- quando Secure está ligado', async () => {
  // Este processo tem Secure desligado (loopback), por isso o nome é o simples.
  // O que se verifica aqui é que o NOME acompanha a decisão.
  ok(/cookie=argus_session secure=false/.test(log), `nome do cookie inesperado:\n${log}`);
  const r2 = await runServer({ ARGUS_DB: join(dir, 'x.db'), ARGUS_SECRET: secretOk, ARGUS_COOKIE_SECURE: 'true', HOST: '0.0.0.0', ARGUS_WEB_DIST: WEB_DIST }, 7000);
  const linha = r2.out.split('\n').find((l) => l.includes('cookie='));
  ok(!!linha, `sem linha de configuração no log:\n${r2.out}`);
  ok(/cookie=__Host-argus_session secure=true/.test(linha!), `com Secure true devia usar __Host-: ${linha}`);
});
await t('o SQLite é criado no caminho absoluto do disco', async () => {
  ok(existsSync(db), 'a base de dados não foi criada no ARGUS_DB');
  ok(statSync(db).size > 0, 'a base de dados ficou vazia');
});
await t('health diz que o disco tem escrita (é o que separa "arrancou" de "serve")', async () => {
  const r = await fetch(`${B}/api/health`);
  eq200(r.status);
  const j = (await r.json()) as any;
  ok(j.db.writable, 'o health check diz que o disco não tem escrita');
  ok(j.db.path === db, `caminho inesperado: ${j.db.path}`);
  ok(j.tools === 8, `catálogo inesperado: ${j.tools} ferramentas`);
  ok(j.env === 'production', `env=${j.env}`);
  function eq200(v: number) { ok(v === 200, `status ${v}`); }
});
await t('HSTS aparece quando o cookie é Secure', async () => {
  // Aqui o cookie não é Secure, logo HSTS não deve ser enviado (é o comportamento certo).
  const r = await fetch(`${B}/api/health`);
  ok(!r.headers.get('strict-transport-security'), 'HSTS foi enviado sem cookie Secure');
});
await t('os dados sobrevivem a um reinicio do processo (o que o Render faz a cada deploy)', async () => {
  // O que se prova e que o FICHEIRO do disco sobrevive, nao que a porta ficou livre.
  const pa = String(PORT + 95);
  const pb = String(PORT + 96);
  const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', ARGUS_DB: db,
    ARGUS_SECRET: secretOk, ARGUS_COOKIE_SECURE: 'false', ARGUS_TRUST_PROXY: 'true', ARGUS_WEB_DIST: WEB_DIST };
  // O log é acumulado num array e copiado no fim: com uma string passada por
  // valor, as escritas dentro do callback perdiam-se.
  const sobe = (port: string, l: string[]) => {
    const p = spawn(process.execPath, [join(SERVER, 'src', 'index.ts')], {
      env: { ...env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    p.on('error', (e) => { l.push('\n[spawn] ' + e.message); });
    p.stdout.on('data', (d) => { l.push(String(d)); });
    p.stderr.on('data', (d) => { l.push(String(d)); });
    return p;
  };
  const espera = async (port: string) => {
    for (let i = 0; i < 70; i++) {
      try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); if (r.status === 200) return true; } catch { /* subindo */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };

  const l1: string[] = [];
  const a1 = sobe(pa, l1);
  ok(await espera(pa), 'o primeiro processo nao arrancou:\n' + l1);

  const c1 = new Client('http://127.0.0.1:' + pa);
  const email = 'persiste' + Date.now() + '@exemplo.test';
  const reg = await c1.post('/api/auth/register', { email, name: 'Persiste', password: 'senhaforte123' });
  ok(reg.status === 201, 'registo falhou: ' + reg.status + ' ' + JSON.stringify(reg.body));
  // O que se quer provar aqui é a PERSISTÊNCIA, não o grafo. Por isso usa-se
  // um alvo cujo plano não tem passos de rede: o grafo guarda-se com o nó
  // semente e o teste deixa de depender de terceiros — deixa de poder falhar
  // por uma API lenta ou caída (passava de 4 minutos para poucos segundos).
  const inv = await c1.post('/api/run/graph-investigation', { seed: '+5511998877665' });
  ok(inv.status === 200, 'investigacao falhou: ' + inv.status);
  const antes = (await c1.get('/api/investigations')).body.investigations.length;
  ok(antes >= 1, 'nada foi guardado antes do reinicio');

  // SIGTERM: e o que o Render manda antes de cada deploy.
  a1.kill('SIGTERM');
  const codigo = await new Promise<number | null>((r) => a1.on('exit', (x) => r(x)));
  ok(codigo === 0, 'o processo saiu com codigo ' + codigo);
  ok(/fechado com checkpoint/.test(l1.join('')), 'sem checkpoint do banco:\n' + l1.join(''));

  const l2: string[] = [];
  const a2 = sobe(pb, l2);
  ok(await espera(pb), 'o processo reiniciado nao arrancou:\n' + l2);
  const c2 = new Client('http://127.0.0.1:' + pb);
  const li = await c2.post('/api/auth/login', { email, password: 'senhaforte123' });
  ok(li.status === 200, 'a conta nao sobreviveu ao reinicio: ' + li.status);
  const depois = (await c2.get('/api/investigations')).body.investigations.length;
  eq(depois, antes, 'a investigacao nao sobreviveu ao reinicio');
  ok(existsSync(db), 'o ficheiro do banco desapareceu');
  a2.kill('SIGKILL');
});

await t('SIGTERM: o servidor encerra e dá checkpoint no banco', async () => {
  // Envia-se SIGTERM a um processo seu e confirma-se o log de encerramento.
  const c2 = spawn(process.execPath, [join(SERVER, 'src', 'index.ts')], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT + 1), HOST: '127.0.0.1',
      ARGUS_DB: db, ARGUS_SECRET: secretOk, ARGUS_COOKIE_SECURE: 'false', ARGUS_WEB_DIST: WEB_DIST },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cl = '';
  c2.on('error', (e) => { cl += `\n[spawn] ${e.message}`; });
  c2.stdout.on('data', (d) => { cl += d; });
  c2.stderr.on('data', (d) => { cl += d; });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); if (r.status === 200) break; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  c2.kill('SIGTERM');
  const code = await new Promise<number | null>((r) => c2.on('exit', (x) => r(x)));
  ok(code === 0, `o processo saiu com código ${code} em vez de 0:\n${cl}`);
  ok(/SIGTERM recebido/.test(cl), 'sem log de encerramento por SIGTERM');
  ok(/fechado com checkpoint/.test(cl), `sem checkpoint do banco:\n${cl}`);
});

await t('SIGTERM: o processo principal encerra com codigo 0', async () => {
  const t0 = Date.now();
  child.kill('SIGTERM');
  const code = await new Promise<number | null>((r) => child.on('exit', (x) => r(x)));
  ok(code === 0, `o servidor principal saiu com codigo ${code}`);
  ok(/fechado com checkpoint/.test(log), `sem checkpoint do banco:\n${log}`);
  ok(Date.now() - t0 < 12_000, `demorou ${Date.now() - t0}ms a fechar`);
});

console.log(`\n${'═'.repeat(66)}`);
console.log(`  ${pass} passaram, ${fail} falharam`);
console.log(`${'═'.repeat(66)}\n`);
if (fail && process.env.TEST_VERBOSE) console.log('--- log ---\n' + log);

stop();
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);

