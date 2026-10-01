/**
 * Unified Profile — uma só entidade investigativa com tudo o que se sabe.
 *
 * Reúne os resultados relacionados (Instagram, TikTok, Facebook, X, Reddit,
 * GitHub, web) numa entidade única, mas **sem fundir o que não está provado**:
 * as contas ficam listadas com a sua confiança, os divergências viram lacuna,
 * e o perfil leva sempre a lista de evidências que o sustenta.
 *
 * O que este módulo não faz: apagar diferenças para o perfil "ficar bonito".
 * Se dois documentos públicos dizem nomes diferentes, isso fica escrito.
 */
import { confiancaMaxima } from './correlation.ts';
import { normalizar } from './entities.ts';
import {
  agora, type Confianca, type Correlacao, type Entidade,
  type Evidencia, type Resolucao,
} from './types.ts';

export interface ContaUnificada {
  plataforma: string;
  username: string | null;
  url: string | null;
  entidade: string;
}

export interface IdentificadorComum {
  tipo: string;
  valor: string;
  entidades: string[];
}

export interface PerfilUnificado {
  rotulo: string;
  principal: string;
  identificadores: IdentificadorComum[];
  contas: ContaUnificada[];
  atributos: Record<string, string>;
  correlacoes: Correlacao[];
  resolucoes: Resolucao[];
  confiancaGeral: Confianca;
  lacunas: string[];
  evidencias: Evidencia[];
  entidades: Entidade[];
  geradoEm: string;
}

/** Entidade com mais material: mais plataformas, depois mais evidências. */
function escolherPrincipal(entidades: Entidade[]): Entidade {
  return [...entidades].sort((a, b) =>
    (b.plataformas.length - a.plataformas.length)
    || (b.evidencias.length - a.evidencias.length)
    || a.id.localeCompare(b.id))[0];
}

export function unificar(
  entidades: Entidade[], correlacoes: Correlacao[], resolucoes: Resolucao[],
): PerfilUnificado {
  const ordem = entidades.length ? entidades : [];
  const principal = ordem.length ? escolherPrincipal(ordem) : null;
  const lacunas: string[] = [];

  // identificadores repetidos, agrupados por valor normalizado
  const idMap = new Map<string, IdentificadorComum>();
  for (const e of ordem) {
    for (const tipo of ['username', 'email', 'telefone', 'nome'] as const) {
      const v = e.atributos[tipo];
      if (!v) continue;
      const k = `${tipo} ${normalizar(v)}`;
      const atual = idMap.get(k);
      if (atual) { if (!atual.entidades.includes(e.id)) atual.entidades.push(e.id); }
      else idMap.set(k, { tipo, valor: v, entidades: [e.id] });
    }
  }
  const identificadores = [...idMap.values()].sort((a, b) => b.entidades.length - a.entidades.length);

  const contas: ContaUnificada[] = [];
  for (const e of ordem) {
    for (const p of e.plataformas) {
      contas.push({
        plataforma: p,
        username: e.atributos.username ?? null,
        url: e.atributos.url ?? e.atributos.profileUrl ?? null,
        entidade: e.id,
      });
    }
    if (!e.plataformas.length) {
      contas.push({ plataforma: 'desconhecida', username: e.atributos.username ?? null, url: null, entidade: e.id });
    }
  }

  // consenso de atributos: em divergência fica o valor da entidade com mais
  // evidências E a diferença regista-se como lacuna — nada é silenciosamente
  // substituído.
  const atributos: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(principal?.atributos ?? {})) {
    if (valor) atributos[chave] = valor;
  }
  for (const e of ordem) {
    for (const [chave, valor] of Object.entries(e.atributos)) {
      if (!valor) continue;
      const atual = atributos[chave];
      if (atual === undefined) { atributos[chave] = valor; continue; }
      if (normalizar(atual) !== normalizar(valor)) {
        const dono = e.evidencias.length >= (principal?.evidencias.length ?? 0) ? e : principal;
        if (dono && dono.id === e.id) {
          atributos[chave] = valor;
          lacunas.push(`divergência em "${chave}": ${valor} (em ${e.rotulo}) substitui ${atual}`);
        } else {
          lacunas.push(`divergência em "${chave}": ${valor} (em ${e.rotulo}) face a ${atual}`);
        }
      }
    }
  }

  const plataformasVistas = new Set(contas.map((c) => c.plataforma));
  if (!atributos.url) lacunas.push('sem URL pública conhecida para o alvo principal');
  if (!atributos.email) lacunas.push('sem email público associado');
  if (plataformasVistas.size < 2) lacunas.push('menos de duas plataformas observadas: o cruzamento é limitado');
  const semConfirmar = resolucoes.filter((r) => r.confianca === 'UNCONFIRMED').length;
  if (semConfirmar) lacunas.push(`${semConfirmar} correspondência(s) por confirmar — não entram como certas`);

  const evidencias: Evidencia[] = [];
  for (const e of ordem) for (const ev of e.evidencias) if (!evidencias.some((x) => x.fonte === ev.fonte && x.nota === ev.nota)) evidencias.push(ev);

  const confiancaGeral: Confianca = resolucoes.length
    ? confiancaMaxima(resolucoes)
    : (correlacoes.length ? confiancaMaxima(correlacoes) : 'UNCONFIRMED');

  return {
    rotulo: principal?.rotulo ?? 'sem entidades',
    principal: principal?.id ?? '',
    identificadores,
    contas,
    atributos,
    correlacoes,
    resolucoes,
    confiancaGeral,
    lacunas,
    evidencias: evidencias.slice(0, 60),
    entidades: ordem,
    geradoEm: agora(),
  };
}

/** Resumo de uma linha para listagens. */
export function resumoPerfil(p: PerfilUnificado): string {
  const plats = new Set(p.contas.map((c) => c.plataforma)).size;
  return `${p.rotulo} · ${p.entidades.length} entidade(s) · ${plats} plataforma(s) · ${p.correlacoes.length} correlação(ões) · confiança ${p.confiancaGeral}`;
}
