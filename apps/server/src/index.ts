/**
 * API do ARGUS: autenticação, planos, catálogo, execução, BYOK, investigações,
 * conta e administração.
 *
 * Princípio deste ficheiro: **nada é decidido no cliente**. O plano, a tranca da
 * ferramenta, a cota, a concorrência e o papel de administrador são lidos do
 * banco a cada pedido. O frontend só desenha.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import {
  db, q, newPasswordHash, verifyPass, newToken, tokenHash, encryptSecret, decryptSecret,
  dbHealth, closeDb, prune,
} from './db.ts';
import { allTools, publicTool, executeTool, getTool, dailyCount, inflightCount, lockState, LockedError } from './registry.ts';
import { PLANS, PLAN_LIST, type PlanId, type MinPlan, isPlanId } from './plans.ts';
import { config, configReport, configWarnings } from './config.ts';
import {
  securityHeaders, cors, bodyLimit, clientIp, csrf,
  MAX_BODY_BYTES, MAX_UPLOAD_BYTES, RateLimiter,
  ADMIN_EMAILS, readSessionToken, currentUser, requireAuth, requireAdmin, type Ctx,
} from './security.ts';
import { resolveFile, FileError, MAX_FILE_BYTES, sniff } from './net/upload.ts';
import { saudeSistema } from './health.ts';
import intelRoutes from './intel/routes.ts';
import { criarPlanoRouter } from './investigation/routes.ts';
import { SourceLog, type Finding } from './net/provenance.ts';

// importa ficheiros de ferramentas para registar no registry
import './tools/infra.ts';
import './tools/identity.ts';
import './tools/username-intel.ts';
import './tools/threat.ts';
import './tools/finance-dev-br.ts';
import './tools/tls.ts';
import './tools/graph.ts';
import './tools/social.ts';
import './tools/social-search.ts';
import './tools/osint-engine.ts';
import './tools/apify.ts';

const app = new Hono();
const PORT = config.port;

// ---------- middleware global ----------
app.use('*', securityHeaders());
app.use('*', cors());
app.use('/api/*', bodyLimit());
// Uploads têm tecto próprio (16 MB de base64 ≈ 12 MB de ficheiro).
app.use('/api/arquivo/*', bodyLimit(MAX_UPLOAD_BYTES));
app.use('/api/*', csrf());

// ---------- helpers ----------

function setSessionCookie(c: any, token: string, userId: string, ua: string): void {
  const { name, secure, sameSite, maxAgeDays } = config.cookie;
  const expires = new Date(Date.now() + maxAgeDays * 86400_000);
  q('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)')
    .run(tokenHash(token), userId, new Date().toISOString(), expires.toISOString(), ua.slice(0, 200));
  const parts = [
    `${name}=${token}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Path=/',
    `Expires=${expires.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  c.header('Set-Cookie', parts.join('; '), { append: true });
}


function byokFor(userId: string): Record<string, string> {
  const rows = q('SELECT provider, secret_enc FROM user_keys WHERE user_id = ?').all(userId) as any[];
  const out: Record<string, string> = {};
  for (const r of rows) { try { out[r.provider] = decryptSecret(r.secret_enc); } catch { /* chave de outra sessão de cifra */ } }
  return out;
}

/** Provedores BYOK aceites. Uma lista fechada evita guardar lixo (e usar a
 *  chave de um serviço noutro sítio, que é o erro clássico de BYOK). */
const BYOK_PROVIDERS: Record<string, { label: string; usedBy: string; doc: string }> = {
  'leaklookup': { label: 'Leak-Lookup', usedBy: 'Exposição Pública', doc: 'https://leak-lookup.com/api' },
  'github-pat': { label: 'GitHub (personal access token)', usedBy: 'GitHub OSINT', doc: 'https://github.com/settings/tokens' },
  'shodan': { label: 'Shodan', usedBy: 'Analisador de IP', doc: 'https://account.shodan.io' },
};

