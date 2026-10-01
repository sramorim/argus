/**
 * Confidence Scoring — a pontuação que sustenta as faixas de confiança.
 *
 * Duas decisões de desenho, ambas por causa do erro mais caro do OSINT:
 *
 *  1. **A confiança é uma faixa, não um número que se vende.** Sai
 *     `HIGH | MEDIUM | LOW | UNCONFIRMED`, com a lista de fatores que a
 *     produziram — o investigador vê o porquê, não só a etiqueta.
 *  2. **Sem evidência não há confiança, por mais fatores que existam.** Um
 *     score alto com zero origens declaradas fica `UNCONFIRMED`: só o nosso
 *     código achou, e o nosso código não é fonte.
 *
 * `UNCONFIRMED` nunca é um erro — é a resposta honesta a "não sei".
 */
import type { Confianca, Evidencia, Fator } from './types.ts';

export interface Pontuacao {
  confianca: Confianca;
  total: number;
  /** Fatores explicados, do mais pesado para o mais leve. */
  explicacao: string;
  fatores: Fator[];
}

/** Limiares. Documentados porque mudá-los muda resultados — não se mexe às cegas. */
export const LIMIARES = {
  HIGH: 12,
  MEDIUM: 7,
  LOW: 3,
  /** Número mínimo de evidências (origens) para uma faixa alta. */
  EVIDENCIAS_HIGH: 2,
} as const;

export function pontuar(fatores: Fator[], evidencias: Evidencia[]): Pontuacao {
  const ordenados = [...fatores].sort((a, b) => b.peso - a.peso);
  const total = ordenados.reduce((s, f) => s + f.peso, 0);
  const origens = new Set(evidencias.map((e) => e.provider || e.fonte)).size;
  const explicacao = ordenados.length
    ? ordenados.map((f) => `${f.nome} (+${f.peso}): ${f.explica}`).join(' · ')
    : 'nenhum sinal observado';

  let confianca: Confianca = 'UNCONFIRMED';
  if (total >= LIMIARES.HIGH && origens >= LIMIARES.EVIDENCIAS_HIGH) confianca = 'HIGH';
  else if (total >= LIMIARES.MEDIUM && origens >= 1) confianca = 'MEDIUM';
  else if (total >= LIMIARES.LOW && origens >= 1) confianca = 'LOW';
  else if (total > 0 && origens === 0) confianca = 'UNCONFIRMED';

  if (origens === 0 && total > 0) {
    return {
      confianca: 'UNCONFIRMED', total, fatores: ordenados,
      explicacao: `${explicacao} · sem evidência declarada: o sinal veio só do nosso código, por isso fica por confirmar`,
    };
  }
  if (total >= LIMIARES.HIGH && origens < LIMIARES.EVIDENCIAS_HIGH) {
    return {
      confianca: confianca === 'HIGH' ? 'MEDIUM' : confianca, total, fatores: ordenados,
      explicacao: `${explicacao} · score ${total} mas só ${origens} origem(ns) independente(s): sem segunda origem não há faixa alta`,
    };
  }
  return { confianca, total, explicacao, fatores: ordenados };
}

/** Fraude clássica: transformar confiança em afirmação. Isto é o antídoto. */
export function comoFrase(confianca: Confianca, sujeito: string): string {
  switch (confianca) {
    case 'HIGH': return `${sujeito}: correspondência forte entre as entidades, com evidências independentes.`;
    case 'MEDIUM': return `${sujeito}: correspondência provável, a confirmar com mais uma origem.`;
    case 'LOW': return `${sujeito}: correspondência fraca — indício, não conclusão.`;
    default: return `${sujeito}: sem evidência suficiente para afirmar correspondência.`;
  }
}

/** Junta fatores de duas origens sem duplicar nomes. */
export function juntarFatores(...listas: Fator[][]): Fator[] {
  const vistos = new Map<string, Fator>();
  for (const l of listas) for (const f of l) {
    const atual = vistos.get(f.nome);
    if (atual) atual.peso = Math.max(atual.peso, f.peso);
    else vistos.set(f.nome, { ...f });
  }
  return [...vistos.values()];
}
