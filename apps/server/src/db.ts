/** DB: sqlite nativo. Utilizadores, sessoes, chaves BYOK (cifradas), investigacoes, cache. */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { mkdirSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

// O caminho vem do ambiente: em producao aponta para o disco persistente.
// Sem isto, o ficheiro vive no disco efemero do container e apaga-se a cada deploy.
const DB_PATH = config.dbPath;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
// Sem busy_timeout, dois pedidos ao mesmo tempo dao SQLITE_BUSY e o utilizador ve um erro 500.
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');
try {
  db.exec('PRAGMA journal_mode = WAL');
} catch {
  // Alguns volumes de rede nao suportam WAL (falta mmap partilhado). Nao e motivo para
  // cair: TRUNCATE journal e mais lento mas correto. Fica registado no log.
  db.exec('PRAGMA journal_mode = TRUNCATE');
  console.warn(`[ARGUS] WAL indisponivel em ${DB_PATH}; a usar journal_mode=TRUNCATE.`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS user_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, provider)
);
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  seed_type TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  inv_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  confidence TEXT NOT NULL,
  hop INTEGER NOT NULL DEFAULT 0,
  attrs TEXT
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  inv_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Rede social: a ULTIMA lista de seguidores observada por utilizador/alvo.
-- As APIs do Bluesky e do Mastodon nao dizem QUANDO alguem passou a seguir — so
-- devolvem a lista. Sem guardar a observacao anterior e impossivel responder a
-- "quem acabou de seguir", que e a pergunta real. Uma linha por combinacao
-- (upsert), nao um historico: guarda-se o minimo necessario para comparar.
CREATE TABLE IF NOT EXISTS snapshots (
  user_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (user_id, tool, target, kind)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_at ON snapshots(at);
CREATE INDEX IF NOT EXISTS idx_usage_user_at ON usage(user_id, at);
CREATE INDEX IF NOT EXISTS idx_usage_at ON usage(at);
CREATE INDEX IF NOT EXISTS idx_runs_user_at ON runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_inv ON nodes(inv_id);
CREATE INDEX IF NOT EXISTS idx_edges_inv ON edges(inv_id);
CREATE INDEX IF NOT EXISTS idx_invs_user ON investigations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---------- migrações incrementais ----------
// Um deploy não pode partir por um `CREATE TABLE` que já existe: as colunas novas
// entram com `ALTER TABLE ... ADD COLUMN`, que é idempotente (se a coluna já
// existir, o SQLite dá erro de "duplicate column" e nós ignoramos).
function addColumn(table: string, column: string, decl: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  } catch (e: any) {
    if (!/duplicate column name/i.test(String(e?.message))) {
      console.warn(`[ARGUS] migracao ${table}.${column} falhou: ${e?.message}`);
    }
  }
}
addColumn('investigations', 'run_id', 'TEXT');
addColumn('investigations', 'node_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('investigations', 'edge_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('investigations', 'tools', 'TEXT');
// FASE F: o plano de investigação e o progresso da sua execução. Guardados na
// própria linha para que reler a investigação não dependa de mais nada.
addColumn('investigations', 'plano', 'TEXT');
addColumn('investigations', 'progresso', 'TEXT');
addColumn('users', 'suspended', 'INTEGER NOT NULL DEFAULT 0');

// ---------- statements preparadas em cache ----------
// `db.prepare()` reconstrói e recompila a cada chamada. Numa rota quente (quota,
// autenticação) isso é trabalho deitado fora. Cache pequeno e limitado.
const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();
export function q(sql: string) {
  let st = stmtCache.get(sql);
  if (!st) {
    st = db.prepare(sql);
    if (stmtCache.size < 200) stmtCache.set(sql, st);
  }
  return st;
}

// ---------- crypto helpers ----------
// O segredo vem do ambiente. Nao ha valor de exemplo em producao: o config.ts recusa arrancar
// sem ARGUS_SECRET. Mudar o secret invalida as sessoes e a cifragem das chaves BYOK.
const SECRET = config.secret;

function hashPass(pw: string, salt = randomBytes(16).toString('hex')): string {
  const h = scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${h}`;
}
export function verifyPass(pw: string, stored: string): boolean {
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex');
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const newPasswordHash = (pw: string) => hashPass(pw);

export function tokenHash(t: string): string {
  return createHmac('sha256', SECRET).update(t).digest('hex');
}
export const newToken = () => randomBytes(32).toString('base64url');

const KEY_MATERIAL = createHmac('sha256', SECRET).update('byok-encryption').digest();
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY_MATERIAL, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}
export function decryptSecret(payload: string): string {
  const [ivb, encb, tagb] = payload.split('.');
  const d = createDecipheriv('aes-256-gcm', KEY_MATERIAL, Buffer.from(ivb!, 'base64url'));
  d.setAuthTag(Buffer.from(tagb!, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(encb!, 'base64url')), d.final()]).toString('utf8');
}

// ---------- cache ----------
export function cacheGet(key: string): unknown | null {
  const row = db.prepare('SELECT body, expires_at FROM cache WHERE key = ?').get(key) as
    | { body: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM cache WHERE key = ?').run(key); return null; }
  try { return JSON.parse(row.body); } catch { return null; }
}
export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  const exp = Date.now() + ttlSeconds * 1000;
  db.prepare('INSERT INTO cache(key, body, expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, expires_at=excluded.expires_at')
    .run(key, JSON.stringify(value), exp);
}

// ---------- observações de rede social ----------
/**
 * A última lista de seguidores observada para um alvo.
 *
 * Só guardamos **handles**, nunca conteúdo: a pergunta que se quer responder é
 * "quem passou a seguir desde a última vez", e para isso basta a diferença
 * entre duas listas. Uma linha por utilizador/alvo (upsert), pelo que o consumo
 * é fixo — não é um histórico que cresce.
 */
export interface Snapshot { members: string[]; at: string }

export function snapshotGet(
  userId: string, tool: string, target: string, kind: string,
): Snapshot | null {
  const row = q('SELECT payload, at FROM snapshots WHERE user_id = ? AND tool = ? AND target = ? AND kind = ?')
    .get(userId, tool, target, kind) as { payload: string; at: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload);
    if (!Array.isArray(parsed)) return null;
    return { members: parsed.map(String), at: row.at };
  } catch { return null; }
}

export function snapshotPut(
  userId: string, tool: string, target: string, kind: string, members: string[],
): void {
  const at = new Date().toISOString();
  q(`INSERT INTO snapshots(user_id, tool, target, kind, payload, at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(user_id, tool, target, kind) DO UPDATE SET payload=excluded.payload, at=excluded.at`)
    .run(userId, tool, target, kind, JSON.stringify(members.slice(0, 1000)), at);
}

// ---------- snapshots do Intel (documento JSON, nao so listas) ----------
/**
 * A mesma tabela `snapshots`, outro contrato: o Intel guarda um DOCUMENTO
 * (perfil unificado, presenca), nao uma lista de handles. `snapshotGet` acima
 * exige array de strings e rejeita o resto — por isso estes dois helperes
 * existem: nao se amolda um documento a um contrato que nao e' o dele.
 */
export interface IntelSnapshotRow { dados: unknown; at: string }

export function intelSnapshotGet(
  userId: string, tool: string, target: string, kind: string,
): IntelSnapshotRow | null {
  const row = q('SELECT payload, at FROM snapshots WHERE user_id = ? AND tool = ? AND target = ? AND kind = ?')
    .get(userId, tool, target, kind) as { payload: string; at: string } | undefined;
  if (!row) return null;
  try { return { dados: JSON.parse(row.payload), at: row.at }; } catch { return null; }
}

export function intelSnapshotPut(
  userId: string, tool: string, target: string, kind: string, dados: unknown,
): void {
  const at = new Date().toISOString();
  q(`INSERT INTO snapshots(user_id, tool, target, kind, payload, at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(user_id, tool, target, kind) DO UPDATE SET payload=excluded.payload, at=excluded.at`)
    .run(userId, tool, target, kind, JSON.stringify(dados ?? null), at);
}

/**
 * Cache com dedupe de inflight: evita que N pedidos simultaneos batam na mesma API gratuita.
 * `cachedWith` devolve tambem se veio do cache, para que a proveniencia continue correcta
 * (um resultado servido do cache tem de continuar a declarar a sua fonte).
 */
const inflight = new Map<string, Promise<unknown>>();
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  return (await cachedWith(key, ttlSeconds, fn)).value;
}

export async function cachedWith<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  const hit = cacheGet(key);
  if (hit !== null) return { value: hit as T, cached: true };
  const existing = inflight.get(key);
  if (existing) return { value: (await existing) as T, cached: false };
  const p = fn()
    .then((v) => { if (v !== null) cacheSet(key, v, ttlSeconds); return v; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return { value: (await p) as T, cached: false };
}

// ---------- limpeza periodica ----------
/**
 * O SQLite é um ficheiro num disco de 1 GB no Render. Sem poda, `usage`, `runs`
 * e `cache` crescem sem limite e o deploy acaba por ficar sem espaço — ou, pior,
 * por ficar lento. A poda corre no arranque e de duas em duas horas.
 */
export function prune(opts: { keepUsageDays?: number; keepRunsPerUser?: number } = {}): { usage: number; runs: number; cache: number; sessions: number; snapshots: number } {
  const usageDays = opts.keepUsageDays ?? 90;
  const keepRuns = opts.keepRunsPerUser ?? 200;
  const r = { usage: 0, runs: 0, cache: 0, sessions: 0, snapshots: 0 };
  const cut = new Date(Date.now() - usageDays * 86_400_000).toISOString();
  const n = (x: number | bigint) => Number(x);
  r.usage = n(q('DELETE FROM usage WHERE at < ?').run(cut).changes);
  // Cada utilizador fica com as `keepRuns` execuções mais recentes.
  r.runs = n(q(`DELETE FROM runs WHERE id IN (
      SELECT r.id FROM runs r
      WHERE r.user_id IN (SELECT user_id FROM runs GROUP BY user_id HAVING COUNT(*) > ?)
        AND r.id NOT IN (SELECT id FROM runs x WHERE x.user_id = r.user_id ORDER BY created_at DESC LIMIT ?)
    )`).run(keepRuns, keepRuns).changes);
  r.cache = n(q('DELETE FROM cache WHERE expires_at < ?').run(Date.now() - 3600_000).changes);
  r.sessions = n(q('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()).changes);
  // Observações de rede: uma linha por utilizador/alvo, mas alvos esquecidos
  // continuam a ocupar disco. Passados 90 dias a comparação já não interessa.
  r.snapshots = n(q('DELETE FROM snapshots WHERE at < ?').run(cut).changes);
  return r;
}

// ---------- saude e encerramento ----------
/**
 * O disco tem de aceitar escrita: e o que separa "a app arrancou" de "a app serve dados".
 * O health check do Render usa isto — sem disco montado, o servico deve ficar UNHEALTHY
 * e nao aceitar utilizadores para depois perder tudo no proximo deploy.
 */
export function dbHealth(): { path: string; writable: boolean; note?: string } {
  try {
    accessSync(DB_PATH, constants.W_OK);
    return { path: DB_PATH, writable: true };
  } catch {
    return { path: DB_PATH, writable: false, note: 'o ficheiro do SQLite nao tem permissao de escrita' };
  }
}

/**
 * Fecho orderly. O Render manda SIGTERM antes de cada deploy e de cada scale-down;
 * sem isto o WAL fica por fazer checkpoint e o ultimo registo pode perder-se.
 */
export function closeDb(): void {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  try { db.close(); } catch {}
}
