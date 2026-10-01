/**
 * Entity Resolution — decidir que duas entidades podem ser a mesma pessoa.
 *
 * A regra que governa o ficheiro inteiro está escrita no topo de cada
 * resolução: **nunca se afirma "é a mesma pessoa"**. Sai um par, uma faixa de
 * confiança e a lista de fatores com o peso e a razão de cada um. O
 * investigador decide; o motor não decide por ele.
 *
 * Sinais usados (todos verificáveis nos atributos das duas entidades):
 *   identificador igual · identificador parecido · email · telefone ·
 *   nome · bio · avatar · domínio · link cruzado
 *
 * Nada disto é calculado sem evidência: `pontuar()` derruba para
 * `UNCONFIRMED` qualquer score cuja origem seja só o nosso código.
 */
import { pontuar } from './confidence.ts';
import { type Confianca, type Entidade, type Evidencia, type Fator, type Resolucao, agora } from './types.ts';

const DIACRITICOS = /[̀-ͯ]/g;

/** Minúsculas, sem acentos, sem espaços laterais. */
export function normalizar(s: string): string {
  return String(s ?? '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim();
}

/** Palavras com pelo menos 3 caracteres — "de", "da" não são sinal. */
export function tokens(s: string): Set<string> {
  return new Set(normalizar(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

/** Jaccard sobre tokens: 0 = nada em comum, 1 = igual. */
export function similaridade(a: string, b: string): number {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Igualdade normalizada, com tamanho mínimo para não casar por acaso. */
export function mesmoIndicador(a?: string, b?: string): boolean {
  const x = normalizar(a ?? ''); const y = normalizar(b ?? '');
  return x.length > 2 && x === y;
}

/**
 * Evidencia do lado: deriva da observacao REAL da entidade (`evidencias[0]`).
 * Sem observacao declarada nao ha nada a citar — e quem nao tem fonte nao
 * ganha confianca por ter atributos bonitos.
 */
function evidenciaPar(nota: string, lado: Entidade): Evidencia[] {
  const base = lado.evidencias[0];
  if (!base) return [];
  return [{
    fonte: lado.rotulo,
    url: lado.atributos.url ?? lado.atributos.profileUrl ?? base.url,
    provider: base.provider || lado.provider,
    timestamp: base.timestamp,
    nota: `${base.nota} · ${nota}`,
  }];
}

function dominioDe(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

const NOTA_PAR = 'Comparação entre entidades com base em dados públicos: indica correspondência, nunca identidade.';

/** Comparação completa de um par. Pura. */
export function comparar(a: Entidade, b: Entidade): Resolucao {
  const fatores: Fator[] = [];
  const evidencias: Evidencia[] = [];

  const add = (f: Fator, ...evs: Evidencia[]) => { fatores.push(f); evidencias.push(...evs); };

  const ua = a.atributos.username; const ub = b.atributos.username;
  if (mesmoIndicador(ua, ub)) {
    add({ nome: 'identificador igual', peso: 6, explica: `o mesmo username em ${a.rotulo} e ${b.rotulo}` },
      ...evidenciaPar(`username "${ua}" observado em ${a.rotulo}`, a), ...evidenciaPar(`username "${ub}" observado em ${b.rotulo}`, b));
  } else if (ua && ub && similaridade(ua, ub) >= 0.8) {
    add({ nome: 'identificador parecido', peso: 3, explica: `usernames parecidos (${Math.round(similaridade(ua, ub) * 100)}%)` },
      ...evidenciaPar(`username "${ua}"`, a), ...evidenciaPar(`username "${ub}"`, b));
  }

  const ea = a.atributos.email; const eb = b.atributos.email;
  if (mesmoIndicador(ea, eb)) {
    add({ nome: 'email igual', peso: 10, explica: 'o mesmo endereço de email público nas duas entidades' },
      ...evidenciaPar(`email "${ea}"`, a), ...evidenciaPar(`email "${eb}"`, b));
  }

  const ta = a.atributos.telefone; const tb = b.atributos.telefone;
  if (mesmoIndicador(ta, tb)) {
    add({ nome: 'telefone igual', peso: 10, explica: 'o mesmo número público nas duas entidades' },
      ...evidenciaPar(`telefone "${ta}"`, a), ...evidenciaPar(`telefone "${tb}"`, b));
  }

  const na = a.atributos.nome; const nb = b.atributos.nome;
  if (mesmoIndicador(na, nb)) {
    add({ nome: 'nome igual', peso: 5, explica: 'o mesmo nome público nas duas entidades' },
      ...evidenciaPar(`nome "${na}"`, a), ...evidenciaPar(`nome "${nb}"`, b));
  } else if (na && nb && similaridade(na, nb) >= 0.7) {
    add({ nome: 'nome parecido', peso: 3, explica: `nomes parecidos (${Math.round(similaridade(na, nb) * 100)}%)` },
      ...evidenciaPar(`nome "${na}"`, a), ...evidenciaPar(`nome "${nb}"`, b));
  }

  const ba = a.atributos.bio; const bb = b.atributos.bio;
  if (ba && bb && similaridade(ba, bb) >= 0.5) {
    add({ nome: 'bio parecida', peso: 3, explica: `descrições públicas com ${Math.round(similaridade(ba, bb) * 100)}% de sobreposição` },
      ...evidenciaPar('bio pública', a), ...evidenciaPar('bio pública', b));
  }

  const av = a.atributos.avatar; const bv = b.atributos.avatar;
  if (av && bv && av === bv) {
    add({ nome: 'avatar igual', peso: 5, explica: 'a mesma imagem de perfil nas duas entidades' },
      ...evidenciaPar('avatar público', a), ...evidenciaPar('avatar público', b));
  }

  const da = a.atributos.url ? dominioDe(a.atributos.url) : null;
  const db = b.atributos.url ? dominioDe(b.atributos.url) : null;
  if (da && db && da === db && da.length > 3) {
    add({ nome: 'mesmo domínio', peso: 4, explica: `ambos apontam para ${da}` },
      ...evidenciaPar(`link ${da}`, a), ...evidenciaPar(`link ${da}`, b));
  }

  const textoB = Object.values(b.atributos).join(' ');
  const textoA = Object.values(a.atributos).join(' ');
  const urlA = a.atributos.url ?? a.atributos.profileUrl;
  const urlB = b.atributos.url ?? b.atributos.profileUrl;
  if (urlA && textoB.includes(urlA)) {
    add({ nome: 'link cruzado', peso: 6, explica: `${b.rotulo} publica um link para ${a.rotulo}` },
      ...evidenciaPar(`link citado em ${b.rotulo}`, b));
  }
  if (urlB && textoA.includes(urlB)) {
    add({ nome: 'link cruzado', peso: 6, explica: `${a.rotulo} publica um link para ${b.rotulo}` },
      ...evidenciaPar(`link citado em ${a.rotulo}`, a));
  }

  const p = pontuar(fatores, evidencias);
  return {
    a: a.id, b: b.id, confianca: p.confianca, total: p.total,
    fatores: p.fatores, evidencias, nota: `${NOTA_PAR} ${p.explicacao}`,
  };
}

export const ORDEM_CONFIANCA: Record<Confianca, number> = { UNCONFIRMED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Todos os pares acima do limiar, do mais forte para o mais fraco. */
export function resolver(entidades: Entidade[], minima: Confianca = 'LOW'): Resolucao[] {
  const limite = ORDEM_CONFIANCA[minima];
  const out: Resolucao[] = [];
  for (let i = 0; i < entidades.length; i++) {
    for (let j = i + 1; j < entidades.length; j++) {
      const r = comparar(entidades[i], entidades[j]);
      if (ORDEM_CONFIANCA[r.confianca] >= limite && r.fatores.length) out.push(r);
    }
  }
  return out.sort((x, y) => y.total - x.total || x.a.localeCompare(y.a));
}
