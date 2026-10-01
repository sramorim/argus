/**
 * Correlation Engine — cruzar indicadores públicos entre entidades.
 *
 * Correlaciona: usernames, nomes, URLs, links cruzados, bios, emails públicos,
 * domínios, plataformas e avatares. A regra do spec é cumprida aqui:
 * **cada correlação tem evidência**. Sem evidências, `pontuar()` devolve
 * `UNCONFIRMED` e a correlação aparece como o que é — um valor repetido, não
 * uma conclusão.
 *
 * Uma correlação nunca diz "é a mesma pessoa"; diz "este valor aparece em N
 * entidades" e mostra as origens que o observaram.
 */
import { pontuar } from './confidence.ts';
import { normalizar, similaridade } from './entities.ts';
import type { Confianca, Correlacao, Entidade, Evidencia, Fator, TipoCorrelacao } from './types.ts';

/** Peso base por tipo: identificadores fortes valem mais que textos livres. */
const PESO_BASE: Record<TipoCorrelacao, number> = {
  email: 10, telefone: 10, username: 6, avatar: 5, nome: 5, url: 4,
  dominio: 4, 'link-cruzado': 6, bio: 3, plataforma: 2,
};

const ATRIBUTO_PARA_TIPO: Record<string, TipoCorrelacao> = {
  username: 'username', usuario: 'username', nome: 'nome', name: 'nome',
  email: 'email', telefone: 'telefone', phone: 'telefone',
  url: 'url', profileUrl: 'url', link: 'url', dominio: 'dominio',
  bio: 'bio', descricao: 'bio', avatar: 'avatar', foto: 'avatar',
};

export interface Indicador {
  tipo: TipoCorrelacao;
  valor: string;
  normalizado: string;
}

/** Indicadores públicos de uma entidade, já normalizados. */
export function indicadores(e: Entidade): Indicador[] {
  const out: Indicador[] = [];
  for (const [chave, bruto] of Object.entries(e.atributos)) {
    const tipo = ATRIBUTO_PARA_TIPO[chave];
    if (!tipo || !bruto || !bruto.trim()) continue;
    out.push({ tipo, valor: bruto.trim(), normalizado: normalizar(bruto) });
  }
  for (const p of e.plataformas) {
    if (p) out.push({ tipo: 'plataforma', valor: p, normalizado: normalizar(p) });
  }
  return out;
}

const NOTA = 'Mostra que o mesmo valor aparece em mais do que uma entidade; nao afirma que as entidades sao a mesma pessoa.';

function evidenciasDe(entidades: Entidade[], tipo: TipoCorrelacao): Evidencia[] {
  const evs: Evidencia[] = [];
  for (const e of entidades) {
    for (const orig of e.evidencias) evs.push({ ...orig, nota: `${orig.nota} - ${tipo} em ${e.rotulo}` });
  }
  return evs.slice(0, 8);
}

function fatoresPara(tipo: TipoCorrelacao, n: number, contexto: string): Fator[] {
  return [
    { nome: `valor partilhado (${tipo})`, peso: PESO_BASE[tipo] + (n - 1) * 2, explica: `o mesmo ${tipo} em ${n} entidades: ${contexto}` },
    { nome: 'fontes declaradas', peso: 2, explica: 'cada entidade traz a origem que a forneceu' },
  ];
}

function chaveDe(tipo: TipoCorrelacao, norm: string): string {
  return tipo + ' ' + norm;
}

/**
 * Agrupa indicadores identicos e devolve uma correlacao por valor repetido.
 * Um valor que so aparece numa entidade nao e correlacao — fica de fora.
 */
