/**
 * Gerador de PDF 1.4 escrito a mao, sem dependencias externas e sem E/S.
 *
 * Produz bytes deterministos para um documento simples (titulo, subtitulo,
 * seccoes, rodape). A tabela `xref` e calculada a partir dos offsets reais
 * em bytes de cada objeto, pelo que a estrutura e valida em qualquer leitor.
 *
 * Codificacao de texto: WinAnsi (Latin-1). Cada carater da cadeia de origem
 * corresponde a um unico octete no fluxo de conteudo — nunca sao emitidas
 * sequencias multi-byte UTF-8. Caracteres com codigo acima de 255 (emoji,
 * cirilico, etc.) nao sao representaveis em WinAnsiEncoding e sao
 * substituidos por `?`.
 */

export interface SecaoPdf {
  titulo: string;
  linhas: string[];
}

export interface DocPdf {
  titulo: string;
  subtitulo?: string;
  seccoes: SecaoPdf[];
  rodape?: string;
}

/** Largura da pagina A4 em pontos. */
const LARGURA = 595;
/** Altura da pagina A4 em pontos. */
const ALTURA = 842;
/** Margem esquerda em pontos. */
const MARGEM_ESQ = 50;
/** Margem superior em pontos. */
const MARGEM_TOPO = 56;
/** Margem inferior em pontos. */
const MARGEM_BASE = 56;
/** Largura util de texto (margens esquerda e direita iguais). */
const LARGURA_UTIL = LARGURA - MARGEM_ESQ * 2;
/** Espaco vertical reservado ao rodape e a numeracao de pagina. */
const RESERVA_RODAPE = 22;
/** Y da linha de rodape/numeracao (base do texto). */
const Y_RODAPE = MARGEM_BASE - 26;
/** Numero maximo de caracteres por linha (~95 para texto de corpo). */
const MAX_CARACTERES = 95;

/** Escala horizontal media da Helvetica usada para estimar larguras. */
const ESCALA_MEDIA = 0.5;

/**
 * Escapa um literal de string PDF: barra invertente, parentesis de abertura
 * e fecho. Os restantes caracteres passam inalterados; a conversao WinAnsi
 * e feita a seguir, octete a octete.
 */
function escaparString(texto: string): string {
  let saida = '';
  for (const ch of texto) {
    if (ch === '\\') saida += '\\\\';
    else if (ch === '(') saida += '\\(';
    else if (ch === ')') saida += '\\)';
    else saida += ch;
  }
  return saida;
}

/** Converte texto ja escapado para octetes WinAnsi (code point > 255 vira `?`). */
function winAnsi(texto: string): Uint8Array {
  const bytes: number[] = [];
  for (const simbolo of texto) {
    const cp = simbolo.codePointAt(0) ?? 63;
    bytes.push(cp > 255 ? 0x3f : cp);
  }
  return Uint8Array.from(bytes);
}

/** Escapa e codifica um literal de texto para o fluxo de conteudo. */
function literal(texto: string): Uint8Array {
  return winAnsi(escaparString(texto));
}

/** Cadeia ASCII (ou WinAnsi) para bytes — usada em estruturas do ficheiro. */
function cadeia(texto: string): Uint8Array {
  return winAnsi(texto);
}

/** Concatena sequencias de bytes. */
function juntar(...partes: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of partes) total += p.length;
  const saida = new Uint8Array(total);
  let off = 0;
  for (const p of partes) {
    saida.set(p, off);
    off += p.length;
  }
  return saida;
}

/** Numero com no maximo duas casas decimais e sem notacao cientifica. */
function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Maximo de caracteres que cabem na largura util para um dado corpo. */
function maxCaracteres(tamanho: number): number {
  const caixa = Math.floor(LARGURA_UTIL / (ESCALA_MEDIA * tamanho));
  return Math.max(10, Math.min(MAX_CARACTERES, caixa));
}

/**
 * Quebra uma linha em blocos dentro do limite de caracteres, aproveitando
 * espacos quando possivel. Palavras maiores que o limite sao cortadas.
 */
