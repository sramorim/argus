/**
 * Testes unitarios do gerador de PDF escrito a mao (sem rede, sem dependencias).
 *   node test/pdf.test.ts
 */
import { montarPdf, pdfValido } from '../src/intel/pdf.ts';
import type { DocPdf } from '../src/intel/pdf.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

/** Converte bytes em texto Latin-1 (um octete = um carater) para inspecao. */
function latin1(b: Uint8Array): string {
  return Buffer.from(b).toString('latin1');
}

/** Codifica uma cadeia em octetes Latin-1 para procurar no documento. */
function oct(s: string): Buffer {
  return Buffer.from(s, 'latin1');
}

/** Localiza uma cadeia Latin-1 nos bytes; -1 se nao existir. */
function achar(b: Uint8Array, s: string, desde = 0): number {
  return Buffer.from(b).indexOf(oct(s), desde);
}

interface EntradaXref {
  n: number;
  offset: number;
  tipo: string;
  bate: boolean;
}

interface LeituraXref {
  ok: boolean;
  motivo: string;
  startxref: number;
  apontaXref: boolean;
  entradas: EntradaXref[];
}

/**
 * Leitor independente da tabela xref (escrito de proposito sem usar o
 * gerador): segue o startxref, confirma a palavra `xref`, le as entradas de
 * 20 bytes e verifica, para cada objeto, se o offset aponta para `<n> 0 obj`.
 */
function lerXref(b: Uint8Array): LeituraXref {
  const buf = Buffer.from(b);
  const texto = buf.toString('latin1');
  const idx = texto.lastIndexOf('startxref');
  if (idx < 0) return { ok: false, motivo: 'startxref ausente', startxref: 0, apontaXref: false, entradas: [] };
  const m = texto.slice(idx + 'startxref'.length).trim().match(/^(\d+)/);
  if (!m) return { ok: false, motivo: 'valor de startxref ausente', startxref: 0, apontaXref: false, entradas: [] };
  const off = Number(m[1]);
  const apontaXref = off >= 0 && off + 4 <= b.length && texto.startsWith('xref', off);
  if (!apontaXref) return { ok: false, motivo: 'startxref nao aponta para xref', startxref: off, apontaXref: false, entradas: [] };

  // Cabecalho: "xref\n" + "0 <conta>\n"
  const fimPrimeira = texto.indexOf('\n', off);
  const fimSegunda = texto.indexOf('\n', fimPrimeira + 1);
  const cabecalho = texto.slice(fimPrimeira + 1, fimSegunda).trim().split(/\s+/);
  const primeiro = Number(cabecalho[0]);
  const conta = Number(cabecalho[1]);
  if (!Number.isInteger(primeiro) || !Number.isInteger(conta)) {
    return { ok: false, motivo: 'cabecalho xref invalido', startxref: off, apontaXref, entradas: [] };
  }

  const entradas: EntradaXref[] = [];
  let pos = fimSegunda + 1;
  for (let i = 0; i < conta; i++) {
    const campo = texto.slice(pos, pos + 20);
    pos += 20;
    const n = primeiro + i;
    const offset = Number(campo.slice(0, 10));
    const tipo = campo[17];
    let bate = false;
    if (tipo === 'n' && Number.isInteger(offset)) {
      const etiqueta = `${n} 0 obj`;
      bate = buf.slice(offset, offset + etiqueta.length).toString('latin1') === etiqueta;
    }
    entradas.push({ n, offset, tipo, bate });
  }
  const todosBatem = entradas.every((e) => e.tipo !== 'n' || e.bate);
  return {
    ok: todosBatem,
    motivo: todosBatem ? 'ok' : `offsets invalidos: ${entradas.filter((e) => e.tipo === 'n' && !e.bate).map((e) => e.n).join(',')}`,
    startxref: off,
    apontaXref,
    entradas,
  };
}

// ---------- 1. documento normal ----------
const doc: DocPdf = {
  titulo: 'Relatorio de Inteligencia',
  subtitulo: 'Gerado localmente, sem rede',
  seccoes: [
    { titulo: 'Resumo', linhas: ['Linha um do resumo.', 'Linha dois do resumo.', 'Linha tres.'] },
    { titulo: 'Detalhe', linhas: ['Primeiro ponto.', 'Segundo ponto.', 'Terceiro ponto.'] },
  ],
  rodape: 'ARGUS - uso interno',
};
const pdf = montarPdf(doc);
const txt = latin1(pdf);

ok(txt.startsWith('%PDF-1.4'), 'estrutura: comeca com %PDF-1.4', JSON.stringify(txt.slice(0, 16)));
ok(txt.replace(/\s+$/, '').endsWith('%%EOF'), 'estrutura: termina com %%EOF', JSON.stringify(txt.slice(-16)));

