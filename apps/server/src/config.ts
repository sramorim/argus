/**
 * Configuracao de producao. Fonte unica de verdade no arranque.
 *
 * Regra do projeto: em producao o que nao estiver explicito e um erro, nunca um palpite.
 * Por isso: `NODE_ENV=production` sem `ARGUS_SECRET` forte NAO arranca. E mais honesto
 * falhar no arranque do que servir sessions e chaves BYOK com um segredo de exemplo.
 */

function str(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v.trim();
}

function bool(name: string, def: boolean): boolean {
  const v = str(name)?.toLowerCase();
  if (v === undefined) return def;
  if (['1', 'true', 'sim', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'nao', 'no', 'off'].includes(v)) return false;
  return def;
}

function int(name: string, def: number): number {
  const v = Number(str(name));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

function list(name: string): string[] {
  const v = str(name);
  if (!v) return [];
  return v.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

export const isProd = (str('NODE_ENV') ?? 'development') === 'production';

const DEV_SECRET = 'probe-dev-secret-change-in-production';
const DEV_DB = 'data/argus.db';
/** Onde o disco persistente do Render e montado por omissao. */
export const RENDER_DISK_MOUNT = '/var/data';

// ---------- falha cedo ----------
const fatal: string[] = [];
const warn: string[] = [];

const secret = str('ARGUS_SECRET') ?? (isProd ? '' : DEV_SECRET);
if (isProd) {
  if (!secret) fatal.push('ARGUS_SECRET nao definido. Gere um segredo: openssl rand -hex 32');
  else if (secret === DEV_SECRET) fatal.push('ARGUS_SECRET ainda e o valor de exemplo. Mude-o.');
  else if (secret.length < 32) fatal.push(`ARGUS_SECRET tem ${secret.length} caracteres; minimo 32.`);
}

/**
 * Caminho do SQLite. Em produção aponta para o disco persistente.
 *
 * A validação olha para o valor **cru**: um caminho relativo continua relativo. Se
 * a validação fosse feita sobre o caminho já resolvido, `data/argus.db` em
 * produção passaria a verificação (vira `/app/data/argus.db`, que é absoluto) e
 * o serviço escreveria no disco efemérico do contentor — apagando tudo a cada
 * deploy, sem um único aviso.
 */
const dbPathRaw = str('ARGUS_DB') ?? (isProd ? `${RENDER_DISK_MOUNT}/argus.db` : DEV_DB);
const dbPath = dbPathRaw.startsWith('/') || dbPathRaw.startsWith('./') || dbPathRaw.startsWith('../')
  ? dbPathRaw
  : `${process.cwd()}/${dbPathRaw}`;

if (isProd && !dbPathRaw.startsWith('/')) {
  fatal.push(`ARGUS_DB tem de ser um caminho ABSOLUTO em producao (recebi "${dbPathRaw}"). ` +
    `Um caminho relativo aponta para o disco efemérico do contentor e o banco apaga-se a cada deploy. ` +
    `No Render o disco persistente monta em ${RENDER_DISK_MOUNT}.`);
}

/**
 * O cookie de sessão tem de ser `Secure` sempre que o servidor estiver exposto.
 *
 * A excepção é deliberada e estreita: quando o processo escuta **apenas em
 * loopback**, o tráfego nunca sai da máquina, e um cookie sem `Secure` é
 * necessário para o smoke test de produção local (que fala HTTP a 127.0.0.1).
 * Se o bind for 0.0.0.0 — como o Render faz — e `Secure` estiver desligado,
 * isso é configuração insegura e o arranque é recusado.
 */
const bindHost = str('HOST') ?? '0.0.0.0';
const soLoopback = /^(127\.|::1$|localhost$)/.test(bindHost);
const cookieSecure = bool('ARGUS_COOKIE_SECURE', isProd);
if (isProd && !cookieSecure && !soLoopback) {
  fatal.push('ARGUS_COOKIE_SECURE=false em producao expoe a sessao. Remova a variavel (so e aceito com HOST em loopback, para teste local).');
}
if (isProd && !cookieSecure && soLoopback) {
  warn.push(`Cookie sem Secure: aceite porque o servidor so escuta em ${bindHost} (loopback, nunca exposto).`);
}

if (isProd && dbPath.includes('/app/')) {
  warn.push(`ARGUS_DB (${dbPath}) parece efemero: num deploy novo o ficheiro apaga-se. Monte o disco em ${RENDER_DISK_MOUNT}.`);
}

const allowedOrigins = list('ARGUS_ALLOWED_ORIGINS');
if (allowedOrigins.includes('*')) {
  fatal.push("ARGUS_ALLOWED_ORIGINS nao aceita '*' ( credentials + wildcard sao inseguros). Liste os dominios.");
}

/**
 * Canal de contacto público (WhatsApp).
 *
 * Fica no ambiente e não no código, para corrigir um número não exigir
 * reconstruir o frontend. O `label` é derivado do número, por isso não há como
 * os dois divergirem — que foi exactamente o que aconteceu com o número
 * anterior, escrito à mão em dois sítios diferentes.
 *
 * Aceita só o formato que interessa: 55 + DDD(2) + 9 dígitos (celular BR) ou
 * + 8 dígitos (fixo). Qualquer outra coisa é recusada no arranque, em vez de
 * gerar um link de wa.me que não abre para ninguém.
 */
const CONTACTO_WA_DEFAULT = '5547997876098';
function normalizarWa(v: string): { digitos: string; ok: boolean; erro?: string } {
  let d = v.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d{12,13}$/.test(d)) {
    return { digitos: '', ok: false, erro: `tem de ter 12 ou 13 digitos em formato internacional (ex.: ${CONTACTO_WA_DEFAULT}), recebi "${v}"` };
  }
  if (!d.startsWith('55')) {
    return { digitos: '', ok: false, erro: `tem de começar por 55 (Brasil), recebi "${v}"` };
  }
  const ddd = d.slice(2, 4);
  const resto = d.slice(4);
  if (resto.length !== 8 && resto.length !== 9) {
    return { digitos: '', ok: false, erro: `o numero tem de ter 8 (fixo) ou 9 (celular) digitos depois do DDD, recebi "${v}"` };
  }
  // Celular tem 9 digitos e começa obrigatoriamente por 9.
  if (resto.length === 9 && resto[0] !== '9') {
    return { digitos: '', ok: false, erro: `celular brasileiro tem 9 digitos e comeca por 9, recebi "${v}"` };
  }
  // E um fixo NUNCA começa por 9. Um numero de 8 digitos que comece por 9 é um
  // celular a que falta um digito — foi exactamente o erro que estava em
  // produção, e que passava despercebido na validação anterior.
  if (resto.length === 8 && resto[0] === '9') {
    return { digitos: '', ok: false, erro: `8 digitos a comecar por 9 e um celular com um digito em falta (o numero certo tem 9 digitos), recebi "${v}"` };
  }
  return { digitos: d, ok: true };
}

const waBruto = str('ARGUS_CONTACTO_WHATSAPP') ?? CONTACTO_WA_DEFAULT;
const wa = normalizarWa(waBruto);
if (!wa.ok) fatal.push(`ARGUS_CONTACTO_WHATSAPP invalido: ${wa.erro}`);

/** "(47) 99787-6098" a partir de "5547997876098". */
function rotuloWa(d: string): string {
  const ddd = d.slice(2, 4);
  const r = d.slice(4);
  const g = r.length === 9 ? `${r.slice(0, 5)}-${r.slice(5)}` : `${r.slice(0, 4)}-${r.slice(4)}`;
  return `WhatsApp (${ddd}) ${g}`;
}

export const CONTACTO_WHATSAPP = wa.ok ? wa.digitos : CONTACTO_WA_DEFAULT;
export const CONTACTO_LABEL = wa.ok ? rotuloWa(wa.digitos) : `WhatsApp (47) 99787-6098`;

export const config = {
  isProd,
  env: str('NODE_ENV') ?? 'development',
  port: int('PORT', 8787),
  host: bindHost,
  dbPath,
  secret,
  webDist: str('ARGUS_WEB_DIST') ?? 'auto',
  publicOrigin: str('ARGUS_PUBLIC_ORIGIN')?.replace(/\/+$/, ''),
  allowedOrigins,
  /** Em producao ha sempre um proxy (Render) a frente. */
  trustProxy: bool('ARGUS_TRUST_PROXY', isProd),
  contacto: {
    whatsapp: CONTACTO_WHATSAPP,
    label: CONTACTO_LABEL,
  },
  // A marca é "SR. Amorim" (com ponto). O nome legal da pessoa fica no
  // ARGUS_AUTHOR_LEGAL, que não é mostrado no site.
  autor: {
    nome: str('ARGUS_AUTHOR') ?? 'SR. Amorim',
    link: str('ARGUS_AUTHOR_LINK'),
    copyright: `© ${new Date().getFullYear()} ${str('ARGUS_AUTHOR') ?? 'SR. Amorim'}`,
    legal: str('ARGUS_AUTHOR_LEGAL') ?? 'Daniel Senhor Amorim',
  },
  cookie: {
    /** __Host- exige Secure + Path=/ + sem Domain: um cookie de sessao nao pode ser plantado por um subdominio. */
    name: cookieSecure ? '__Host-argus_session' : 'argus_session',
    secure: cookieSecure,
    sameSite: str('ARGUS_COOKIE_SAMESITE') ?? 'Lax',
    maxAgeDays: int('ARGUS_SESSION_DAYS', 30),
  },
  rateLimit: {
    /** Tentativas de login por IP na janela. */
    authMax: int('ARGUS_AUTH_MAX', 10),
    /** Contas criadas por IP na janela (criar contas em massa é o ataque). */
    registerMax: int('ARGUS_REGISTER_MAX', 5),
    windowMin: int('ARGUS_AUTH_WINDOW_MIN', 15),
  },
  fatal,
  warn,
} as const;

if (fatal.length) {
  console.error('\n[ARGUS] Configuracao de producao invalida:');
  for (const f of fatal) console.error(`  - ${f}`);
  console.error('\nVer .env.example. O servidor nao arrancou.\n');
  process.exit(1);
}

/** Relatorio legivel do arranque. Nao imprime segredos. */
export function configReport(tools: number): string {
  const linhas = [
    `env=${config.env}`,
    `bind=${config.host}`,
    `porta=${config.port}`,
    `host=${config.host}`,
    `db=${config.dbPath}`,
    `cookie=${config.cookie.name} secure=${config.cookie.secure} samesite=${config.cookie.sameSite} ${config.cookie.maxAgeDays}d`,
    `origens=${config.allowedOrigins.length ? config.allowedOrigins.join(', ') : 'mesma origem (sem CORS)'}`,
    `contacto=${config.contacto.label} wa.me/${config.contacto.whatsapp}`,
    `autor=${config.autor.copyright}`,
    `rate_limit=login ${config.rateLimit.authMax} + registo ${config.rateLimit.registerMax} por ${config.rateLimit.windowMin}min`,
    `trust_proxy=${config.trustProxy}`,
    `ferramentas=${tools}`,
  ];
  return linhas.join(' | ');
}

export function configWarnings(): string[] {
  const out = [...warn];
  if (isProd && !config.publicOrigin) out.push('ARGUS_PUBLIC_ORIGIN nao definido (so aparece no log de arranque).');
  return out;
}
