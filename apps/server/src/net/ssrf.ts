/**
 * SSRF guard + fetch seguro.
 *
 * ── O que este modulo garante ────────────────────────────────────────────────
 * 1. Só liga a endereços PÚBLICOS. Valida **todos** os IPs resolvidos (não só o
 *    primeiro) e revalida em cada redirect.
 * 2. **Pinning de DNS**: a resolução é feita uma vez, validada, e o socket é
 *    ligado ao IP validado com `lookup` fixo. O nome do host já não é resolvido
 *    pelo cliente HTTP — isto fecha a janela de DNS rebinding que existia quando
 *    isto usava `fetch` nativo (o undici voltava a resolver o hostname).
 *    O TLS continua a validar o certificado contra o hostname original (SNI),
 *    portanto o pinning não enfraquece a autenticação do canal.
 * 3. Limites de tempo (total e de inatividade), de tamanho (bytes lidos) e de
 *    redirects.
 * 4. Só http/https. Qualquer outro esquema é recusado antes de abrir o socket.
 *
 * ── O que este modulo NÃO garante (e porquê) ────────────────────────────────
 * O ARGUS consulta, por natureza, endereços escolhidos pelo utilizador. O
 * guard impede alcançar a rede interna; não impede o utilizador de sondar
 * hosts públicos. A conformidade é questão de uso, por isso a app declara
 * "uso defensivo" e cada ferramenta tem `legalGate`.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { URL } from 'node:url';

export class SsrfError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SsrfError'; }
}

function v4Blocked(ip: string): string | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'malformed-ipv4';
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return 'this-network';
  if (a === 10) return 'private-10';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local-metadata';
  if (a === 172 && b >= 16 && b <= 31) return 'private-172';
  if (a === 192 && b === 168) return 'private-192';
  if (a === 192 && b === 0) return 'ietf-192';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat-100';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmark-198';
  if (a === 192 && b === 88) return '6to4-relay';
  if (a === 198 && b === 51) return 'test-198';
  if (a === 203 && b === 0) return 'ietf-203';
  if (a >= 224) return 'multicast';
  return null;
}

/**
 * Expande um IPv6 para 8 grupos de 16 bits. Devolve null se não for IPv6 válido.
 * Escrever isto à mão é chato, mas é a única forma de fechar a classe de bypass
 * "endereço escrito de outra forma" (::ffff:7f00:1, ::ffff:127.0.0.1, NAT64,
 * 6to4) — todas as quais resolves para 127.0.0.1.
 */
export function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (s.includes('%')) s = s.slice(0, s.indexOf('%')); // remove zona (fe80::1%eth0)
  // Forma com IPv4 embutido no fim (::ffff:127.0.0.1) — converter para 2 grupos.
  const dotted = s.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) {
    const o = dotted[2]!.split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${dotted[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (head.some((x) => x === '' || (x.length > 1 && x.startsWith('0')))) return null;
  const num = (t: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
    return parseInt(t, 16);
  };
  const h = head.map(num); const t = tail.map(num);
  if (h.some((x) => x === null) || t.some((x) => x === null)) return null;
  const g = [...(h as number[]), ...(t as number[])];
  if (parts.length === 1) return g.length === 8 ? g : null;
  const fill = 8 - g.length;
  if (fill < 0) return null;
  return [...(h as number[]), ...Array<number>(fill).fill(0), ...(t as number[])];
}

function v4FromGroups(g: number[], at: number): string {
  return `${g[at]! >> 8}.${g[at]! & 255}.${g[at + 1]! >> 8}.${g[at + 1]! & 255}`;
}

function v6Blocked(ip: string): string | null {
  const g = expandIpv6(ip);
  if (!g) return 'malformed-ipv6';
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return 'unspecified-v6';
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return v4Blocked(v4FromGroups(g, 6)) ?? 'v4-mapped';   // ::ffff:127.0.0.1
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return 'loopback-v6';
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return 'v4-compatible-v6';                             // ::7f00:1  == 127.0.0.1
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return v4Blocked(v4FromGroups(g, 6)) ?? 'nat64';        // 64:ff9b::/96
  }
  if (g0 === 0x2002) {
    return v4Blocked(v4FromGroups(g, 1)) ?? '6to4';         // 2002:7f00:0001::/48
  }
  if (g0 === 0x2001 && g1 === 0x0db8) return 'documentation-v6';
  if (g0 === 0x2001 && g1 === 0x0000) return 'teredo-v6';
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return 'discard-v6';
  if ((g0 & 0xffc0) === 0xfec0) return 'site-local-v6';
  if ((g0 & 0xfe00) === 0xfc00) return 'unique-local-v6';
  if ((g0 & 0xffc0) === 0xfe80) return 'link-local-v6';
  if ((g0 & 0xff00) === 0xff00) return 'multicast-v6';
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 1) && g6 === 0) {
    return 'loopback-v6';
  }
  return null;}

export function classifyIp(ip: string): string | null {
  const fam = net.isIP(ip);
  if (fam === 4) return v4Blocked(ip);
  if (fam === 6) return v6Blocked(ip);
  return 'not-an-ip';
}

