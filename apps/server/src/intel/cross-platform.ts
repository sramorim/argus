/**
 * Cross-platform — o mesmo identificador em várias plataformas.
 *
 * Resposta útil: "este username aparece em N plataformas, com estes URLs".
 * Resposta proibida: "é a mesma pessoa". Por isso a saída traz a faixa de
 * confiança e uma nota que diz explicitamente o que o cruzamento não prova —
 * usernames são reutilizáveis, e é precisamente isso que mata investigações.
 */
import { normalizar, similaridade } from './entities.ts';
import { pontuar } from './confidence.ts';
import type { Confianca, Entidade, Evidencia } from './types.ts';

export interface Presenca {
  plataforma: string;
  username: string;
  url: string | null;
  entidade: string;
  /** true quando bate com o identificador dominante. */
  mesmoIdentificador: boolean;
  confianca: Confianca;
}

export interface Cruzamento {
  identificador: string | null;
  presencas: Presenca[];
  totalPlataformas: number;
  iguais: number;
  confianca: Confianca;
  nota: string;
}

/** Só cita o que a entidade observou de facto; sem fonte, não há evidência. */
function evDe(e: Entidade, nota: string): Evidencia[] {
  const base = e.evidencias[0];
  if (!base) return [];
  return [{ ...base, nota: `${base.nota} · ${nota}` }];
}

/** Identificador dominante: o que mais se repete, normalizado. */
export function identificadorDominante(entidades: Entidade[]): string | null {
  const contagem = new Map<string, { bruto: string; n: number }>();
  for (const e of entidades) {
    const u = e.atributos.username;
    if (!u) continue;
    const k = normalizar(u);
    const c = contagem.get(k);
    if (c) c.n++; else contagem.set(k, { bruto: u, n: 1 });
  }
  const melhor = [...contagem.values()].sort((a, b) => b.n - a.n)[0];
  return melhor ? melhor.bruto : null;
}

export function cruzar(entidades: Entidade[]): Cruzamento {
  const dominante = identificadorDominante(entidades);
  const kDom = dominante ? normalizar(dominante) : '';
  const presencas: Presenca[] = [];

  for (const e of entidades) {
    const u = e.atributos.username;
    if (!u) continue;
    // sem plataforma declarada não há presença que cruzar
    if (!e.plataformas.length) continue;
    const plataformas = e.plataformas;
    const igual = !!kDom && normalizar(u) === kDom;
    const parecido = !igual && !!kDom && similaridade(u, dominante ?? '') >= 0.85;
    const confianca: Confianca = igual ? 'MEDIUM' : (parecido ? 'LOW' : 'UNCONFIRMED');
    for (const plataforma of plataformas) {
      presencas.push({
        plataforma, username: u, url: e.atributos.url ?? e.atributos.profileUrl ?? null,
        entidade: e.id, mesmoIdentificador: igual, confianca,
      });
    }
  }

  const plataformas = new Set(presencas.map((p) => p.plataforma));
  const iguais = presencas.filter((p) => p.mesmoIdentificador).length;
  const evs = entidades.slice(0, 4).flatMap((e) => evDe(e, `identificador ${e.atributos.username ?? '-'} em plataformas ${e.plataformas.join(', ')}`));
  const p = pontuar([
    { nome: 'identificador repetido', peso: iguals2(iguais), explica: `o mesmo username em ${iguais} presenças` },
    { nome: 'plataformas distintas', peso: Math.min(6, plataformas.size * 2), explica: `${plataformas.size} plataforma(s) observada(s)` },
    { nome: 'fontes declaradas', peso: 2, explica: 'cada presença cita a ferramenta que a forneceu' },
  ], evs);

  const nota = plataformas.size >= 2 && iguais >= 2
    ? `O identificador "${dominante}" aparece em ${iguais} presenças de ${plataformas.size} plataformas. Isto NÃO prova que é a mesma pessoa: usernames são reutilizáveis e esta é a razão mais comum de atribuição errada.`
    : 'Cruzamento insuficiente para afirmar correspondência entre plataformas.';

  return {
    identificador: dominante,
    presencas: presencas.sort((a, b) => a.plataforma.localeCompare(b.plataforma)),
    totalPlataformas: plataformas.size,
    iguais,
    confianca: p.confianca,
    nota: `${nota} ${p.explicacao}`,
  };
}

function iguals2(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 5;
  if (n === 3) return 8;
  return 10;
}
