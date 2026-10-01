/**
 * Peças partilhadas do Intelligence Engine.
 *
 * O Radar e o Unified Profile são ecrãs diferentes sobre a MESMA investigação,
 * por isso escolher a investigação e ler a faixa de confiança vive aqui — uma
 * só descrição do que "HIGH" quer dizer, em vez de duas que divergem.
 *
 * A regra que atravessa estas peças: nunca escrever "é a mesma pessoa". O que
 * se escreve é o que a correspondência significa e o que ela não prova.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type ConfiancaInteligencia, type Investigation } from '../api';

/** O que cada faixa de confiança quer dizer, em pt-PT e sem prometer identidade. */
export const LEITOR_CONFIANCA: Record<ConfiancaInteligencia, string> = {
  HIGH: 'correspondência forte entre entidades. Isto NÃO prova que é a mesma pessoa.',
  MEDIUM: 'correspondência provável. A reutilização de usernames é a causa mais comum de atribuição errada.',
  LOW: 'correspondência fraca. Trate como hipótese, não como facto.',
  UNCONFIRMED: 'por confirmar. Nada está afirmado sobre esta correspondência.',
};

const CLASSE_CONFIANCA: Record<ConfiancaInteligencia, string> = {
  HIGH: 'conf-high',
  MEDIUM: 'conf-medium',
  LOW: 'conf-low',
  UNCONFIRMED: 'conf-unconfirmed',
};

/** Faixa de confiança, com o que não prova escrito no `title`. */
export function SeloConfianca({ confianca }: { confianca: ConfiancaInteligencia }) {
  const classe = CLASSE_CONFIANCA[confianca] ?? CLASSE_CONFIANCA.UNCONFIRMED;
  return <span className={`tag ${classe}`} title={LEITOR_CONFIANCA[confianca]}>{confianca}</span>;
}

/** Lista de investigações do próprio utilizador, com estado de carregamento. */
export function useInvestigacoes(): { lista: Investigation[] | null; erro: string } {
  const [lista, setLista] = useState<Investigation[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api.investigations()
      .then((r) => setLista(r.investigations))
      .catch((e) => setErro((e as ApiError).message));
  }, []);
  return { lista, erro };
}

/** Seletor de investigação — só as que existem, pela ordem do servidor. */
export function EscolherInvestigacao({ lista, valor, onChange }: {
  lista: Investigation[]; valor: string; onChange: (id: string) => void;
}) {
  return (
    <select
      className="input"
      aria-label="Investigação"
      value={valor}
      onChange={(e) => onChange(e.target.value)}
    >
      {lista.map((i) => (
        <option key={i.id} value={i.id}>
          {i.title} · {i.seed} · {new Date(i.updated_at).toLocaleDateString('pt-BR')}
        </option>
      ))}
    </select>
  );
}

/** Data/hora legível sem inventar formato quando o valor não é data. */
export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t).toLocaleString('pt-BR');
}

/** Fontes de um conjunto de evidências, juntas e sem repetir. */
export function fontes(evidencias: { provider: string; fonte: string }[]): string {
  const todas = evidencias.map((e) => e.provider || e.fonte).filter(Boolean);
  return [...new Set(todas)].join(', ') || 'sem fonte declarada';
}
