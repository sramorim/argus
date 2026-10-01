/**
 * Tipos comuns do Intelligence Engine (FASE E).
 *
 * O motor inteiro assenta numa ideia: **cada conclusão carrega a sua
 * evidência, e a confiança é declarada como faixa, nunca como certeza.**
 * Daí os quatro níveis (`HIGH | MEDIUM | LOW | UNCONFIRMED`), os fatores com
 * peso e explicação, e a regra que atravessa tudo — nunca se escreve "é a
 * mesma pessoa", escreve-se que há correspondência entre duas entidades e
 * que evidências a sustentam.
 */
import type { FindingValue } from '../net/provenance.ts';

export type Confianca = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCONFIRMED';

export type TipoEntidade =
  | 'pessoa' | 'conta' | 'username' | 'email' | 'telefone'
  | 'dominio' | 'url' | 'post' | 'organizacao' | 'outro';

/** Uma observação concreta, com origem e hora. É a unidade mínima de prova. */
export interface Evidencia {
  fonte: string;
  url: string | null;
  provider: string;
  timestamp: string;
  nota: string;
}

/** Sinal que empurra a decisão, com peso e a razão escrita. */
export interface Fator {
  nome: string;
  peso: number;
  explica: string;
}

export interface Entidade {
  id: string;
  rotulo: string;
  tipo: TipoEntidade;
  /** Quem forneceu estes dados (ferramenta/registry). */
  provider: string;
  plataformas: string[];
  /** username, nome, bio, avatar, url, email, telefone, … */
  atributos: Record<string, string>;
  evidencias: Evidencia[];
}

export interface Resolucao {
  a: string;
  b: string;
  confianca: Confianca;
  total: number;
  fatores: Fator[];
  evidencias: Evidencia[];
  /** Sempre: o que esta resolução NÃO afirma. */
  nota: string;
}

export type TipoCorrelacao =
  | 'username' | 'nome' | 'email' | 'telefone' | 'url' | 'dominio'
  | 'bio' | 'avatar' | 'plataforma' | 'link-cruzado';

export interface Correlacao {
  tipo: TipoCorrelacao;
  valor: string;
  entidades: string[];
  confianca: Confianca;
  total: number;
  fatores: Fator[];
  evidencias: Evidencia[];
  nota: string;
}

export type EstadoItem = 'NEW' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';

export interface Alteracao {
  caminho: string;
  estado: EstadoItem;
  antes: FindingValue;
  depois: FindingValue;
  nota: string;
}

export interface Evento {
  quando: string;
  tipo: string;
  descricao: string;
  plataforma?: string;
  url?: string;
  entidade?: string;
}

export const ROTULO_CONFIANCA: Record<Confianca, string> = {
  HIGH: 'correspondência forte',
  MEDIUM: 'correspondência provável',
  LOW: 'correspondência fraca',
  UNCONFIRMED: 'por confirmar',
};

export function agora(): string {
  return new Date().toISOString();
}
