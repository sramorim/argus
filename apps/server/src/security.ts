/**
 * Cabeçalhos de segurança, CORS restrito, limite de corpo, CSRF e limitação de
 * tentativas.
 *
 * CORS: a app é servida no mesmo domínio que a API, portanto **não há CORS
 * nenhum** por omissão — e isso é o mais seguro. Só se declara
 * `ARGUS_ALLOWED_ORIGINS` com domínios explícitos e mesmo assim nunca `*`,
 * porque `*` com credenciais é um convite ao roubo de sessão.
 *
 * CSRF: o cookie de sessão é `SameSite=Lax` + `HttpOnly` + `__Host-`, o que já
 * corta o CSRF clássico. Mas `Lax` permite navegação de topo por GET, e o
 * `Origin` é a única prova fiável de que um pedido POST é da própria aplicação.
 * Por isso, pedidos que mudam estado exigem `Origin`/`Sec-Fetch-Site` coerente.
 */
import { config, isProd } from './config.ts';
import { q, tokenHash } from './db.ts';
import type { PlanId } from './plans.ts';

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  // o React aplica estilos inline (style={{...}}): sem 'unsafe-inline' aqui a app não renderiza
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

/** Cabeçalhos aplicados a todas as respostas. */
export function securityHeaders() {
  return async (c: any, next: any) => {
    await next();
    c.header('content-security-policy', CSP);
    c.header('x-content-type-options', 'nosniff');
    c.header('x-frame-options', 'DENY');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    c.header('permissions-policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    c.header('cross-origin-opener-policy', 'same-origin');
    c.header('cross-origin-resource-policy', 'same-origin');
    c.header('x-permitted-cross-domain-policies', 'none');
    c.header('x-download-options', 'noopen');
    if (config.cookie.secure) c.header('strict-transport-security', 'max-age=31536000');
  };
}

const ALLOWED = new Set(config.allowedOrigins);

function normOrigin(o: string | undefined): string {
  return (o ?? '').replace(/\/+$/, '');
}

/** CORS por lista branca. Sem lista, não devolve nada — o navegador bloqueia a leitura. */
export function cors() {
  return async (c: any, next: any) => {
    const origin: string | undefined = c.req.header('origin');
    const allowed = !!origin && ALLOWED.has(normOrigin(origin));
    if (allowed) {
      c.header('access-control-allow-origin', origin!);
      c.header('access-control-allow-credentials', 'true');
      c.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      c.header('access-control-allow-headers', 'content-type');
      c.header('access-control-max-age', '600');
      c.header('vary', 'Origin');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, origin && !allowed ? 403 : 204);
    }
    return next();
  };
}

/** Corpo máximo (a API só recebe JSON pequeno: formulários de ferramentas e BYOK). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Uploads de ficheiro passam por um tecto próprio, ainda bem abaixo de 1 GB. */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

/**
 * Limite de corpo, aplicado sobre o STREAM e não só sobre o cabeçalho
 * `Content-Length`.
 *
 * Confiar no cabeçalho era buraco: um pedido com `Transfer-Encoding: chunked`
 * não traz `Content-Length` e passava sem limite nenhum.
 *
 * Ao ler o stream para o contar, é preciso devolvê-lo: um `Request` é de
 * leitura única, e o `c.req.json()` do handler falhava com "Body is unusable"
 * se o middleware o consumisse sem reconstruir. Por isso o corpo é tampado num
 * Buffer e o `Request` é reconstruído com esse Buffer como corpo novo.
 */
