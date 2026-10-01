/**
 * Presence Radar — o que mudou na presença pública de um alvo.
 *
 * Compara o snapshot anterior com o atual e devolve exatamente o que o spec
 * pede: novas plataformas, novos perfis, posts, comentários, menções, links,
 * mudanças de bio e mudanças de contas — cada um com o estado
 * `NEW | REMOVED | CHANGED` e a nota do que se observou.
 *
 * Duas honestidades obrigatórias:
 *
 *  - **Sem anterior não há radar.** `temAnterior: false` diz-se como tal; não
 *    se devolve "nada mudou", que seria mentira com a mesma cara.
 *  - **Radar não vigia ninguém.** Ele compara o que o ARGOS já observou em
 *    execuções anteriores; não tem canal nenhum para notificar a pessoa.
 */
import { diff, resumoDiff, soAlteracoes } from './diff.ts';
import type { Alteracao, EstadoItem } from './types.ts';
import type { DocumentoSnapshot } from './snapshots.ts';

export type Categoria =
  | 'plataforma' | 'perfil' | 'post' | 'comentario' | 'mencao' | 'link' | 'bio' | 'conta' | 'outro';

export interface Detetado {
  categoria: Categoria;
  estado: EstadoItem;
  valor: string;
  antes: string | null;
  depois: string | null;
  nota: string;
}

export interface Radar {
  temAnterior: boolean;
  detetados: Detetado[];
  resumo: { NEW: number; REMOVED: number; CHANGED: number; UNCHANGED: number; alteracoes: number };
  nota: string;
  comparadoEm: string;
}

/** Do caminho do diff para a categoria que o ecrã mostra. */
export function categoriaDe(caminho: string): Categoria {
  if (caminho.startsWith('plataformas')) return 'plataforma';
  if (caminho.startsWith('perfis')) return 'perfil';
  if (caminho.startsWith('posts')) return 'post';
  if (caminho.startsWith('comentarios')) return 'comentario';
  if (caminho.startsWith('mencoes')) return 'mencao';
  if (caminho.startsWith('links')) return 'link';
  if (/^bio(\.|$)/.test(caminho)) return 'bio';
  if (caminho.startsWith('contas')) return 'conta';
  return 'outro';
}

const ORDEM: Categoria[] = ['plataforma', 'perfil', 'conta', 'bio', 'post', 'comentario', 'mencao', 'link', 'outro'];

function valorTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function radar(antes: DocumentoSnapshot | null, atual: DocumentoSnapshot): Radar {
  const quando = new Date().toISOString();
  if (!antes) {
    return {
      temAnterior: false, detetados: [],
      resumo: { NEW: 0, REMOVED: 0, CHANGED: 0, UNCHANGED: 0, alteracoes: 0 },
      nota: 'Primeira observação deste alvo: não há snapshot anterior, por isso não se afirma que nada mudou.',
      comparadoEm: quando,
    };
  }

  const alteracoes: Alteracao[] = soAlteracoes(diff(antes.dados, atual.dados));
  const detetados: Detetado[] = alteracoes.map((a) => ({
    categoria: categoriaDe(a.caminho),
    estado: a.estado,
    valor: a.caminho,
    antes: a.antes === null ? null : valorTexto(a.antes),
    depois: a.depois === null ? null : valorTexto(a.depois),
    nota: a.nota,
  })).sort((x, y) => ORDEM.indexOf(x.categoria) - ORDEM.indexOf(y.categoria) || x.valor.localeCompare(y.valor));

  const r = resumoDiff(diff(antes.dados, atual.dados));
  const nota = detetados.length
    ? `${detetados.length} alteração(ões) entre ${antes.capturadoEm} e ${atual.capturadoEm}. Comparação local entre snapshots do ARGOS — não é monitorização da pessoa.`
    : `Sem alterações entre ${antes.capturadoEm} e ${atual.capturadoEm}: o estado observado é idêntico ao anterior.`;

  return { temAnterior: true, detetados, resumo: r, nota, comparadoEm: quando };
}
