/**
 * Timeline — eventos ordenados e os intervalos entre eles.
 *
 * O que a timeline declara: quando cada evento foi observado, por ordem, e
 * quanto tempo separa um do outro. O que ela NÃO declara: que um intervalo
 * longo significa inatividade. Um buraco na linha do tempo é um buraco no
 * que observámos — pode ser a pessoa em pausa ou pode ser a nossa coleta a
 * não ter ido buscar aquele período, e a nota diz as duas coisas.
 */
import type { Evento } from './types.ts';

const DIA = 24 * 60 * 60 * 1000;
/** Intervalos acima disto são assinalados (não cortados). */
export const JANELA_NOTA_MS = 7 * DIA;

export interface Intervalo {
  inicio: string;
  fim: string;
  decorridoMs: number;
  dias: number;
  nota: string;
}

export interface LinhaTempo {
  eventos: Evento[];
  intervalos: Intervalo[];
  primeiro: string | null;
  ultimo: string | null;
  semData: number;
  invalidos: number;
  nota: string;
}

export function dataValida(iso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > Date.parse('2000-01-01') && t < Date.now() + 365 * DIA;
}

export function linhaTempo(eventos: Evento[]): LinhaTempo {
  const validos: Evento[] = [];
  const semData: Evento[] = [];
  const invalidos: Evento[] = [];
  for (const e of eventos) {
    if (!e.quando) semData.push(e);
    else if (dataValida(e.quando)) validos.push(e);
    else invalidos.push(e);
  }
  validos.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));

  const intervalos: Intervalo[] = [];
  for (let i = 1; i < validos.length; i++) {
    const decorridoMs = Date.parse(validos[i].quando) - Date.parse(validos[i - 1].quando);
    if (decorridoMs >= JANELA_NOTA_MS) {
      const dias = Math.round(decorridoMs / DIA);
      intervalos.push({
        inicio: validos[i - 1].quando, fim: validos[i].quando, decorridoMs, dias,
        nota: `${dias} dia(s) sem eventos observados — pode ser ausência de atividade ou ausência de coleta; não se conclui nada a partir do intervalo`,
      });
    }
  }

  return {
    eventos: validos,
    intervalos,
    primeiro: validos[0]?.quando ?? null,
    ultimo: validos[validos.length - 1]?.quando ?? null,
    semData: semData.length,
    invalidos: invalidos.length,
    nota: eventos.length === validos.length
      ? `${validos.length} evento(s) ordenados por data observada.`
      : `${validos.length} de ${eventos.length} evento(s) têm data válida; os restantes ficaram de fora da ordem em vez de receberem uma data inventada.`
        + (invalidos.length ? ` ${invalidos.length} com data inválida.` : '')
        + (semData.length ? ` ${semData.length} sem data.` : ''),
  };
}

/** Eventos por janela de tempo (para agregação por período). */
export function porJanela(eventos: Evento[], janelaMs = DIA): { inicio: string; fim: string; total: number }[] {
  const v = linhaTempo(eventos).eventos;
  if (!v.length) return [];
  const saida = new Map<number, { inicio: string; fim: string; total: number }>();
  for (const e of v) {
    const t = Date.parse(e.quando);
    const base = Math.floor(t / janelaMs) * janelaMs;
    const atual = saida.get(base);
    if (atual) atual.total++;
    else saida.set(base, { inicio: new Date(base).toISOString(), fim: new Date(base + janelaMs).toISOString(), total: 1 });
  }
  return [...saida.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}
