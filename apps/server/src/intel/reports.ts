/**
 * Reports — o mesmo conjunto de factos em JSON, CSV, HTML e PDF.
 *
 * Quatro formatos, um só conteúdo: o que sai daqui não pode divergir entre
 * formatos, por isso todos montam as mesmas secções e só mudam o invólucro.
 *
 *  - **JSON** — máquina, com a estrutura inteira (é o que um script lê).
 *  - **CSV**  — tabela única `secção,tipo,valor,confiança,evidências,nota`,
 *               com aspas escapadas: abre em qualquer folha de cálculo.
 *  - **HTML** — autossuficiente (CSS embutido, zero recursos externos), com
 *               todo o texto escapado — um bio com `<script>` é texto, não código.
 *  - **PDF**  — escrito à mão em `pdf.ts`, sem dependência nenhuma.
 *
 * Nenhum formato acrescenta conclusão: o rodapé leva a mesma ressalva nos quatro.
 */
import { montarPdf } from './pdf.ts';
import { ROTULO_CONFIANCA, type Confianca } from './types.ts';
import type { PerfilUnificado } from './unified.ts';
import type { Radar } from './radar.ts';

export type Formato = 'json' | 'csv' | 'html' | 'pdf';

export interface Relatorio {
  nome: string;
  mime: string;
  conteudo: string | Uint8Array;
}

export interface PedidoRelatorio {
  alvo: string;
  perfil: PerfilUnificado;
  radar?: Radar | null;
  formato: Formato;
  geradoPor?: string;
}

const RODAPE = 'Documento gerado pelo ARGOS a partir de dados publicos observados. Correspondencia entre entidades nunca e afirmacao de identidade.';

interface Linha { seccao: string; tipo: string; valor: string; confianca: string; evidencias: string; nota: string }

function f(c: Confianca): string {
  return `${c} (${ROTULO_CONFIANCA[c]})`;
}

/** Fontes de uma evidência, juntas e sem duplicar. */
function fontes(l: { provider: string; fonte: string }[]): string {
  return [...new Set(l.map((e) => e.provider || e.fonte))].join('; ');
}

export function linhas(p: PedidoRelatorio): Linha[] {
  const { perfil } = p;
  const out: Linha[] = [];
  const add = (seccao: string, tipo: string, valor: string, confianca = '', evid = '', nota = '') =>
    out.push({ seccao, tipo, valor, confianca, evidencias: evid, nota });

  add('Cabeçalho', 'alvo', p.alvo, f(perfil.confiancaGeral), '', `gerado em ${perfil.geradoEm}`);
  add('Cabeçalho', 'entidades', String(perfil.entidades.length), '', '', '');

  for (const i of perfil.identificadores) {
    add('Identificadores', i.tipo, i.valor, '', '', `${i.entidades.length} entidade(s)`);
  }
  for (const c of perfil.contas) {
    add('Contas', c.plataforma, c.username ?? '-', '', '', c.url ?? 'sem URL pública');
  }
  for (const [k, v] of Object.entries(perfil.atributos)) {
    if (!v) continue;
    add('Atributos', k, v, '', '', '');
  }
  for (const c of perfil.correlacoes) {
    add('Correlações', `${c.tipo}: ${c.valor}`, c.entidades.join(', '), f(c.confianca), fontes(c.evidencias), c.nota);
  }
  for (const r of perfil.resolucoes) {
    add('Resoluções', `${r.a} ↔ ${r.b}`, `${r.total} ponto(s)`, f(r.confianca), fontes(r.evidencias), r.nota);
  }
  for (const l of perfil.lacunas) add('Lacunas', 'lacuna', l, '', '', '');

  if (p.radar) {
    if (!p.radar.temAnterior) add('Radar', 'estado', p.radar.nota, '', '', '');
    for (const d of p.radar.detetados) add('Radar', `${d.categoria} · ${d.estado}`, d.valor, '', '', d.nota);
    if (p.radar.detetados.length) add('Radar', 'resumo', p.radar.nota, '', '', '');
  }
  for (const e of perfil.evidencias) {
    add('Evidências', e.provider, e.nota, '', e.fonte, `${e.timestamp}${e.url ? ` · ${e.url}` : ''}`);
  }
  return out;
}

