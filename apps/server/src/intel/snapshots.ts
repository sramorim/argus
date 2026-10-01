/**
 * Snapshots — o que se observou, guardado para poder ser comparado depois.
 *
 * Um snapshot é um documento JSON com chaves ordenadas (para que a comparação
 * seja estável), o alvo e o instante. Sem anterior não há radar: a primeira
 * captura apenas regista o estado de partida, e quem consome tem de tratar
 * isso como "primeira observação", não como "nada mudou".
 *
 * A persistência usa a tabela `snapshots` já existente (upsert por
 * utilizador/ferramenta/alvo/kind): uma linha por chave, portanto o que se
 * guarda é sempre o último estado — histórico não é prometido porque não é
 * guardado.
 */
import { intelSnapshotGet, intelSnapshotPut } from '../db.ts';
import type { PerfilUnificado } from './unified.ts';

export const FORMATO = 'argos-snapshot-1';

export interface DocumentoSnapshot {
  formato: typeof FORMATO;
  alvo: string;
  capturadoEm: string;
  dados: unknown;
}

/** Chaves ordenadas recursivamente: igualdade estrutural é comparável. */
export function normalizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = normalizar(o[k]);
    return out;
  }
  return v;
}

export function capturar(alvo: string, dados: unknown, quando = new Date().toISOString()): DocumentoSnapshot {
  return { formato: FORMATO, alvo, capturadoEm: quando, dados: normalizar(dados) };
}

/** Estado de partida da presença de um perfil (o que o radar compara). */
export interface Presenca {
  plataformas: string[];
  perfis: { plataforma: string; username: string; url: string | null }[];
  posts: string[];
  comentarios: string[];
  mencoes: string[];
  links: string[];
  contas: string[];
  bio: string;
}

export function presencaDe(perfil: PerfilUnificado): Presenca {
  const perfis = perfil.contas
    .filter((c) => c.plataforma !== 'desconhecida')
    .map((c) => ({ plataforma: c.plataforma, username: c.username ?? '', url: c.url }))
    .sort((a, b) => (a.plataforma + a.username).localeCompare(b.plataforma + b.username));
  const posts = perfil.evidencias.filter((e) => /post|tweet|publica[cç][aã]o/i.test(e.nota)).map((e) => e.url ?? e.nota);
  const mencoes = perfil.evidencias.filter((e) => /men[cç]|mention/i.test(e.nota)).map((e) => e.url ?? e.nota);
  const links = [...new Set(perfil.entidades.flatMap((e) => Object.values(e.atributos).filter((v) => /^https?:\/\//i.test(v))))].sort();
  return {
    plataformas: [...new Set(perfis.map((p) => p.plataforma))].sort(),
    perfis,
    posts: [...new Set(posts)].sort(),
    comentarios: [],
    mencoes: [...new Set(mencoes)].sort(),
    links,
    contas: perfis.map((p) => `${p.plataforma}:${p.username}`),
    bio: perfil.atributos.bio ?? '',
  };
}

/** Guarda/carega o último snapshot de um alvo (tabela `snapshots`). */
export function guardar(userId: string, alvo: string, doc: DocumentoSnapshot, kind = 'presenca'): void {
  intelSnapshotPut(userId, 'intel', alvo, kind, doc);
}

export function carregar(userId: string, alvo: string, kind = 'presenca'): DocumentoSnapshot | null {
  const row = intelSnapshotGet(userId, 'intel', alvo, kind);
  if (!row) return null;
  const d = row.dados as Partial<DocumentoSnapshot> | null;
  if (!d || typeof d !== 'object' || d.formato !== FORMATO) return null;
  return { formato: FORMATO, alvo: d.alvo ?? alvo, capturadoEm: d.capturadoEm ?? row.at, dados: d.dados ?? null };
}