export interface PublicHost {
  /** IPs já validados, por ordem de preferência. */
  ips: string[];
  family: number;
}

/** Resolve e valida um hostname. Todos os IPs têm de ser públicos. */
export async function assertPublicHost(host: string): Promise<{ ip: string; family: number }> {
  const h = (await resolvePublicHost(host)).ips[0]!;
  return { ip: h, family: net.isIP(h) };
}

export async function resolvePublicHost(host: string): Promise<PublicHost> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) throw new SsrfError('host-vazio');
  let ips: string[];
  if (net.isIP(h)) {
    ips = [h];
  } else {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/.test(h)) {
      throw new SsrfError(`host-invalido:${h}`);
    }
    let res: { address: string; family: number }[];
    try {
      res = await dns.lookup(h, { all: true, verbatim: true });
    } catch {
      throw new SsrfError(`dns-fail:${h}`);
    }
    if (!res.length) throw new SsrfError(`dns-empty:${h}`);
    ips = res.map((r) => r.address);
  }
  // Todas as respostas precisam ser públicas (evita rebinding parcial por round-robin)
  for (const ip of ips) {
    const why = classifyIp(ip);
    if (why) throw new SsrfError(`blocked:${why}:${ip}`);
  }
  return { ips, family: net.isIP(ips[0]!) };
}

export interface SafeFetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Bytes originais (antes de qualquer conversão) — usar para binários. */
  raw: Buffer;
  truncated: boolean;
  bytes: number;
  ms: number;
  redirects: string[];
}

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** Headers Hop-by-Hop / de proxy que nunca se devem repassar. */
const STRIP_REQUEST = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

interface Hop {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  ms: number;
}

/**
 * Descomprime com TETO no conteúdo entregue, devolvendo o PEDÇO que coube.
 *
 * Isto não é cosmético: o dump de URLhaus tem ~3 MB e o limite por omissão de
 * uma chamada a API são 1,5 MB. Um "cortar o buffer e dar como lido" devolvia
 * corpo vazio — a ferramenta via "sem dados" quando na verdade leu 1,5 MB.
 * Zip bombs também são cortadas aqui, com `truncated` a dizer a verdade.
 */
function decompress(
  raw: Buffer, encoding: string | undefined, cap: number,
): Promise<{ out: Buffer; truncated: boolean }> {
  return new Promise((resolve) => {
    if (!encoding || raw.length === 0) {
      resolve({ out: raw.length > cap ? raw.subarray(0, cap) : raw, truncated: raw.length > cap });
      return;
    }
    const enc = encoding.toLowerCase();
    const mk = (): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | zlib.ZstdDecompress | null => {
      if (enc === 'gzip' || enc === 'x-gzip') return zlib.createGunzip();
      if (enc === 'deflate' || enc === 'x-deflate') return zlib.createInflate();
      if (enc === 'br') return zlib.createBrotliDecompress();
      if (enc === 'zstd') return zlib.createZstdDecompress();
      return null;
    };
    const z = mk();
    if (!z) { resolve({ out: raw.length > cap ? raw.subarray(0, cap) : raw, truncated: raw.length > cap }); return; }

    const chunks: Buffer[] = [];
    let n = 0;
    let truncated = false;
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve({ out: Buffer.concat(chunks), truncated }); } };

    z.on('data', (c: Buffer) => {
      const rest = cap + 1 - n;
      if (rest <= 0) { truncated = true; z.destroy(); return; }
      if (c.length > rest) { chunks.push(c.subarray(0, rest)); n = cap + 1; truncated = true; z.destroy(); return; }
      chunks.push(c);
      n += c.length;
    });
    z.on('end', finish);
    z.on('close', finish);
    z.on('error', () => {
      // Corpo comprimido que não abre: devolve o que já tínhamos (ou vazio).
      // Nunca lixo truncado a meio de um stream.
      if (!chunks.length) chunks.push(Buffer.alloc(0));
      finish();
    });
    z.end(raw);
  });
}

/**
 * Um pedido HTTP com o IP já validado e FIXADO no `lookup`.
 * A validação de certificado TLS continua a ser feita contra o hostname real
 * (servername), portanto aintegridade criptográfica não é relaxada.
 */