// ---------- limitadores ----------
// Login e registo têm contadores separados, porque são ataques diferentes.
// O contador de LOGIN reinicia quando as credenciais estão certas (é a pessoa
// certa). O de REGISTO nunca reinicia: criar contas é o vetor, e "depois do
// sucesso já não conto" era o que o tornava inútil.
const authLimiter = new RateLimiter(config.rateLimit.authMax, config.rateLimit.windowMin * 60_000, 'auth');
const registerLimiter = new RateLimiter(config.rateLimit.registerMax, config.rateLimit.windowMin * 60_000, 'register');
const runLimiter = new RateLimiter(Number(process.env.ARGUS_RUN_MAX ?? 120), 60_000, 'run');
const ipLimiter = new RateLimiter(Number(process.env.ARGUS_IP_MAX ?? 600), 60_000, 'ip');
const uploadLimiter = new RateLimiter(Number(process.env.ARGUS_UPLOAD_MAX ?? 30), 60_000, 'upload');

function limited(c: any, key: string): Response | null {
  const ip = clientIp(c);
  const r1 = ipLimiter.hit(ip);
  if (r1) return c.json({ error: 'demasiados_pedidos', msg: 'Demasiados pedidos. Abranda um pouco.' }, 429, { 'retry-after': String(r1) });
  const r2 = runLimiter.hit(key);
  if (r2) return c.json({ error: 'demasiadas_execucoes', msg: 'Demasiadas execuções por minuto.' }, 429, { 'retry-after': String(r2) });
  return null;
}

