/**
 * Relationships — ligações entre entidades, com tipo e confiança.
 *
 * Duas origens de ligações:
 *
 *  1. **Correlações** — o mesmo valor observado em duas entidades vira aresta
 *     `mesmo-indicador`, com a correlação inteira como evidência.
 *  2. **Declarações explícitas** — atributos `segue`, `menciona`, `responde`
 *     escritos numa entidade (comma-separated), que são afirmações da fonte,
 *     não inferências nossas.
 *
 * Cada aresta cita as evidências. Sem evidência, não há aresta: um grafo com
 * ligações por inventar é pior que um grafo vazio.
 */
import { pontuar } from './confidence.ts';
import type { Confianca, Correlacao, Entidade, Evidencia } from './types.ts';

export type TipoRelacao = 'segue' | 'menciona' | 'responde' | 'mesmo-indicador';

export interface Relacao {
  de: string;
  para: string;
  tipo: TipoRelacao;
  rotulo: string;
  confianca: Confianca;
  total: number;
  evidencias: Evidencia[];
  nota: string;
}

const DECLARADAS: Record<string, TipoRelacao> = {
  segue: 'segue', following: 'segue', menciona: 'menciona', mention: 'menciona',
  responde: 'responde', reply: 'responde',
};

function paraIds(bruto: string): string[] {
  return bruto.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Só cita observações reais da entidade — sem fonte, sem evidência. */
function evDe(e: Entidade, nota: string): Evidencia[] {
  const base = e.evidencias[0];
  if (!base) return [];
  return [{ ...base, nota: `${base.nota} · ${nota}` }];
}

export function relacionar(entidades: Entidade[], correlacoes: Correlacao[]): Relacao[] {
  const porId = new Map(entidades.map((e) => [e.id, e]));
  const saida: Relacao[] = [];
  const vistas = new Set<string>();

  // 1. correlações → mesmo-indicador
  for (const c of correlacoes) {
    for (let i = 0; i < c.entidades.length; i++) {
      for (let j = 0; j < c.entidades.length; j++) {
        if (i === j) continue;
        const de = c.entidades[i]; const para = c.entidades[j];
        const k = `${de}|${para}|${c.tipo}|${c.valor}`;
        if (vistas.has(k)) continue;
        vistas.add(k);
        if (!porId.has(de) || !porId.has(para)) continue;
        saida.push({
          de, para, tipo: 'mesmo-indicador', rotulo: `${c.tipo}: ${c.valor}`,
          confianca: c.confianca, total: c.total, evidencias: c.evidencias,
          nota: `Ligação por valor partilhado; não é declaração de relação pessoal. ${c.nota}`,
        });
      }
    }
  }

  // 2. declarações explícitas nas fontes
  for (const e of entidades) {
    for (const [chave, bruto] of Object.entries(e.atributos)) {
      const tipo = DECLARADAS[chave.toLowerCase()];
      if (!tipo || !bruto) continue;
      for (const alvo of paraIds(bruto)) {
        const destino = porId.get(alvo) ?? entidades.find((x) => x.id === alvo || x.atributos.username === alvo);
        if (!destino) continue;
        const k = `${e.id}|${destino.id}|${tipo}|declarada`;
        if (vistas.has(k)) continue;
        vistas.add(k);
        const evs = [...evDe(e, `fonte declara "${chave}: ${alvo}"`), ...destino.evidencias.slice(0, 2)];
        const p = pontuar([
          { nome: 'declaração da fonte', peso: 8, explica: `a origem afirma que ${e.rotulo} ${tipo} ${destino.rotulo}` },
          { nome: 'fontes declaradas', peso: 2, explica: 'a declaração e o destino têm origem identificada' },
        ], evs);
        saida.push({
          de: e.id, para: destino.id, tipo, rotulo: `${tipo} → ${destino.rotulo}`,
          confianca: p.confianca, total: p.total, evidencias: evs,
          nota: `${p.explicacao} Afirmação da fonte, não inferência do ARGOS.`,
        });
      }
    }
  }

  return saida.sort((a, b) => b.total - a.total || a.de.localeCompare(b.de));
}

/** Contagem por tipo, para o painel do grafo. */
export function resumoRelacoes(l: Relacao[]): { tipo: TipoRelacao; total: number }[] {
  const m = new Map<TipoRelacao, number>();
  for (const r of l) m.set(r.tipo, (m.get(r.tipo) ?? 0) + 1);
  return [...m.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total);
}