export function bodyLimit(max = MAX_BODY_BYTES) {
  return async (c: any, next: any) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'DELETE') return next();

    // Atalho barato quando o cliente diz o tamanho e ele cabe no tecto.
    const len = Number(c.req.header('content-length') ?? 0);
    if (Number.isFinite(len) && len > 0) {
      if (len > max) return c.json({ error: 'corpo_grande', msg: `Máximo ${max} bytes.` }, 413);
      return next();
    }

    const stream = c.req.raw.body;
    if (!stream) return next();

    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        // Corta o mais cedo possível: um upload de 2 GB não fica em memória à espera.
        if (total > max) { over = true; break; }
        chunks.push(Buffer.from(value));
      }
    } catch {
      return c.json({ error: 'corpo_invalido', msg: 'O corpo do pedido não pôde ser lido.' }, 400);
    }
    if (over) {
      try { await reader.cancel(); } catch { /* já fechado */ }
      return c.json({ error: 'corpo_grande', msg: `Máximo ${max} bytes.` }, 413);
    }

    const buf = Buffer.concat(chunks);
    // Reconstroi o Request para os handlers poderem lê-lo (uma vez só).
    try {
      const novo = new Request(c.req.raw.url, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: buf,
      });
      Object.defineProperty(c.req, 'raw', { value: novo, writable: true, configurable: true });
    } catch { /* sem headers clonáveis: os handlers verão o corpo já tampado */ }
    (c.req.raw as { _argusBody?: Buffer })._argusBody = buf;
    return next();
  };
}

/** Corpo já lido e tampado pelo limitador (ou `null` se veio pelo caminho rápido). */
export function rawBody(c: any): Buffer | null {
  return (c.req.raw as { _argusBody?: Buffer })._argusBody ?? null;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Protecção CSRF por `Origin` / `Sec-Fetch-Site`.
 *
 * Regras: um pedido que muda estado tem de vir do mesmo sítio. `Origin` ausente
 * acontece em formulários e em clientes não-navegador (curl, testes) — nesses
 * casos só aceitamos quando não há cookie de sessão, ou seja, quando não há o
 * que roubar.
 */
export function csrf() {
  return async (c: any, next: any) => {
    if (!MUTATING.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    const temCookie = !!c.req.header('cookie');

    if (site === 'cross-site' || (site === 'same-site' && !sameSite(c))) {
      return c.json({ error: 'origem_recusada', msg: 'Pedido originado noutro sítio.' }, 403);
    }
    if (origin) {
      const host = c.req.header('host');
      const daMesmaOrigem = originMatch(origin, host);
      const emListaBranca = ALLOWED.has(normOrigin(origin));
      if (!daMesmaOrigem && !emListaBranca) {
        return c.json({ error: 'origem_recusada', msg: 'Origem não autorizada.' }, 403);
      }
    } else if (temCookie) {
      // Sem Origin e com cookie: é um formulário de outro sítio (ou um cliente
      // antigo). Recusamos — quem chama pela API manda o Origin.
      return c.json({ error: 'origem_recusada', msg: 'Falta o cabeçalho Origin.' }, 403);
    }
    return next();
  };
}

function sameSite(c: any): boolean {
  const origin = c.req.header('origin');
  const host = c.req.header('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch { return false; }
}

function originMatch(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch { return false; }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPublicIp(ip: string): boolean {
  const v4 = IPV4.exec(ip);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((o) => o > 255)) return false;
    if (n[0] === 10 || n[0] === 127 || n[0] === 0) return false;
    if (n[0] === 172 && n[1]! >= 16 && n[1]! <= 31) return false;
    if (n[0] === 192 && n[1] === 168) return false;
    if (n[0] === 169 && n[1] === 254) return false;
    if (n[0] === 100 && n[1]! >= 64 && n[1]! <= 127) return false; // CGNAT
    if (n[0]! >= 224) return false;
    return true;
  }
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return false;
    if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return false;
    if (low.startsWith('::ffff:127.') || low.startsWith('::ffff:10.')) return false;
    if (low.startsWith('::ffff:192.168.') || low.startsWith('::ffff:169.254.')) return false;
    return true;
  }
  return false;
}

/**
 * IP real do cliente, para o rate-limit.
 *
 * O `X-Forwarded-For` é um campo que o cliente escreve. Só se lê quando há um
 * proxy de confiança à frente (Render), e nesse caso toma-se a entrada DA
 * DIREITA: o proxy acrescenta o IP real no fim, à esquerda está tudo o que o
 * cliente quis mandar. Sem proxy confiável usa-se o socket — nunca o cabeçalho.
 */
export function clientIp(c: any): string {
  if (config.trustProxy) {
    const chain = (c.req.header('x-forwarded-for') ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) {
      if (isPublicIp(chain[i]!)) return chain[i]!;
    }
    if (chain.length) return chain[chain.length - 1]!;
  }
  // O @hono/node-server passa o `IncomingMessage` como `env`. Há versões que o
  // embrulham em `{ incoming }`. Sem esta folga, `clientIp` devolvia sempre
  // 'desconhecido' e TODAS as visitas partilhavam o mesmo balde de limitação —
  // o que é o mesmo que não ter limitação nenhuma para quem usa o serviço.
  const env = c.env as any;
  const sock: string | undefined =
    env?.socket?.remoteAddress ??
    env?.incoming?.socket?.remoteAddress ??
    env?.req?.socket?.remoteAddress;
  if (sock) return sock;
  return 'desconhecido';
}

// ---------- limitação de tentativas ----------
interface Bucket { count: number; resetAt: number }

/**
 * Limitador em memória, por chave. Janela deslizante simplificada (janela fixa
 * que reinicia): suficiente para login e para travar abuso, e não growe sem fim.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private max: number;
  private windowMs: number;
  private label: string;
  // NOTA: campos declarados à mão (e não "parameter properties") porque o
  // arranque usa o strip-types nativo do Node, que não remove essa sintaxe.
  constructor(max: number, windowMs: number, label: string) {
    this.max = max;
    this.windowMs = windowMs;
    this.label = label;
  }

  /** @returns segundos a esperar quando o limite foi atingido, 0 quando passou. */
  hit(key: string): number {
    const now = Date.now();
    const rec = this.buckets.get(key);
    if (!rec || now > rec.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.buckets.size > 20_000) this.sweep(now);
      return 0;
    }
    rec.count++;
    if (rec.count > this.max) return Math.ceil((rec.resetAt - now) / 1000);
    return 0;
  }

  reset(key: string): void { this.buckets.delete(key); }

  private sweep(now: number): void {
    for (const [k, v] of this.buckets) if (now > v.resetAt) this.buckets.delete(k);
    // Ainda assim grande: corta a meta de forma agresiva.
    if (this.buckets.size > 10_000) {
      const keys = [...this.buckets.keys()].slice(0, this.buckets.size - 5000);
      for (const k of keys) this.buckets.delete(k);
    }
  }

  get name(): string { return this.label; }
}

