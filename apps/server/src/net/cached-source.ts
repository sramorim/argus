/**
 * Cache que preserva a proveniencia.
 *
 * Principio central do ARGUS: um resultado servido do cache tem de continuar a declarar
 * a sua fonte, senao parece inventado. Este helper garante que a fonte e registada
 * no log em qualquer caso (cache hit OU miss).
 */
import { cachedWith } from '../db.ts';
import type { SourceLog } from './provenance.ts';

function countOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v == null) return 0;
  return 1;
}

export interface CachedSourceArgs {
  log: SourceLog;
  srcId: string;
  label: string;
  url: string;
  key: string;
  ttl: number;
  /**
   * Como contar os dados para a matriz de fontes.
   * Por defeito infere do valor (array = comprimento, resto = 1).
   * Passe `false` quando a `fn` ja regista a fonte ela propria — nesse caso
   * apenas o cache hit e anotado aqui.
   */
  count?: number | false | ((v: unknown) => number);
}

export async function cachedSource<T>(args: CachedSourceArgs, fn: () => Promise<T>): Promise<T> {
  const { log, srcId, label, url, key, ttl, count } = args;
  const { value, cached } = await cachedWith(key, ttl, fn as () => Promise<unknown>);

  if (count === false) {
    // A `fn` registou a fonte no cache MISS. No cache HIT a `fn` nao corre, portanto
    // registamos aqui — caso contrario o resultado apareceria sem a sua fonte na matriz.
    if (cached) {
      log.sources.push({
        id: srcId, label, url, status: 'ok', ms: 0,
        count: countOf(value), note: 'servido do cache local',
      });
    }
    return value as T;
  }

  const n = typeof count === 'function' ? count(value) : (count ?? countOf(value));
  if (n === 0) log.empty(srcId, label, url, 0, cached ? 'cache (vazio)' : 'sem resultados');
  else log.ok(srcId, label, url, 0, n, cached ? 'servido do cache local' : undefined);
  return value as T;
}