// ---------- auth ----------
app.post('/api/auth/register', async (c) => {
  const wait = registerLimiter.hit(clientIp(c));
  if (wait) return c.json({ error: 'demasiadas_tentativas', msg: `Demasiadas contas criadas a partir deste endereço. Tente de novo em ${wait}s.` }, 429, { 'retry-after': String(wait) });
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const pass = String(body.password ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 190) return c.json({ error: 'email_invalido' }, 400);
  if (name.length < 2 || name.length > 60) return c.json({ error: 'nome_invalido' }, 400);
  if (pass.length < 8) return c.json({ error: 'senha_curta', msg: 'Mínimo 8 caracteres' }, 400);
  if (pass.length > 200) return c.json({ error: 'senha_longa' }, 400);
  if (q('SELECT id FROM users WHERE email = ?').get(email)) return c.json({ error: 'email_em_uso' }, 409);
  const id = randomUUID();
  q('INSERT INTO users(id,email,name,pass_hash,plan,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, email, name, newPasswordHash(pass), 'free', new Date().toISOString());
  const token = newToken();
  setSessionCookie(c, token, id, c.req.header('user-agent') ?? '');
  return c.json({ ok: true, user: { id, email, name, plan: 'free' } }, 201);
});

app.post('/api/auth/login', async (c) => {
  const ip = clientIp(c);
  const wait = authLimiter.hit(`login:${ip}`);
  if (wait) return c.json({ error: 'demasiadas_tentativas', msg: `Demasiadas tentativas. Tente de novo em ${wait}s.` }, 429, { 'retry-after': String(wait) });
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const pass = String(body.password ?? '');
  const row = q('SELECT * FROM users WHERE email = ?').get(email) as any;
  if (!row || !verifyPass(pass, row.pass_hash)) return c.json({ error: 'credenciais_invalidas' }, 401);
  if (row.suspended) return c.json({ error: 'conta_suspensa', msg: 'Esta conta está suspensa.' }, 403);
  const token = newToken();
  setSessionCookie(c, token, row.id, c.req.header('user-agent') ?? '');
  authLimiter.reset(`login:${ip}`);
  const isAdmin = !!row.is_admin || ADMIN_EMAILS.has(String(row.email).toLowerCase());
  return c.json({ ok: true, user: { id: row.id, email: row.email, name: row.name, plan: row.plan, isAdmin } });
});

app.post('/api/auth/logout', (c) => {
  const token = readSessionToken(c);
  if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  const { name, secure, sameSite } = config.cookie;
  const parts = [`${name}=`, 'HttpOnly', `SameSite=${sameSite}`, 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  c.header('Set-Cookie', parts.join('; '), { append: true });
  return c.json({ ok: true });
});

/** Fecha todas as outras sessões (útil quando se suspects de acesso alheio). */
app.post('/api/auth/logout-all', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  q('DELETE FROM sessions WHERE user_id = ?').run(u.userId);
  const { name, secure, sameSite } = config.cookie;
  const parts = [`${name}=`, 'HttpOnly', `SameSite=${sameSite}`, 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  c.header('Set-Cookie', parts.join('; '), { append: true });
  return c.json({ ok: true });
});

app.post('/api/auth/password', async (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const wait = authLimiter.hit(`pwd:${u.userId}`);
  if (wait) return c.json({ error: 'demasiadas_tentativas', msg: `Tente de novo em ${wait}s.` }, 429);
  const body = await c.req.json().catch(() => ({}));
  const atual = String(body.current ?? '');
  const nova = String(body.next ?? '');
  if (nova.length < 8) return c.json({ error: 'senha_curta', msg: 'Mínimo 8 caracteres' }, 400);
  const row = q('SELECT pass_hash FROM users WHERE id = ?').get(u.userId) as any;
  if (!row || !verifyPass(atual, row.pass_hash)) return c.json({ error: 'senha_atual_incorreta' }, 403);
  q('UPDATE users SET pass_hash = ? WHERE id = ?').run(newPasswordHash(nova), u.userId);
  // Todas as sessões caem menos a atual? Por segurança, todas: quem roubou a
  // senha antiga perde o acesso.
  q('DELETE FROM sessions WHERE user_id = ?').run(u.userId);
  const token = newToken();
  setSessionCookie(c, token, u.userId, c.req.header('user-agent') ?? '');
  return c.json({ ok: true, msg: 'Senha alterada. As outras sessões foram encerradas.' });
});

/** Eliminação de conta (direito ao esquecimento, art. 18 da LGPD). */
app.post('/api/auth/delete-account', async (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const body = await c.req.json().catch(() => ({}));
  const pass = String(body.password ?? '');
  const row = q('SELECT pass_hash FROM users WHERE id = ?').get(u.userId) as any;
  if (!row || !verifyPass(pass, row.pass_hash)) return c.json({ error: 'senha_incorreta', msg: 'Confirme a senha para eliminar a conta.' }, 403);
  q('DELETE FROM users WHERE id = ?').run(u.userId);   // ON DELETE CASCADE leva o resto
  q('DELETE FROM runs WHERE user_id = ?').run(u.userId);
  const { name, secure, sameSite } = config.cookie;
  const parts = [`${name}=`, 'HttpOnly', `SameSite=${sameSite}`, 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  c.header('Set-Cookie', parts.join('; '), { append: true });
  return c.json({ ok: true, msg: 'Conta eliminada.' });
});

app.get('/api/me', (c) => {
  const u = currentUser(c);
  if (!u) return c.json({ user: null });
  const plan = PLANS[u.plan];
  return c.json({
    user: { userId: u.userId, plan: u.plan, email: u.email, name: u.name, isAdmin: u.isAdmin },
    usage: {
      today: dailyCount(u.userId), daily: plan.dailyRuns,
      inflight: inflightCount(u.userId), concurrent: plan.concurrent,
      maxItems: plan.maxItems, graphHops: plan.graphHops,
      investigations: plan.investigations,
    },
  });
});

// ---------- contacto público ----------
/**
 * O número de WhatsApp e o nome do autor não vivem no frontend.
 *
 * Viviam, escritos à mão em dois sítios, e divergiram — o número de telemóvel
 * estava com um dígito a menos. Para corrigir isso não devia ser preciso tocar
 * em código nem reconstruir o bundle (que o browser cacheia para sempre).
 * Aqui o servidor é a fonte da verdade e o cliente limitamo-nos a mostrar.
 */
app.get('/api/contact', (c) => c.json({
  whatsapp: config.contacto.whatsapp,
  label: config.contacto.label,
  link: `https://wa.me/${config.contacto.whatsapp}`,
  marca: config.autor.nome,
  autor: config.autor.legal,
  autorLink: config.autor.link ?? null,
  copyright: config.autor.copyright,
}));

// ---------- catálogo ----------
app.get('/api/tools', (c) => {
  const u = currentUser(c);
  const plan: PlanId = u?.plan ?? 'free';
  return c.json({
    tools: allTools().map((t) => publicTool(t, plan)),
    plan,
    usage: u
      ? { today: dailyCount(u.userId), daily: PLANS[plan].dailyRuns, concurrent: PLANS[plan].concurrent, inflight: inflightCount(u.userId) }
      : null,
  });
});

app.get('/api/tools/:id', (c) => {
  const u = currentUser(c);
  const plan: PlanId = u?.plan ?? 'free';
  const t = getTool(c.req.param('id'));
  if (!t) return c.json({ error: 'nao_encontrada' }, 404);
  return c.json({ tool: publicTool(t, plan) });
});

app.get('/api/plans', (c) => c.json({ plans: PLAN_LIST }));
app.get('/api/byok/providers', (c) =>
  c.json({ providers: Object.entries(BYOK_PROVIDERS).map(([id, v]) => ({ id, ...v })) }));

// ---------- execução ----------
/** Ferramentas que aceitam ficheiro enviado pelo utilizador. */
const FILE_TOOLS = new Set(['metadata-extractor', 'reverse-image']);

app.post('/api/run/:id', async (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const denied = limited(c, u.userId);
  if (denied) return denied;
  const id = c.req.param('id');
  const tool = getTool(id);
  if (!tool) return c.json({ error: 'nao_encontrada' }, 404);
  if (lockState(id, u.plan) === 'locked') {
    return c.json({ error: 'bloqueada', minPlan: tool.minPlan, msg: `Disponível a partir do plano ${planName(tool.minPlan)}.` }, 402);
  }
  const body = await readJson(c);
  if (body.error) return c.json({ error: 'json_invalido' }, 400);

  const input: Record<string, string> = {};
  for (const f of tool.fields) {
    const v = String(body[f.name] ?? '').trim();
    if (f.required && !v && f.type !== 'file') {
      // `file` pode chegar vazio se o utilizador escolheu a via da URL.
      const temAlt = tool.fields.some((o) => o.name !== f.name && o.type === 'file' && String(body[o.name] ?? '').trim());
      if (!temAlt) return c.json({ error: 'campo_obrigatorio', field: f.name }, 400);
    }
    if (v) {
      if (f.type === 'file') {
        if (v.length > MAX_UPLOAD_BYTES) return c.json({ error: 'ficheiro_grande', msg: `Máximo ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB.` }, 413);
        if (!/^data:[\w.+-]+\/[\w.+-]+;base64,/i.test(v)) return c.json({ error: 'ficheiro_invalido', msg: 'Formato de upload não reconhecido.' }, 400);
      }
      if (v.length > 20_000) return c.json({ error: 'campo_longo', field: f.name }, 400);
      input[f.name] = v;
    }
  }

  try {
    const run = await executeTool(id, input, { userId: u.userId, plan: u.plan, byok: byokFor(u.userId) });
    return c.json({
      run,
      usage: {
        today: dailyCount(u.userId), daily: PLANS[u.plan].dailyRuns,
        inflight: inflightCount(u.userId), concurrent: PLANS[u.plan].concurrent,
      },
    });
  } catch (e: any) {
    if (e?.name === 'QuotaError') return c.json({ error: 'limite', kind: e.kind, msg: e.message }, 429);
    if (e?.name === 'LockedError' || e instanceof LockedError) return c.json({ error: 'bloqueada', minPlan: e.minPlan }, 402);
    if (e?.name === 'FileError') return c.json({ error: 'ficheiro_invalido', msg: e.message }, 400);
    return c.json({ error: 'erro_execucao', msg: String(e?.message ?? e).slice(0, 200) }, 500);
  }
});

/**
 * Endpoint de ficheiro. Existe separado do `/api/run` porque o tecto de corpo é
 * outro (16 MB) e porque assim o corpo grande nunca passa pela rota normal.
 * Devolve um handle temporário, não o ficheiro: o ficheiro volta a ser lido
 * pela ferramenta a partir do buffer, e nunca é escrito em disco.
 */
app.post('/api/arquivo/inspect', async (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const wait = uploadLimiter.hit(u.userId);
  if (wait) return c.json({ error: 'demasiados_uploads', msg: `Tente de novo em ${wait}s.` }, 429);
  const body = await readJson(c);
  const log = new SourceLog();
  try {
    const f = await resolveFile(log, {
      data: String(body.data ?? ''),
      url: String(body.url ?? ''),
      name: String(body.name ?? '').slice(0, 120),
      srcId: 'ficheiro',
    });
    return c.json({
      ok: true,
      tipo: f.kind,
      bytes: f.buffer.length,
      origem: f.origin,
      nome: f.label,
      contentType: f.declaredMime ?? null,
    });
  } catch (e) {
    return c.json({ error: 'ficheiro_invalido', msg: e instanceof FileError ? e.message : String((e as Error).message).slice(0, 120) }, 400);
  }
});

/** Só para confirmar que o servidor sabe descrever um ficheiro sem o guardar. */
app.get('/api/arquivo/formatos', (c) =>
  c.json({ formatos: ['jpeg', 'png', 'gif', 'webp', 'pdf', 'bmp', 'tiff', 'heic'], maxBytes: MAX_FILE_BYTES }));

function planName(p: MinPlan | PlanId): string {
  return PLANS[p as PlanId]?.name ?? String(p);
}

async function readJson(c: any): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' ? v as Record<string, unknown> : {};
  } catch {
    return { error: 'json' };
  }
}

// ---------- BYOK ----------
app.get('/api/keys', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const rows = q('SELECT provider, created_at FROM user_keys WHERE user_id = ? ORDER BY created_at').all(u.userId) as any[];
  return c.json({ keys: rows.map((r) => ({ ...r, meta: BYOK_PROVIDERS[r.provider] ?? null })) });
});
app.post('/api/keys', async (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const body = await readJson(c);
  const provider = String(body.provider ?? '').trim();
  const secret = String(body.secret ?? '').trim();
  if (!BYOK_PROVIDERS[provider]) return c.json({ error: 'provedor_desconhecido', msg: `Aceites: ${Object.keys(BYOK_PROVIDERS).join(', ')}` }, 400);
  if (!secret || secret.length > 400) return c.json({ error: 'invalido' }, 400);
  q(`INSERT INTO user_keys(id,user_id,provider,secret_enc,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,provider) DO UPDATE SET secret_enc=excluded.secret_enc, created_at=excluded.created_at`)
    .run(randomUUID(), u.userId, provider, encryptSecret(secret), new Date().toISOString());
  return c.json({ ok: true });
});
app.delete('/api/keys/:provider', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  q('DELETE FROM user_keys WHERE user_id = ? AND provider = ?').run(u.userId, c.req.param('provider'));
  return c.json({ ok: true });
});

