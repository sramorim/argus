/**
 * Diff de snapshots — NEW | REMOVED | CHANGED | UNCHANGED.
 *
 * Comparação profunda entre dois documentos capturados. Duas decisões:
 *
 *  - **Listas de valores comparam por conjunto**, não por posição: se a ordem
 *    mudou mas o conteúdo é o mesmo, não é alteração (uma lista de links que
 *    muda de ordem não é "link novo").
 *  - **Objetos comparam por chave**, recursivamente, com o caminho completo —
 *    `atributos.bio` mudou é mais útil do que "mudou alguma coisa".
 *
 * O resultado é dito: cada linha leva o estado e a nota do que aconteceu. Um
 * snapshot sem anterior não é um diff vazio — quem chama é que decide (ver
 * `radar.ts`).
 */
import type { FindingValue } from '../net/provenance.ts';
import type { Alteracao, EstadoItem } from './types.ts';

const MAX_ALTERACOES = 500;

function escalar(v: unknown): FindingValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v) as FindingValue;
}

function eListaDeScalares(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
}

function eObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Diferença entre duas listas de valores, por conjunto. */
function diffListas(caminho: string, a: unknown[], b: unknown[], out: Alteracao[]): void {
  const na = new Map(a.map((x) => [String(x), x]));
  const nb = new Map(b.map((x) => [String(x), x]));
  for (const [k, v] of na) {
    if (!nb.has(k)) out.push({ caminho: `${caminho}[${k}]`, estado: 'REMOVED', antes: escalar(v), depois: null, nota: 'valor presente antes e ausente agora' });
  }
  for (const [k, v] of nb) {
    if (!na.has(k)) out.push({ caminho: `${caminho}[${k}]`, estado: 'NEW', antes: null, depois: escalar(v), nota: 'valor novo neste snapshot' });
  }
  for (const [k, v] of na) if (nb.has(k)) out.push({ caminho: `${caminho}[${k}]`, estado: 'UNCHANGED', antes: escalar(v), depois: escalar(nb.get(k)), nota: 'sem alteração' });
}

/** Diff recursivo. `antes`/`depois` são JSON já serializáveis. */
export function diff(antes: unknown, depois: unknown, prefixo = '', out: Alteracao[] = []): Alteracao[] {
  if (out.length >= MAX_ALTERACOES) return out;

  if (eListaDeScalares(antes) && eListaDeScalares(depois)) {
    diffListas(prefixo || 'raiz', antes, depois, out);
    return out;
  }
  if (Array.isArray(antes) && Array.isArray(depois)) {
    const n = Math.max(antes.length, depois.length);
    for (let i = 0; i < n; i++) {
      const caminho = `${prefixo || 'raiz'}[${i}]`;
      if (i >= antes.length) out.push({ caminho, estado: 'NEW', antes: null, depois: escalar(depois[i]), nota: 'posição nova' });
      else if (i >= depois.length) out.push({ caminho, estado: 'REMOVED', antes: escalar(antes[i]), depois: null, nota: 'posição removida' });
      else diff(antes[i], depois[i], caminho, out);
    }
    return out;
  }
  if (eObjeto(antes) && eObjeto(depois)) {
    const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].sort();
    for (const k of chaves) {
      const caminho = prefixo ? `${prefixo}.${k}` : k;
      const temA = k in antes; const temD = k in depois;
      if (temA && !temD) out.push({ caminho, estado: 'REMOVED', antes: escalar(antes[k]), depois: null, nota: 'chave removida' });
      else if (!temA && temD) out.push({ caminho, estado: 'NEW', antes: null, depois: escalar(depois[k]), nota: 'chave nova' });
      else diff(antes[k], depois[k], caminho, out);
    }
    return out;
  }
  const igual = JSON.stringify(antes) === JSON.stringify(depois);
  out.push({
    caminho: prefixo || 'raiz',
    estado: igual ? 'UNCHANGED' : 'CHANGED',
    antes: escalar(antes), depois: escalar(depois),
    nota: igual ? 'sem alteração' : 'valor substituído',
  });
  return out;
}

/** Só o que mudou — o que a maior parte dos ecrãs quer mostrar. */
export function soAlteracoes(l: Alteracao[]): Alteracao[] {
  return l.filter((a) => a.estado !== 'UNCHANGED');
}

export interface ResumoDiff {
  NEW: number; REMOVED: number; CHANGED: number; UNCHANGED: number;
  total: number; alteracoes: number;
}

export function resumoDiff(l: Alteracao[]): ResumoDiff {
  const r: ResumoDiff = { NEW: 0, REMOVED: 0, CHANGED: 0, UNCHANGED: 0, total: l.length, alteracoes: 0 };
  for (const a of l) r[a.estado]++;
  r.alteracoes = r.NEW + r.REMOVED + r.CHANGED;
  return r;
}

export const ESTADOS: EstadoItem[] = ['NEW', 'REMOVED', 'CHANGED', 'UNCHANGED'];