function csvEscapar(v: string): string {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function htmlEscapar(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function seccoes(p: PedidoRelatorio): { titulo: string; linhas: string[] }[] {
  const grupos = new Map<string, Linha[]>();
  for (const l of linhas(p)) {
    const g = grupos.get(l.seccao);
    if (g) g.push(l); else grupos.set(l.seccao, [l]);
  }
  return [...grupos.entries()].map(([titulo, ls]) => ({
    titulo,
    linhas: ls.map((l) => [
      l.tipo, l.valor, l.confianca, l.evidencias, l.nota,
    ].filter(Boolean).join(' | ')),
  }));
}

function nomeFicheiro(p: PedidoRelatorio): string {
  const base = p.alvo.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'relatorio';
  return `argos-${base}-${new Date().toISOString().slice(0, 10)}.${p.formato}`;
}

export function gerarRelatorio(p: PedidoRelatorio): Relatorio {
  const ls = linhas(p);
  const nome = nomeFicheiro(p);

  if (p.formato === 'json') {
    const corpo = {
      alvo: p.alvo,
      geradoEm: new Date().toISOString(),
      geradoPor: p.geradoPor ?? 'argos',
      confiancaGeral: p.perfil.confiancaGeral,
      resumo: {
        entidades: p.perfil.entidades.length,
        contas: p.perfil.contas.length,
        correlacoes: p.perfil.correlacoes.length,
        resolucoes: p.perfil.resolucoes.length,
        evidencias: p.perfil.evidencias.length,
        lacunas: p.perfil.lacunas.length,
      },
      identificadores: p.perfil.identificadores,
      contas: p.perfil.contas,
      atributos: p.perfil.atributos,
      correlacoes: p.perfil.correlacoes,
      resolucoes: p.perfil.resolucoes,
      lacunas: p.perfil.lacunas,
      radar: p.radar ?? null,
      evidencias: p.perfil.evidencias,
      nota: RODAPE,
    };
    return { nome: nome.replace(/\.json$/, '.json'), mime: 'application/json', conteudo: JSON.stringify(corpo, null, 2) };
  }

  if (p.formato === 'csv') {
    const cab = ['secção', 'tipo', 'valor', 'confiança', 'evidências', 'nota'];
    const corpo = [cab, ...ls.map((l) => [l.seccao, l.tipo, l.valor, l.confianca, l.evidencias, l.nota])]
      .map((r) => r.map(csvEscapar).join(',')).join('\n');
    return { nome, mime: 'text/csv; charset=utf-8', conteudo: `﻿${corpo}\n` };
  }

  if (p.formato === 'html') {
    const gruposHtml = seccoes(p).map((s) => `
  <section>
    <h2>${htmlEscapar(s.titulo)}</h2>
    <ul>${s.linhas.map((l) => `<li>${htmlEscapar(l)}</li>`).join('')}</ul>
  </section>`).join('');
    const doc = `<!doctype html>
<html lang="pt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARGOS · ${htmlEscapar(p.alvo)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:32px}
main{max-width:860px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px 28px}
h1{font-size:20px;margin:0 0 4px;color:#1e3a5f}.sub{color:#64748b;margin:0 0 20px;font-size:13px}
section{margin:0 0 20px}h2{font-size:15px;margin:0 0 8px;color:#1e3a5f;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
ul{margin:0;padding-left:18px}li{margin:3px 0;word-break:break-word}
footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}
</style></head><body><main>
<h1>ARGOS · ${htmlEscapar(p.alvo)}</h1>
<p class="sub">Confiança geral: ${htmlEscapar(f(p.perfil.confiancaGeral))} · gerado em ${htmlEscapar(p.perfil.geradoEm)}</p>
${gruposHtml}
<footer>${htmlEscapar(RODAPE)}</footer>
</main></body></html>
`;
    return { nome, mime: 'text/html; charset=utf-8', conteudo: doc };
  }

  const doc = montarPdf({
    titulo: `ARGOS - ${p.alvo}`,
    subtitulo: `Confianca geral: ${f(p.perfil.confiancaGeral)} | gerado em ${p.perfil.geradoEm}`,
    seccoes: seccoes(p),
    rodape: RODAPE,
  });
  return { nome: nome.replace(/\.pdf$/, '.pdf'), mime: 'application/pdf', conteudo: doc };
}

export const FORMATOS: Formato[] = ['json', 'csv', 'html', 'pdf'];