// ---------- investigações ----------
app.get('/api/investigations', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const rows = q(`SELECT id, seed, seed_type, title, created_at, updated_at, node_count, edge_count, tools
    FROM investigations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200`).all(u.userId) as any[];
  return c.json({ investigations: rows.map((r) => ({ ...r, tools: safeJson(r.tools) })) });
});

app.get('/api/investigations/:id', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const id = c.req.param('id');
  const inv = q('SELECT * FROM investigations WHERE id = ? AND user_id = ?').get(id, u.userId) as any;
  if (!inv) return c.json({ error: 'nao_encontrada' }, 404);
  const nodes = q('SELECT id,type,label,value,source_ids,confidence,hop,attrs FROM nodes WHERE inv_id = ? ORDER BY hop, id').all(id) as any[];
  const edges = q('SELECT from_id,to_id,rel,confidence,source_ids FROM edges WHERE inv_id = ?').all(id) as any[];
  return c.json({
    investigation: { ...inv, tools: safeJson(inv.tools) },
    nodes: nodes.map((n) => ({ ...n, sourceIds: safeJson(n.source_ids), attrs: safeJson(n.attrs) })),
    edges: edges.map((e) => ({ ...e, sourceIds: safeJson(e.source_ids) })),
  });
});

app.patch('/api/investigations/:id', async (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const id = c.req.param('id');
  const inv = q('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(id, u.userId);
  if (!inv) return c.json({ error: 'nao_encontrada' }, 404);
  const body = await readJson(c);
  const title = String(body.title ?? '').trim();
  if (!title || title.length > 120) return c.json({ error: 'titulo_invalido' }, 400);
  q('UPDATE investigations SET title = ?, updated_at = ? WHERE id = ?').run(title, new Date().toISOString(), id);
  return c.json({ ok: true });
});

app.delete('/api/investigations/:id', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const id = c.req.param('id');
  const inv = q('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(id, u.userId);
  if (!inv) return c.json({ error: 'nao_encontrada' }, 404);
  q('DELETE FROM nodes WHERE inv_id = ?').run(id);
  q('DELETE FROM edges WHERE inv_id = ?').run(id);
  q('DELETE FROM investigations WHERE id = ?').run(id);
  return c.json({ ok: true });
});

/** Histórico de execuções do utilizador. */
app.get('/api/historico', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const rows = q(`SELECT id, tool_id, input, created_at, length(output) AS bytes FROM runs
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(u.userId) as any[];
  return c.json({ runs: rows });
});

app.get('/api/historico/:id', (c) => {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  const row = q('SELECT * FROM runs WHERE id = ? AND user_id = ?').get(c.req.param('id'), u.userId) as any;
  if (!row) return c.json({ error: 'nao_encontrada' }, 404);
  return c.json({ run: safeJson(row.output), at: row.created_at, input: safeJson(row.input) });
});

function safeJson(s: unknown): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return null; }
}

// ---------- administração ----------
app.get('/api/admin/estado', (c) => {
  const u = requireAdmin(c);
  if (u instanceof Response) return u;
  const users = q(`SELECT id, email, name, plan, is_admin, suspended, created_at FROM users
    ORDER BY created_at DESC LIMIT 200`).all() as any[];
  const nUsers = (q('SELECT COUNT(*) c FROM users').get() as any).c;
  const nRuns = (q('SELECT COUNT(*) c FROM runs').get() as any).c;
  const nInvs = (q('SELECT COUNT(*) c FROM investigations').get() as any).c;
  const hoje = (q('SELECT COUNT(*) c FROM usage WHERE at >= ?').get(new Date().toISOString().slice(0, 10)) as any).c;
  return c.json({ users, nUsers, nRuns, nInvs, hoje, plans: PLAN_LIST, db: dbHealth() });
});

app.post('/api/admin/user/:id/plano', async (c) => {
  const u = requireAdmin(c);
  if (u instanceof Response) return u;
  const body = await readJson(c);
  const plan = String(body.plan ?? '');
  if (!isPlanId(plan)) return c.json({ error: 'plano_invalido' }, 400);
  const target = q('SELECT id, plan FROM users WHERE id = ?').get(c.req.param('id')) as any;
  if (!target) return c.json({ error: 'nao_encontrado' }, 404);
  q('UPDATE users SET plan = ? WHERE id = ?').run(plan, target.id);
  // Mudar de plano invalida as decisões de cota em cache (não há cache, mas
  // as sessões leem o plano a cada pedido — nada a fazer). O que se faz é
  // limpar o histórico de usos para o plano novo valer no dia corrente.
  if (body.resetUsage) q('DELETE FROM usage WHERE user_id = ?').run(target.id);
  return c.json({ ok: true, plan });
});

app.post('/api/admin/user/:id/flags', async (c) => {
  const u = requireAdmin(c);
  if (u instanceof Response) return u;
  const body = await readJson(c);
  const target = q('SELECT id, is_admin, suspended FROM users WHERE id = ?').get(c.req.param('id')) as any;
  if (!target) return c.json({ error: 'nao_encontrado' }, 404);
  const id = target.id;
  if (typeof body.isAdmin === 'boolean') {
    if (id === u.userId && !body.isAdmin) return c.json({ error: 'auto_bloqueio', msg: 'Não pode remover o seu próprio acesso de administração.' }, 400);
    q('UPDATE users SET is_admin = ? WHERE id = ?').run(body.isAdmin ? 1 : 0, id);
  }
  if (typeof body.suspended === 'boolean') {
    q('UPDATE users SET suspended = ? WHERE id = ?').run(body.suspended ? 1 : 0, id);
    if (body.suspended) q('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  const fresh = q('SELECT id, is_admin, suspended FROM users WHERE id = ?').get(id);
  return c.json({ ok: true, user: fresh });
});

// ---------- health ----------
/**
 * Health check do Render. Não diz só "o processo vive": diz se o disco do
 * SQLite está montado e a escrever. Sem isso o serviço fica VERDE com o disco
 * por montar e aceita registos que se perdem no deploy seguinte.
 */
/**
 * Saúde do serviço — e, desde a FASE G, a saúde das DEPENDÊNCIAS por provider.
 *
 * Por omissão: presença e configuração (rápido, sem rede, sem spawning de
 * versões). `?detalhe=sim` acrescenta versão, latência e, se houver token, o
 * estado do serviço Apify. Nunca expõe segredos: os campos dizem o NOME da
 * variável em falta, nunca o valor.
 */
app.get('/api/health', async (c) => {
  const dbh = dbHealth();
  const detalhe = (c.req.query('detalhe') ?? '') === 'sim';
  let saude: Awaited<ReturnType<typeof saudeSistema>> | null = null;
  let erroSaude: string | null = null;
  try {
    saude = await saudeSistema({ detalhe });
  } catch (e) {
    erroSaude = String((e as Error).message ?? e).slice(0, 300);
  }
  return c.json(
    {
      ok: dbh.writable, tools: allTools().length, uptime: Math.round(process.uptime()),
      env: config.env, db: dbh,
      estadoGeral: saude?.estadoGeral ?? 'ERROR',
      resumo: saude?.porEstado ?? {},
      providers: saude?.linhas ?? [],
      nota: saude?.nota ?? 'falha ao verificar dependências',
      geradoEm: saude?.geradoEm ?? new Date().toISOString(),
      detalhe,
      erro: erroSaude,
    },
    dbh.writable && !erroSaude ? 200 : 503,
  );
});

// ---------- Intelligence Engine (FASE E/G) ----------
app.route('/api/intel', intelRoutes);

// ---------- plano de investigação (FASE F) ----------
// Monte depois das rotas de investigação: os caminhos são distintos
// (`/:id/plan` frente a `/:id`), por isso a ordem não esconde nada.
app.route('/api/investigations', criarPlanoRouter({ byokFor, limite: limited }));


// ---------- estáticos ----------
/**
 * Onde está o build do frontend.
 *
 * `ARGUS_WEB_DIST` explícito e ausente é **erro fatal** em produção: um caminho
 * mal escrito que caísse no "se não achei, tenta noutro sítio" serviria o build
 * errado em silêncio. O modo `auto` mantém a descoberta.
 */
function resolveWebDist(): string | null {
  const explicito = config.webDist !== 'auto';
  const candidatos = explicito
    ? [config.webDist]
    : [join(import.meta.dirname ?? process.cwd(), '..', '..', 'web', 'dist')];
  for (const dir of candidatos) {
    if (existsSync(join(dir, 'index.html'))) return resolve(dir);
  }
  if (explicito && config.isProd) {
    console.error(`[ARGUS] ARGUS_WEB_DIST aponta para "${config.webDist}" e não tem index.html.`);
    console.error('[ARGUS] Em produção o caminho tem de existir. Build antes de arrancar: npm run build');
    process.exit(1);
  }
  return null;
}

const WEB_DIST = resolveWebDist();
if (!WEB_DIST && config.isProd) {
  console.error(`[ARGUS] Não encontrei o build do frontend (${config.webDist}). Build antes de arrancar: npm run build`);
  process.exit(1);
}

if (WEB_DIST) {
  const INDEX_HTML = join(WEB_DIST, 'index.html');
  app.use('/assets/*', serveStatic({
    root: WEB_DIST,
    // os ficheiros têm hash no nome: podem ser cacheados para sempre
    onFound: (path, c) => { c.header('cache-control', 'public, max-age=31536000, immutable'); },
  }));
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'nao_encontrada' }, 404);
    let p = c.req.path;
    // `decodeURIComponent` atira exceção com `%` órfão: sem este try, um
    // pedido a `/%ZZ` devolvia 500 em vez do index.
    try { p = decodeURIComponent(p); } catch { return c.json({ error: 'caminho_invalido' }, 400); }
    const file = resolve(WEB_DIST, '.' + (p.startsWith('/') ? p : '/' + p));
    const dentro = file === WEB_DIST || file.startsWith(WEB_DIST + sep);
    if (p !== '/' && dentro && existsSync(file) && statSync(file).isFile() && extname(file)) {
      return c.body(readFileSync(file), 200, { 'content-type': mime(p), 'cache-control': 'public, max-age=3600' });
    }
    // SPA: qualquer rota desconhecida devolve o index (que decide no cliente)
    return c.body(readFileSync(INDEX_HTML), 200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
    });
  });
}

function mime(p: string): string {
  const e = extname(p).toLowerCase();
  if (e === '.js' || e === '.mjs') return 'text/javascript; charset=utf-8';
  if (e === '.css') return 'text/css; charset=utf-8';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.json') return 'application/json; charset=utf-8';
  if (e === '.webmanifest') return 'application/manifest+json; charset=utf-8';
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.ico') return 'image/x-icon';
  if (e === '.woff2') return 'font/woff2';
  if (e === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

// ---------- arranque ----------
prune();
const pruneTimer = setInterval(() => {
  try { prune(); } catch (e) { console.warn('[ARGUS] poda falhou:', (e as Error).message); }
}, 2 * 3600_000);
pruneTimer.unref();

const server = serve({ fetch: app.fetch, port: PORT, hostname: config.host }, (info) => {
  const tools = allTools().length;
  console.log(`[ARGUS] a correr em http://${config.host}:${info.port} — ${tools} ferramentas registadas`);
  console.log(`[ARGUS] ${configReport(tools)}`);
  for (const w of configWarnings()) console.warn(`[ARGUS] AVISO: ${w}`);
  if (!WEB_DIST) console.warn('[ARGUS] AVISO: frontend não encontrado; só a API responde.');
});

/** Encerramento orderly: o Render manda SIGTERM antes de cada deploy. */
let aFechar = false;
function shutdown(sinal: string): void {
  if (aFechar) return;
  aFechar = true;
  console.log(`[ARGUS] ${sinal} recebido: a fechar...`);
  clearInterval(pruneTimer);
  server.close(() => {
    closeDb();
    console.log('[ARGUS] fechado com checkpoint do banco.');
    process.exit(0);
  });
  setTimeout(() => { closeDb(); process.exit(0); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e: any) => console.error('[ARGUS] rejeição não tratada:', e?.message ?? e));

// Usado pelos testes de integração.
export { app };