export function correlacionar(entidades: Entidade[]): Correlacao[] {
  const grupos = new Map<string, { tipo: TipoCorrelacao; valor: string; entidades: Entidade[] }>();
  for (const e of entidades) {
    for (const ind of indicadores(e)) {
      if (ind.tipo === 'plataforma') continue; // plataforma repetida e o caso, nao a prova
      const k = chaveDe(ind.tipo, ind.normalizado);
      const g = grupos.get(k);
      if (g) { if (!g.entidades.includes(e)) g.entidades.push(e); }
      else grupos.set(k, { tipo: ind.tipo, valor: ind.valor, entidades: [e] });
    }
  }

  const out: Correlacao[] = [];
  for (const g of grupos.values()) {
    if (g.entidades.length < 2) continue;
    const evs = evidenciasDe(g.entidades, g.tipo);
    const contexto = g.entidades.map((e) => e.rotulo).join(', ');
    const p = pontuar(fatoresPara(g.tipo, g.entidades.length, contexto), evs);
    out.push({
      tipo: g.tipo, valor: g.valor, entidades: g.entidades.map((e) => e.id),
      confianca: p.confianca, total: p.total, fatores: p.fatores, evidencias: evs,
      nota: `${NOTA} ${p.explicacao}`,
    });
  }

  // links cruzados: o link de uma entidade aparece no texto de outra
  for (const origem of entidades) {
    const url = origem.atributos.url ?? origem.atributos.profileUrl;
    if (!url) continue;
    for (const alvo of entidades) {
      if (alvo.id === origem.id) continue;
      const texto = Object.values(alvo.atributos).join(' ');
      if (!texto.includes(url)) continue;
      const repetido = out.some((c) => c.tipo === 'link-cruzado' && c.valor === url
        && c.entidades.includes(origem.id) && c.entidades.includes(alvo.id));
      if (repetido) continue;
      const evs = evidenciasDe([origem, alvo], 'link-cruzado');
      const p = pontuar(fatoresPara('link-cruzado', 2, `${alvo.rotulo} publica ${url}`), evs);
      out.push({
        tipo: 'link-cruzado', valor: url, entidades: [origem.id, alvo.id],
        confianca: p.confianca, total: p.total, fatores: p.fatores, evidencias: evs,
        nota: `${NOTA} ${p.explicacao}`,
      });
    }
  }

  return out.sort((a, b) => b.total - a.total || a.tipo.localeCompare(b.tipo));
}

/** Bios parecidas entre entidades diferentes — indicador, nao prova. */
export function biosParecidas(entidades: Entidade[], limiar = 0.5): Correlacao[] {
  const out: Correlacao[] = [];
  for (let i = 0; i < entidades.length; i++) {
    for (let j = i + 1; j < entidades.length; j++) {
      const a = entidades[i]; const b = entidades[j];
      const ba = a.atributos.bio; const bb = b.atributos.bio;
      if (!ba || !bb) continue;
      const s = similaridade(ba, bb);
      if (s < limiar) continue;
      const evs = evidenciasDe([a, b], 'bio');
      const p = pontuar([
        { nome: 'bio parecida', peso: 3, explica: `${Math.round(s * 100)}% de sobreposicao entre as descricoes publicas` },
        { nome: 'fontes declaradas', peso: 2, explica: 'as duas entidades trazem origem' },
      ], evs);
      out.push({
        tipo: 'bio', valor: `${ba.slice(0, 60)} / ${bb.slice(0, 60)}`,
        entidades: [a.id, b.id], confianca: p.confianca, total: p.total,
        fatores: p.fatores, evidencias: evs, nota: `${NOTA} ${p.explicacao}`,
      });
    }
  }
  return out;
}

/** Faixa mais alta de um conjunto de correlacoes (para o resumo do perfil). */
export function confiancaMaxima(l: { confianca: Confianca }[]): Confianca {
  const ordem: Confianca[] = ['UNCONFIRMED', 'LOW', 'MEDIUM', 'HIGH'];
  return l.reduce<Confianca>((m, x) => (ordem.indexOf(x.confianca) > ordem.indexOf(m) ? x.confianca : m), 'UNCONFIRMED');
}