const v = pdfValido(pdf);
ok(v.ok === true, 'pdfValido: aceita um documento normal', v.motivo);
ok(v.motivo === 'ok', 'pdfValido: motivo e "ok"', v.motivo);
ok(v.paginas === 1, 'pdfValido: documento pequeno tem 1 pagina', `obtido ${v.paginas}`);

// ---------- 2. leitura independente da tabela xref ----------
const xr = lerXref(pdf);
ok(xr.ok, 'xref: tabela legivel e offsets coerentes', xr.motivo);
ok(xr.entradas.length > 0, 'xref: leu entradas', `total ${xr.entradas.length}`);
ok(
  xr.entradas.every((e) => e.tipo !== 'n' || e.bate),
  'xref: TODOS os offsets apontam para "<n> 0 obj"',
  xr.entradas.filter((e) => e.tipo === 'n' && !e.bate).map((e) => `obj ${e.n} -> ${e.offset}`).join(' | '),
);
ok(xr.entradas.filter((e) => e.tipo === 'n').length === xr.entradas.length - 1,
  'xref: exceto a entrada 0 (livre), todas sao "n"', JSON.stringify(xr.entradas.map((e) => e.tipo)));

// ---------- 3. startxref aponta para a palavra literal xref ----------
const iStart = txt.lastIndexOf('startxref');
const offStart = Number(txt.slice(iStart + 'startxref'.length).trim().split(/\s+/)[0]);
ok(Number.isInteger(offStart) && txt.startsWith('xref', offStart),
  'startxref: valor aponta exatamente para a palavra xref', `offset ${offStart}`);
ok(xr.startxref === offStart, 'startxref: leitor independente encontra o mesmo offset', `${xr.startxref} != ${offStart}`);

// ---------- 4. documento longo (>200 linhas) pagina certo ----------
const linhasLongas: string[] = [];
for (let i = 1; i <= 220; i++) linhasLongas.push(`Linha ${i} do relatorio longo com texto suficiente para ocupar espaco.`);
const docLongo: DocPdf = {
  titulo: 'Relatorio Longo',
  seccoes: [{ titulo: 'Corpo', linhas: linhasLongas }],
};
const pdfLongo = montarPdf(docLongo);
const vLongo = pdfValido(pdfLongo);
ok(linhasLongas.length > 200, 'longo: documento tem mais de 200 linhas', String(linhasLongas.length));
ok(vLongo.ok && vLongo.paginas > 1, 'longo: produz mais de 1 pagina', `paginas ${vLongo.paginas} (${vLongo.motivo})`);
const xrLongo = lerXref(pdfLongo);
ok(xrLongo.ok, 'longo: xref continua correto com varias paginas', xrLongo.motivo);
ok(xrLongo.entradas.every((e) => e.tipo !== 'n' || e.bate),
  'longo: todos os offsets das varias paginas apontam para "<n> 0 obj"',
  xrLongo.entradas.filter((e) => e.tipo === 'n' && !e.bate).map((e) => String(e.n)).join(','));
ok(vLongo.paginas === xrLongo.entradas.filter((e) => e.n % 2 === 0 && e.n >= 6).length,
  'longo: numero de paginas coincide com os objetos de pagina', `paginas ${vLongo.paginas}`);

// ---------- 5. seccoes vazias ----------
const vazio = montarPdf({ titulo: 'Sem Secoes', seccoes: [] });
const vVazio = pdfValido(vazio);
ok(vVazio.ok, 'vazio: seccoes vazias geram PDF valido', vVazio.motivo);
ok(vVazio.paginas === 1, 'vazio: continua com exatamente 1 pagina', `obtido ${vVazio.paginas}`);
const xrVazio = lerXref(vazio);
ok(xrVazio.ok && xrVazio.entradas.every((e) => e.tipo !== 'n' || e.bate),
  'vazio: xref valido', xrVazio.motivo);

// ---------- 6. caracteres de escape ( ) \ ----------
const docEsc: DocPdf = {
  titulo: 'Escapes',
  seccoes: [{ titulo: 'Sintaxe', linhas: ['Caminho (prova) com \\ barra e ) fecho.'] }],
};
const pdfEsc = montarPdf(docEsc);
ok(achar(pdfEsc, '\\(prova\\)') >= 0, 'escape: parentesis escapados como \\( e \\)', '');
ok(achar(pdfEsc, '\\ barra') >= 0, 'escape: barra invertente escapada como \\\\', '');
const xrEsc = lerXref(pdfEsc);
ok(xrEsc.ok && xrEsc.entradas.every((e) => e.tipo !== 'n' || e.bate),
  'escape: xref nao e afetado pelos caracteres especiais', xrEsc.motivo);
