/**
 * Feeds abertos de ameaça. Todos HTTPS, todos sem chave, todos públicos.
 *
 * Regra: um feed que responde 200 mas não tem dados é `empty`, nunca `ok`.
 * Foi o que aconteceu com o Feodo Tracker (565 bytes, só comentários, projeto
 * praticamente parado) — por isso saiu e entrou o ThreatFox no lugar dele.
 */
import { apiGet } from './ssrf.ts';
import { cachedWith } from '../db.ts';
import { SourceLog } from './provenance.ts';

export interface FeedResult<T> {
  value: T;
  cached: boolean;
  ms: number;
}

/** Lê um feed de texto linha a linha, com cache em disco. */
async function textFeed(
  log: SourceLog, id: string, label: string, url: string,
  ttl: number, timeoutMs: number, maxBytes: number,
): Promise<{ lines: string[]; cached: boolean; ms: number; ok: boolean; note?: string }> {
  const key = `feed:${id}`;
  // O tempo medido é o do download a sério, e vai guardado com o texto: um
  // resultado servido do cache tem de continuar a declarar quanto tempo levou a
  // obtê-lo, senão a matriz de fontes mostra "1 ms" num fetch de 6 MB que
  // levou segundos. Chamar `Date.now()` no fim daria sempre ~0.
  const hit = await cachedWith<{ text: string; status: number; ms: number }>(key, ttl, async () => {
    const t0 = Date.now();
    const r = await apiGet(url, { timeoutMs, maxBytes });
    const ms = Date.now() - t0;
    if (r.status !== 200) return { text: '', status: r.status, ms };
    return { text: r.body, status: 200, ms };
  });
  const { ms } = hit.value;
  if (hit.value.status !== 200) {
    log.error(id, label, url, `HTTP ${hit.value.status}`, ms);
    return { lines: [], cached: hit.cached, ms, ok: false, note: `HTTP ${hit.value.status}` };
  }
  const lines = hit.value.text.split('\n').map((l) => l.trim()).filter(Boolean);
  // Linhas de comentário (`#`) e cabeçalhos CSV não são IOCs.
  const real = lines.filter((l) => !l.startsWith('#'));
  if (real.length) {
    // A nota diz o TTL real: os feeds não têm todos a mesma validade.
    const nota = hit.cached ? `cache local (${Math.round(ttl / 60)} min)` : undefined;
    log.ok(id, label, url, ms, real.length, nota);
    return { lines: real, cached: hit.cached, ms, ok: true };
  }
  log.empty(id, label, url, ms, hit.cached ? `cache: feed sem entradas (${Math.round(ttl / 60)} min)` : 'feed sem entradas');
  return { lines: [], cached: hit.cached, ms, ok: true, note: 'feed sem entradas' };
}

// ---------------- ThreatFox (C2 / malware) ----------------
export interface ThreatFoxIoc { ip: string; port: number | null; domain: string | null; url: string | null; type: string; threat: string; malware: string | null; lastSeen: string; confidence: string }

const TF_COLS = ['first_seen_utc', 'ioc_id', 'ioc_value', 'ioc_type', 'threat_type', 'fk_malware', 'malware_alias', 'malware_printable', 'last_seen_utc', 'confidence_level', 'is_compromised', 'reference', 'tags', 'anonymous', 'reporter'];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function threatFox(log: SourceLog): Promise<ThreatFoxIoc[]> {
  const r = await textFeed(
    log, 'threatfox', 'abuse.ch ThreatFox (C2/malware, ultimos 7 dias)',
    'https://threatfox.abuse.ch/export/csv/recent/', 3600, 20_000, 6_000_000,
  );
  if (!r.lines.length) return [];
  const out: ThreatFoxIoc[] = [];
  for (const line of r.lines) {
    if (!line.startsWith('"')) continue;
    const c = parseCsvLine(line);
    if (c.length < 10) continue;
    const rec: Record<string, string> = {};
    TF_COLS.forEach((k, i) => { rec[k] = c[i] ?? ''; });
    const value = rec['ioc_value'] ?? '';
    const type = rec['ioc_type'] ?? '';
    const o: ThreatFoxIoc = {
      ip: '', port: null, domain: null, url: null, type,
      threat: rec['threat_type'] ?? '', malware: rec['malware_printable'] || rec['fk_malware'] || null,
      lastSeen: rec['last_seen_utc'] ?? '', confidence: rec['confidence_level'] ?? '',
    };
    if (type.startsWith('ip')) {
      const [ip, port] = value.split(':');
      o.ip = ip ?? ''; o.port = port ? Number(port) : null;
    } else if (type.startsWith('domain')) {
      o.domain = value;
    } else if (type.startsWith('url')) {
      try { const u = new URL(value); o.url = value; o.domain = u.hostname; o.ip = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? u.hostname : ''; o.port = u.port ? Number(u.port) : null; } catch { o.url = value; }
    } else continue;
    if (o.ip || o.domain) out.push(o);
  }
  return out;
}

// ---------------- URLhaus (URLs de malware) ----------------
export interface UrlhausRow { id: string; url: string; host: string; status: string; threat: string; malware: string; added: string }
const UH_COLS = ['id', 'date_added', 'url', 'url_status', 'last_online', 'threat', 'tags', 'urlhaus_link', 'reporter'];

export async function urlhaus(log: SourceLog): Promise<UrlhausRow[]> {
  const r = await textFeed(
    log, 'urlhaus', 'abuse.ch URLhaus (URLs de malware, recentes)',
    'https://urlhaus.abuse.ch/downloads/csv_recent/', 3600, 20_000, 9_000_000,
  );
  const out: UrlhausRow[] = [];
  for (const line of r.lines) {
    if (!line.startsWith('"')) continue;
    const c = parseCsvLine(line);
    if (c.length < 7) continue;
    const rec: Record<string, string> = {};
    UH_COLS.forEach((k, i) => { rec[k] = c[i] ?? ''; });
    let host = '';
    try { host = new URL(rec['url'] ?? '').hostname; } catch { host = ''; }
    if (!host) continue;
    out.push({ id: rec['id'] ?? '', url: rec['url'] ?? '', host, status: rec['url_status'] ?? '', threat: rec['threat'] ?? '', malware: rec['tags'] ?? '', added: rec['date_added'] ?? '' });
  }
  return out;
}

// ---------------- OpenPhish (phishing) ----------------
export async function openPhish(log: SourceLog): Promise<{ url: string; host: string }[]> {
  const r = await textFeed(
    log, 'openphish', 'OpenPhish (URLs de phishing)',
    'https://openphish.com/feed.txt', 3600, 15_000, 3_000_000,
  );
  const out: { url: string; host: string }[] = [];
  for (const line of r.lines) {
    if (line.startsWith('#') || !/^https?:\/\//i.test(line)) continue;
    try { out.push({ url: line, host: new URL(line).hostname }); } catch { /* linha invalida */ }
  }
  return out;
}

// ---------------- Lista de nos de saida do Tor ----------------
export async function torExits(log: SourceLog): Promise<string[]> {
  const r = await textFeed(
    log, 'tor-exits', 'Tor Project (nos de saida)',
    'https://check.torproject.org/torbulkexitlist', 6 * 3600, 15_000, 3_000_000,
  );
  const out: string[] = [];
  for (const line of r.lines) {
    if (line.startsWith('#')) continue;
    // O ficheiro tem "IP porta data" separada por espaço
    const ip = line.split(/\s+/)[0];
    if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) out.push(ip);
  }
  return out;
}