function quebrarLinha(texto: string, limite: number): string[] {
  // Remove controlos (incluindo quebras de linha): cada item e uma unica
  // linha do fluxo de conteudo.
  const limpo = texto.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  if (limpo.length <= limite) return [limpo];
  const palavras = limpo.split(/\s+/).filter((p) => p.length > 0);
  if (palavras.length === 0) return [''];
  const blocos: string[] = [];
  let atual = '';
  for (const palavra of palavras) {
    let p = palavra;
    while (p.length > limite) {
      if (atual) { blocos.push(atual); atual = ''; }
      blocos.push(p.slice(0, limite));
      p = p.slice(limite);
    }
    if (!atual) atual = p;
    else if (atual.length + 1 + p.length <= limite) atual += ' ' + p;
    else { blocos.push(atual); atual = p; }
  }
  if (atual) blocos.push(atual);
  return blocos;
}

/** Item de layout: uma linha com fonte, corpo e avanco vertical. */
interface ItemLinha {
  texto: string;
  fonte: 'F1' | 'F2';
  tamanho: number;
  avanco: number;
}

/** Empurra blocos de texto ja quebrados para a lista de itens. */
function empurrar(itens: ItemLinha[], texto: string, fonte: 'F1' | 'F2', tamanho: number, avanco: number): void {
  for (const bloco of quebrarLinha(texto, maxCaracteres(tamanho))) {
    itens.push({ texto: bloco, fonte, tamanho, avanco });
  }
}

/**
 * Converte o documento numa lista plana de itens de layout, ja com as
 * quebras de linha aplicadas. Seccoes vazias nao geram linhas de corpo.
 */
function comporItens(doc: DocPdf): ItemLinha[] {
  const itens: ItemLinha[] = [];
  empurrar(itens, doc.titulo, 'F2', 18, 24);
  if (doc.subtitulo !== undefined && doc.subtitulo !== '') {
    empurrar(itens, doc.subtitulo, 'F1', 12, 17);
  }
  for (const secao of doc.seccoes) {
    itens.push({ texto: '', fonte: 'F1', tamanho: 10, avanco: 12 });
    empurrar(itens, secao.titulo, 'F2', 13, 18);
    for (const linha of secao.linhas) {
      empurrar(itens, linha, 'F1', 10, 14);
    }
  }
  return itens;
}

/** Item ja posicionado com a coordenada Y da linha de base. */
interface ItemPosicionado {
  item: ItemLinha;
  y: number;
}

/**
 * Distribui os itens por paginas. A origem Y e o topo da pagina; a linha de
 * base fica `tamanho` pontos abaixo. Ha sempre pelo menos uma pagina.
 */
function paginar(itens: ItemLinha[]): ItemPosicionado[][] {
  const paginas: ItemPosicionado[][] = [[]];
  const topo = ALTURA - MARGEM_TOPO;
  const minimo = MARGEM_BASE + RESERVA_RODAPE;
  let y = topo;
  for (const item of itens) {
    if (y - item.avanco < minimo && paginas[paginas.length - 1].length > 0) {
      paginas.push([]);
      y = topo;
    }
    const base = y - item.tamanho;
    paginas[paginas.length - 1].push({ item, y: base });
    y -= item.avanco;
  }
  return paginas;
}

/**
 * Constrói o fluxo de conteudo de uma pagina com operadores de texto
 * `BT ... ET` (`Tf` para a fonte, `Td` para a posicao, `Tj` para o literal).
 * Cada linha tem o seu proprio bloco BT/ET, pelo que Td e absoluto.
 */