ok(pdfValido(pdfEsc).ok, 'escape: documento com especiais continua valido', pdfValido(pdfEsc).motivo);

// ---------- 7. acentuacao em WinAnsi (octete unico, nunca UTF-8) ----------
const ACENTOS = 'Acentuação: ç ã é';
const docAce: DocPdf = {
  titulo: 'Acentuacao',
  seccoes: [{ titulo: 'Texto', linhas: [ACENTOS] }],
};
const pdfAce = montarPdf(docAce);
// O literal deve estar presente como N octetes Latin-1 (N = nº de carateres).
const esperado = oct(ACENTOS);
ok(achar(pdfAce, ACENTOS) >= 0, 'acentos: texto presente como octetes Latin-1 unicos',
  `esperado ${esperado.toString('hex')}`);
ok(esperado.length === ACENTOS.length, 'acentos: 1 carater = 1 octete (sem multi-byte)', `${esperado.length} != ${ACENTOS.length}`);
ok(!contemUtf8Acentos(pdfAce), 'acentos: sem sequencias UTF-8 2-byte (C3 A3 / C3 A7 / C3 A9) no documento', '');

/** Procura as sequencias UTF-8 de ã, ç e é (0xC3 seguido de A3/A7/A9). */
function contemUtf8Acentos(b: Uint8Array): boolean {
  const buf = Buffer.from(b);
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0xc3 && (buf[i + 1] === 0xa3 || buf[i + 1] === 0xa7 || buf[i + 1] === 0xa9)) return true;
  }
  return false;
}

// Conteudo da pagina: todos os octetes do stream sao unicos (>=0x80 apenas
// em valores Latin-1, nunca 0xC3 como prefixo UTF-8).
const iStream = achar(pdfAce, 'stream\n');
const iFim = achar(pdfAce, '\nendstream', iStream);
const stream = Buffer.from(pdfAce).slice(iStream + 'stream\n'.length, iFim);
ok(iStream >= 0 && iFim > iStream, 'acentos: stream de conteudo localizado', `stream ${iStream}, fim ${iFim}`);
ok(stream.includes(esperado), 'acentos: o stream de conteudo contem o literal em octete unico', '');
ok(!contemUtf8Acentos(stream), 'acentos: stream de conteudo sem multi-byte UTF-8', '');
// Todos os octetes do stream sao representaveis em Latin-1: nenhum prefixo
// de sequencia UTF-8 (C2..F4) seguido de continuacao (80..BF).
let utf8Suspeito = 0;
for (let i = 0; i + 1 < stream.length; i++) {
  if (stream[i] >= 0xc2 && stream[i] <= 0xf4 && stream[i + 1] >= 0x80 && stream[i + 1] <= 0xbf) utf8Suspeito++;
}
ok(utf8Suspeito === 0, 'acentos: nenhum octete do stream forma par UTF-8', `pares ${utf8Suspeito}`);

// ---------- 7b. caracteres fora de WinAnsi (>255) viram "?" ----------
const FORA = 'Emoticon \u{1F600} e travessao \u2014 fim';
const pdfFora = montarPdf({ titulo: 'Fora de alcance', seccoes: [{ titulo: 'T', linhas: [FORA] }] });
ok(achar(pdfFora, 'Emoticon ? e travessao ? fim') >= 0,
  'fora-de-winansi: code points > 255 substituidos por ?', '');
ok(!contemUtf8Acentos(pdfFora) && achar(pdfFora, Buffer.from([0xf0, 0x9f]).toString('latin1')) < 0,
  'fora-de-winansi: sem octetes UTF-8 no documento', '');

// ---------- 8. garbage truncado ----------
const truncado = pdf.slice(0, pdf.length - 10);
const vTrunc = pdfValido(truncado);
ok(vTrunc.ok === false, 'truncado: pdfValido rejeita bytes cortados', JSON.stringify(vTrunc));
ok(/%%EOF|truncado/i.test(vTrunc.motivo), 'truncado: motivo claro e explicito', vTrunc.motivo);
ok(vTrunc.paginas === 0, 'truncado: paginas a zero quando invalido', String(vTrunc.paginas));
const vLixo = pdfValido(Buffer.from('isto nao e um pdf valido de todo!!'));
ok(vLixo.ok === false && vLixo.motivo.length > 0, 'lixo: pdfValido rejeita lixo com motivo', vLixo.motivo);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
