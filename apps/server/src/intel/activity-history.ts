/**
 * Activity History — quanta atividade se observou, por onde e quando.
 *
 * Agrega eventos que já existem; não busca nada novo. O denominador é sempre
 * dito: se metade dos eventos não tem data, o pico "do dia X" é o pico do que
 * temos data — e o total sem data aparece no resumo.
 */
import type { Evento } from './types.ts';
import { dataValida } from './timeline.ts';

export interface Historico {
  total: number;
  comData: number;
  semData: number;
  porPlataforma: { plataforma: string; total: number }[];
  porDia: { dia: string; total: number }[];
  porTipo: { tipo: string; total: number }[];
  pico: { dia: string; total: number } | null;
  primeiro: string | null;
  ultimo: string | null;
  duracaoDias: number | null;
  nota: string;
}

function contaPor<T>(l: T[], chave: (x: T) => string): { chave: string; total: number }[] {
  const m = new Map<string, number>();
  for (const x of l) {
    const k = chave(x) || 'desconhecido';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([chave, total]) => ({ chave, total })).sort((a, b) => b.total - a.total || a.chave.localeCompare(b.chave));
}

export function historico(eventos: Evento[]): Historico {
  const datados = eventos.filter((e) => dataValida(e.quando));
  const semData = eventos.length - datados.length;

  const porDiaMap = new Map<string, number>();
  for (const e of datados) {
    const dia = e.quando.slice(0, 10);
    porDiaMap.set(dia, (porDiaMap.get(dia) ?? 0) + 1);
  }
  const porDia = [...porDiaMap.entries()]
    .map(([dia, total]) => ({ dia, total }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  const pico = porDia.length ? porDia.reduce((m, d) => (d.total > m.total ? d : m)) : null;

  const primeiro = datados.length ? [...datados].sort((a, b) => a.quando.localeCompare(b.quando))[0].quando : null;
  const ultimo = datados.length ? [...datados].sort((a, b) => b.quando.localeCompare(a.quando))[0].quando : null;
  const duracaoDias = primeiro && ultimo
    ? Math.max(0, Math.round((Date.parse(ultimo) - Date.parse(primeiro)) / 86_400_000))
    : null;

  const plataformas = contaPor(datados, (e) => e.plataforma ?? '');
  const tipos = contaPor(datados, (e) => e.tipo);

  return {
    total: eventos.length,
    comData: datados.length,
    semData,
    porPlataforma: plataformas.map((x) => ({ plataforma: x.chave, total: x.total })),
    porDia,
    porTipo: tipos.map((x) => ({ tipo: x.chave, total: x.total })),
    pico,
    primeiro,
    ultimo,
    duracaoDias,
    nota: semData
      ? `${semData} de ${eventos.length} evento(s) sem data válida: os agregados por dia cobrem só ${datados.length}.`
      : `${eventos.length} evento(s), todos com data válida.`,
  };
}

/** Sequência de dias consecutivos com atividade — sem inventar dias vazios. */
export function diasConsecutivos(h: Historico): { inicio: string; fim: string; dias: number }[] {
  const saida: { inicio: string; fim: string; dias: number }[] = [];
  let atual: { inicio: string; fim: string; dias: number } | null = null;
  for (const d of h.porDia) {
    if (!atual) { atual = { inicio: d.dia, fim: d.dia, dias: 1 }; continue; }
    const espera = Math.round((Date.parse(d.dia) - Date.parse(atual.fim)) / 86_400_000);
    if (espera === 1) { atual.fim = d.dia; atual.dias++; }
    else { saida.push(atual); atual = { inicio: d.dia, fim: d.dia, dias: 1 }; }
  }
  if (atual) saida.push(atual);
  return saida.sort((a, b) => b.dias - a.dias);
}