function conteudoPagina(
  itens: ItemPosicionado[],
  rodape: string | undefined,
  numero: number,
  total: number,
): Uint8Array {
  const partes: Uint8Array[] = [];
  for (const { item, y } of itens) {
    partes.push(cadeia(`BT\n/${item.fonte} ${num(item.tamanho)} Tf\n`));
    partes.push(cadeia(`${num(MARGEM_ESQ)} ${num(y)} Td\n`));
    partes.push(cadeia('('));
    partes.push(literal(item.texto));
    partes.push(cadeia(`) Tj\nET\n`));
  }
  if (rodape) {
    partes.push(cadeia(`BT\n/F1 8 Tf\n${num(MARGEM_ESQ)} ${num(Y_RODAPE)} Td\n`));
    partes.push(cadeia('('));
    partes.push(literal(rodape));
    partes.push(cadeia(`) Tj\nET\n`));
  }
  // Numeracao sempre presente, alinhada a direita.
  const etiqueta = `P\u00e1gina ${numero}/${total}`;
  const largura = etiqueta.length * ESCALA_MEDIA * 8;
  const xDir = Math.max(MARGEM_ESQ, LARGURA - MARGEM_ESQ - largura);
  partes.push(cadeia(`BT\n/F1 8 Tf\n${num(xDir)} ${num(Y_RODAPE)} Td\n`));
  partes.push(cadeia('('));
  partes.push(literal(etiqueta));
  partes.push(cadeia(`) Tj\nET\n`));
  return juntar(...partes);
}

/** Serializa um fluxo (`stream ... endstream`) com o comprimento correto. */
function serializarStream(dados: Uint8Array): Uint8Array {
  return juntar(
    cadeia(`<< /Length ${dados.length} >>\nstream\n`),
    dados,
    cadeia(`\nendstream`),
  );
}

/**
 * Serializa o documento completo: cabecalho, catalogo, arvore de paginas,
 * fontes, paginas, fluxos de conteudo, `xref`, `trailer`, `startxref` e
 * `%%EOF`. Os offsets da tabela sao os offsets octeto a octete reais.
 */