// ---------- sessão e autorização ----------
/**
 * Quem é o utilizador atrás do pedido.
 *
 * Viveram em `index.ts` até a FASE E, quando o Intelligence Engine passou a
 * precisar das mesmas regras: um módulo que lê investigações tem de saber quem
 * é o dono, e isso só pode existir num sítio só. Daqui saem `currentUser`,
 * `requireAuth` e `requireAdmin` — o cliente continua a não decidir nada.
 */
export interface Ctx { userId: string; plan: PlanId; email: string; name: string; isAdmin: boolean }

/** Administradores: a coluna `is_admin` do banco + a lista de e-mails do ambiente. */
export const ADMIN_EMAILS = new Set(
  (process.env.ARGUS_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

export function readSessionToken(c: any): string | null {
  const name = config.cookie.name;
  const raw = c.req.header('cookie') ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function currentUser(c: any): Ctx | null {
  const token = readSessionToken(c);
  if (!token) return null;
  const row = q(`SELECT u.id, u.email, u.name, u.plan, u.is_admin, u.suspended, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(tokenHash(token)) as any;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    q('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    return null;
  }
  if (row.suspended) return null;
  const isAdmin = !!row.is_admin || ADMIN_EMAILS.has(String(row.email).toLowerCase());
  return { userId: row.id, plan: row.plan, email: row.email, name: row.name, isAdmin };
}

export function requireAuth(c: any): Response | Ctx {
  const u = currentUser(c);
  if (!u) return c.json({ error: 'nao_autenticado', msg: 'Inicia sessão.' }, 401);
  return u;
}

export function requireAdmin(c: any): Response | Ctx {
  const u = requireAuth(c);
  if (u instanceof Response) return u;
  if (!u.isAdmin) return c.json({ error: 'sem_permissao', msg: 'Apenas administração.' }, 403);
  return u;
}
