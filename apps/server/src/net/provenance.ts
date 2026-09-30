/**
 * Camada de proveniencia: todo resultado carrega de onde veio, quando, e com que confianca.
 * Distingue indicio de prova. Nunca inventa.
 */

export type Confidence = 'confirmed' | 'corroborated' | 'indicated' | 'weak';

export type SourceStatus = 'ok' | 'empty' | 'skipped' | 'error' | 'needs_key' | 'timeout';

export interface Source {
  id: string;
  label: string;
  url: string;
  status: SourceStatus;
  ms?: number;
  note?: string;
  count?: number;
}

export interface Evidence {
  kind: 'fact' | 'inference' | 'claim';
  confidence: Confidence;
  sourceIds: string[];
  at: string;
}

/** Valor de um achado: escalar ou estrutura (o frontend serializa para JSON). */
export type FindingValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FindingValue[]
  | { [k: string]: FindingValue };

export interface Finding {
  id: string;
  group: string;
  label: string;
  value: FindingValue;
  evidence: Evidence;
  link?: string;
}

export interface ToolRun {
  /** Preenchido pelo executor (permite ligar a execução a uma investigação). */
  id?: string;
  toolId: string;
  input: Record<string, string>;
  at: string;
  ms: number;
  ok: boolean;
  sources: Source[];
  findings: Finding[];
  notes: string[];
}

const CONF_RANK: Record<Confidence, number> = {
  confirmed: 4,
  corroborated: 3,
  indicated: 2,
  weak: 1,
};

export function confScore(c: Confidence): number {
  return CONF_RANK[c];
}

let counter = 0;
export function newFindingId(prefix = 'f'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Registra uma fonte consultada com sucesso. */
export class SourceLog {
  readonly sources: Source[] = [];
  readonly notes: string[] = [];

  ok(id: string, label: string, url: string, ms: number, count?: number, note?: string): void {
    this.sources.push({ id, label, url, status: count === 0 ? 'empty' : 'ok', ms, count, note });
  }

  empty(id: string, label: string, url: string, ms: number, note?: string): void {
    this.sources.push({ id, label, url, status: 'empty', ms, note });
  }

  skipped(id: string, label: string, url: string, note: string): void {
    this.sources.push({ id, label, url, status: 'skipped', note });
  }

  needsKey(id: string, label: string, url: string, note = 'Requer a sua propria chave (BYOK) para esta fonte'): void {
    this.sources.push({ id, label, url, status: 'needs_key', note });
  }

  error(id: string, label: string, url: string, note: string, ms?: number): void {
    this.sources.push({ id, label, url, status: 'error', note, ms });
  }

  /**
   * Regista explicitamente que os resultados vieram de CALCULO LOCAL (parse, validacao,
   * hash, DCT, normalizacao) e nao de uma fonte remota.
   *
   * Isto é obrigatorio: sem esta entrada, um achado que cita `local` aparece com uma
   * fonte que nao existe na matriz — o que parece invenção. O principio do ARGUS e que
   * a origem de tudo é declarada, mesmo quando a origem é o próprio código.
   */
  local(count?: number, note?: string): void {
    this.sources.push({
      id: 'local',
      label: 'Processamento local (sem fonte remota)',
      url: 'local',
      status: count === 0 ? 'empty' : 'ok',
      ms: 0,
      count,
      note,
    });
  }

  note(text: string): void {
    this.notes.push(text);
  }

  /**
   * Corre confidence por corroboracao: N fontes independentes concordantes elevam.
   */
  corroborate(count: number): Confidence {
    if (count >= 3) return 'corroborated';
    if (count >= 2) return 'corroborated';
    if (count === 1) return 'indicated';
    return 'weak';
  }
}

export function evidence(
  kind: Evidence['kind'],
  sourceIds: string[],
  confidence?: Confidence,
): Evidence {
  return {
    kind,
    sourceIds,
    confidence: confidence ?? (sourceIds.length >= 2 ? 'corroborated' : 'indicated'),
    at: new Date().toISOString(),
  };
}

export function finding(
  group: string,
  label: string,
  value: FindingValue,
  sourceIds: string[],
  opts: { kind?: Evidence['kind']; confidence?: Confidence; link?: string } = {},
): Finding {
  return {
    id: newFindingId(),
    group,
    label,
    value,
    evidence: evidence(opts.kind ?? 'fact', sourceIds, opts.confidence),
    link: opts.link,
  };
}