export function montarPdf(doc: DocPdf): Uint8Array {
  const paginas = paginar(comporItens(doc));
  const total = paginas.length;

  // Numeracao dos objetos:
  //   1 catalogo, 2 arvore de paginas, 3 fonte normal, 4 fonte negrito;
  //   depois, por pagina: objeto de pagina e respetivo fluxo de conteudo.
  const objCatalogo = 1;
  const objArvore = 2;
  const objF1 = 3;
  const objF2 = 4;

  const numerosPagina: number[] = [];
  const numerosConteudo: number[] = [];
  for (let i = 0; i < total; i++) {
    numerosPagina.push(5 + i * 2);
    numerosConteudo.push(6 + i * 2);
  }

  const objs: Array<{ numero: number; corpo: Uint8Array }> = [];

  for (let i = 0; i < total; i++) {
    const dados = conteudoPagina(paginas[i], doc.rodape, i + 1, total);
    objs.push({ numero: numerosConteudo[i], corpo: serializarStream(dados) });
    objs.push({
      numero: numerosPagina[i],
      corpo: cadeia(
        `<< /Type /Page /Parent ${objArvore} 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] ` +
          `/Resources << /Font << /F1 ${objF1} 0 R /F2 ${objF2} 0 R >> >> ` +
          `/Contents ${numerosConteudo[i]} 0 R >>`,
      ),
    });
  }

  const kids = numerosPagina.map((n) => `${n} 0 R`).join(' ');
  objs.push({ numero: objArvore, corpo: cadeia(`<< /Type /Pages /Count ${total} /Kids [${kids}] >>`) });
  objs.push({
    numero: objF1,
    corpo: cadeia('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  });
  objs.push({
    numero: objF2,
    corpo: cadeia('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  });
  objs.push({ numero: objCatalogo, corpo: cadeia(`<< /Type /Catalog /Pages ${objArvore} 0 R >>`) });
  objs.sort((a, b) => a.numero - b.numero);

  const cabecalho = cadeia('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  const pedacos: Uint8Array[] = [cabecalho];
  let offset = cabecalho.length;
  const offsets = new Map<number, number>();
  for (const obj of objs) {
    const oCabeca = cadeia(`${obj.numero} 0 obj\n`);
    const oCauda = cadeia('\nendobj\n');
    offsets.set(obj.numero, offset);
    pedacos.push(oCabeca, obj.corpo, oCauda);
    offset += oCabeca.length + obj.corpo.length + oCauda.length;
  }

  const inicioXref = offset;
  const maxObj = objs.length > 0 ? objs[objs.length - 1].numero : 0;
  const conta = maxObj + 1;
  let xref = `xref\n0 ${conta}\n`;
  xref += '0000000000 65535 f \n';
  for (let n = 1; n <= maxObj; n++) {
    const off = offsets.get(n);
    xref += off === undefined
      ? '0000000000 65535 f \n'
      : `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${conta} /Root ${objCatalogo} 0 R >>\n` +
    `startxref\n${inicioXref}\n%%EOF\n`;
  pedacos.push(cadeia(xref), cadeia(trailer));

  return juntar(...pedacos);
}

/**
 * Valida a estrutura basica de um PDF gerado por `montarPdf` (ou de outro
 * documento com a mesma forma): cabecalho, `%%EOF`, `startxref` coerente e
 * tabela `xref` cujos offsets apontam para `<n> 0 obj`.
 *
 * Nao e um leitor de PDF completo: verifica apenas o que o gerador garante.
 */
export function pdfValido(b: Uint8Array): { ok: boolean; motivo: string; paginas: number } {
  const falha = (motivo: string): { ok: boolean; motivo: string; paginas: number } => ({
    ok: false, motivo, paginas: 0,
  });

  if (b.length < 16) return falha('documento demasiado curto');
  let texto = '';
  for (let i = 0; i < b.length; i++) texto += String.fromCharCode(b[i]);

  if (!texto.startsWith('%PDF-1.4')) return falha('cabecalho %PDF-1.4 em falta');
  const fim = texto.replace(/\s+$/, '');
  if (!fim.endsWith('%%EOF')) {
    return texto.includes('%%EOF')
      ? falha('marca %%EOF nao termina o documento')
      : falha('marca %%EOF em falta (documento truncado)');
  }

  const idxStart = texto.lastIndexOf('startxref');
  if (idxStart < 0) return falha('startxref em falta');
  const mNum = texto.slice(idxStart + 'startxref'.length).trim().match(/^(\d+)/);
  if (!mNum) return falha('valor de startxref ausente ou invalido');
  const offXref = Number(mNum[1]);
  if (!Number.isInteger(offXref) || offXref <= 0 || offXref >= b.length) {
    return falha('offset de startxref fora do documento');
  }
  if (!texto.startsWith('xref', offXref)) return falha('startxref nao aponta para a palavra xref');

  const linhas = texto.slice(offXref).split('\n');
  if (linhas[0].trim() !== 'xref') return falha('tabela xref em falta');
  const cab = (linhas[1] ?? '').trim().split(/\s+/);
  if (cab.length !== 2) return falha('cabecalho xref invalido');
  const primeiro = Number(cab[0]);
  const conta = Number(cab[1]);
  if (!Number.isInteger(primeiro) || !Number.isInteger(conta) || conta < 1) {
    return falha('cabecalho xref nao numerico');
  }

  for (let i = 0; i < conta; i++) {
    const campos = (linhas[2 + i] ?? '').trim().split(/\s+/);
    if (campos.length !== 3) return falha(`entrada xref ${i} malformada`);
    const off = Number(campos[0]);
    const tipo = campos[2];
    if (!Number.isInteger(off)) return falha(`offset xref ${i} nao numerico`);
    if (tipo === 'n') {
      if (off <= 0 || off >= b.length) return falha(`offset xref ${i} fora do documento`);
      const etiqueta = `${i} 0 obj`;
      let bate = true;
      for (let k = 0; k < etiqueta.length; k++) {
        if (b[off + k] !== etiqueta.charCodeAt(k)) { bate = false; break; }
      }
      if (!bate) return falha(`offset xref ${i} nao aponta para "${etiqueta}"`);
    } else if (tipo !== 'f') {
      return falha(`entrada xref ${i} com tipo desconhecido "${tipo}"`);
    }
  }

  const mCount = texto.match(/\/Type\s*\/Pages\s*\/Count\s+(\d+)/);
  const paginas = mCount ? Number(mCount[1]) : 0;
  if (!Number.isInteger(paginas) || paginas <= 0) return falha('numero de paginas invalido');

  return { ok: true, motivo: 'ok', paginas };
}