function requestOnce(
  url: URL,
  host: PublicHost,
  opts: SafeFetchOptions,
  budgetMs: number,
): Promise<Hop> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  // O teto vale para o conteúdo ENTREGUE. Na rede o limite é mais alto, porque
  // uma resposta comprimida legível pode ocupar muito menos no fio: cortar o
  // fio a `maxBytes` dava corpo truncado ilegível (aparentemente vazio) em gzip.
  const wireCap = Math.max(Math.min(maxBytes * 3, 48_000_000), 512_000);
  const timeoutMs = Math.max(500, Math.min(opts.timeoutMs ?? 15_000, budgetMs));
  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;

  const headers: Record<string, string> = { 'user-agent': DEFAULT_UA, accept: '*/*' };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (!STRIP_REQUEST.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  }
  headers['accept-encoding'] = 'gzip, deflate, br';
  // Host tem de ser o nome (não o IP): é o que o servidor espera e o que o
  // TLS valida. `setHost: false` impede o cliente de o inventar a partir do IP.
  headers['host'] = url.port ? `${url.hostname}:${url.port}` : url.hostname;

  return new Promise<Hop>((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: host.ips[0]!,
        port: url.port || (isHttps ? 443 : 80),
        method: opts.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        headers,
        // hostname/ip separados: o Host e o SNI ficam com o nome, o socket vai
        // para o IP já validado. É isto que fecha o DNS rebinding.
        servername: isHttps ? url.hostname : undefined,
        lookup: (_h, _o, cb) => cb(null, host.ips[0]!, net.isIP(host.ips[0]!)),
        setHost: false,
      },
      (res) => {
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        resHeaders['x-argus-final-host'] = host.ips[0]!;

        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncatedWire = false;
        res.on('data', (c: Buffer) => {
          bytes += c.length;
          if (bytes > wireCap) {
            chunks.push(c.subarray(0, c.length - (bytes - wireCap)));
            truncatedWire = true;
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const finish = async () => {
          const raw = Buffer.concat(chunks);
          const dec = await decompress(raw, resHeaders['content-encoding'], maxBytes);
          done(() => resolve({
            status: res.statusCode ?? 0,
            headers: resHeaders,
            body: dec.out,
            truncated: truncatedWire || dec.truncated,
            ms: Date.now() - started,
          }));
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (e) => done(() => reject(new SsrfError(`leitura:${e.message}`))));
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new SsrfError('timeout'));
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      done(() => {
        if (e instanceof SsrfError) reject(e);
        else if (e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT') reject(new SsrfError('timeout'));
        else if (e.code === 'ENOTFOUND') reject(new SsrfError(`dns-fail:${url.hostname}`));
        else reject(new SsrfError(`${e.code ?? 'erro'}:${e.message}`.slice(0, 80)));
      });
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Fetch seguro: valida e fixa cada hop, limita tamanho, tempo e redirects. */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const started = Date.now();
  const maxRedirects = opts.maxRedirects ?? 4;
  const totalBudget = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new SsrfError('url-invalida');
  }
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    throw new SsrfError(`protocol-not-allowed:${current.protocol}`);
  }
  const redirects: string[] = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const host = await resolvePublicHost(current.hostname);
    const left = totalBudget - (Date.now() - started);
    if (left <= 250) throw new SsrfError('timeout');
    const res = await requestOnce(current, host, opts, left);

    const isRedirect = res.status >= 300 && res.status < 400 && res.headers['location'];
    if (isRedirect && hop < maxRedirects) {
      let next: URL;
      try {
        next = new URL(res.headers['location']!, current);
      } catch {
        throw new SsrfError('redirect-invalido');
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new SsrfError(`protocol-not-allowed:${next.protocol}`);
      }
      // 303 (e 301/302 em POST) mudam o método para GET — como faz qualquer cliente.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && (opts.method ?? 'GET') === 'POST')) {
        opts = { ...opts, method: 'GET', body: undefined };
        delete (opts.headers as Record<string, string>)?.['content-type'];
      }
      redirects.push(current.toString());
      current = next;
      continue;
    }

    return {
      url: current.toString(),
      status: res.status,
      headers: res.headers,
      body: res.body.toString('utf8'),
      raw: res.body,
      truncated: res.truncated,
      bytes: res.body.length,
      ms: Date.now() - started,
      redirects,
    };
  }
  throw new SsrfError('too-many-redirects');
}

/** Fetch binário (imagens, ficheiros) com as mesmas garantias. */
export async function safeFetchBuffer(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<{ buffer: Buffer; contentType: string; status: number; url: string; ms: number; bytes: number }> {
  const r = await safeFetch(rawUrl, { ...opts, maxBytes: opts.maxBytes ?? 15_000_000 });
  return {
    buffer: r.raw,
    contentType: r.headers['content-type'] ?? 'application/octet-stream',
    status: r.status,
    url: r.url,
    ms: r.ms,
    bytes: r.bytes,
  };
}

/** Fetch para APIs conhecidas: timeout e tamanho por omissão mais apertados. */
export async function apiGet(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  return safeFetch(url, { timeoutMs: 12_000, maxBytes: 1_500_000, ...opts });
}

/** Erro de HTTP com o código preservado (distingue 404 de 401 sem parsear mensagem). */
export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string, msg?: string) {
    super(msg ?? `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

export async function apiJson<T = unknown>(url: string, opts: SafeFetchOptions = {}): Promise<T> {
  const r = await apiGet(url, { headers: { accept: 'application/json' }, ...opts });
  if (r.status < 200 || r.status >= 300) {
    throw new HttpError(r.status, r.url, `HTTP ${r.status}`);
  }
  try {
    return JSON.parse(r.body) as T;
  } catch {
    throw new HttpError(r.status, r.url, 'resposta nao e JSON valido');
  }
}
