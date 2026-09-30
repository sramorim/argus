/**
 * Entrada de ficheiro para as ferramentas de ficheiro (metadados, pHash).
 *
 * Duas vias, e as duas com as mesmas garantias:
 *  - `upload`: o utilizador envia a imagem do telemóvel (base64 num data URL).
 *    O ficheiro NUNCA é gravado em disco: vive num Buffer só durante o pedido.
 *  - `url`: a ferramenta descarrega a URL com o guard anti-SSRF de sempre.
 *
 * Validação por *magic bytes*, não pelo que o cliente diz: um `.jpg` que
 * começa por `<?php` ou por um ZIP não entra. É isto que impede um upload
 * disfarçado de ser interpreted/executado por alguma etapa seguinte.
 */
import { safeFetchBuffer } from './ssrf.ts';
import type { SourceLog } from './provenance.ts';

export const MAX_FILE_BYTES = 12 * 1024 * 1024;

export type FileKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf' | 'bmp' | 'tiff' | 'heic' | 'zip' | 'desconhecido';

const SIGNATURES: { kind: FileKind; test: (b: Buffer) => boolean }[] = [
  { kind: 'jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { kind: 'gif', test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
  { kind: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { kind: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { kind: 'bmp', test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { kind: 'tiff', test: (b) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) },
  { kind: 'heic', test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypheic' || b.subarray(4, 12).toString('latin1') === 'ftypheix' || b.subarray(4, 12).toString('latin1') === 'ftypmif1' },
  { kind: 'zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) },
];

export function sniff(buf: Buffer): FileKind {
  for (const s of SIGNATURES) if (buf.length >= 12 && s.test(buf)) return s.kind;
  return 'desconhecido';
}

export class FileError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FileError'; }
}

export interface ResolvedFile {
  buffer: Buffer;
  kind: FileKind;
  origin: 'upload' | 'url';
  /** Nome declarado pelo cliente (upload) ou URL de origem. */
  label: string;
  declaredMime?: string;
  ms: number;
}

/**
 * Resolve o ficheiro a analisar. `data` tem de ser um data URL
 * (`data:image/jpeg;base64,...`). `url` é alternativa.
 */
export async function resolveFile(
  log: SourceLog,
  opts: { data?: string; url?: string; name?: string; mime?: string; srcId?: string },
): Promise<ResolvedFile> {
  const srcId = opts.srcId ?? 'ficheiro';
  const t0 = Date.now();
  const data = (opts.data ?? '').trim();
  const url = (opts.url ?? '').trim();

  if (!data && !url) throw new FileError('forneca uma imagem (upload) ou uma URL de ficheiro');

  if (data) {
    const m = /^data:([\w.+-]+\/[\w.+-]+)?(;[\w-]+=[\w-]+)*;base64,([\s\S]+)$/i.exec(data);
    if (!m) throw new FileError('upload invalido: esperava-se um data URL em base64');
    // Confiar no tamanho declarado antes de descodificar evita alocar 200 MB
    // a partir de uma string de 300 MB.
    const b64Len = m[3]!.replace(/\s/g, '').length;
    if (b64Len * 0.75 > MAX_FILE_BYTES) throw new FileError(`ficheiro acima do limite de ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB`);
    const buf = Buffer.from(m[3]!.replace(/\s/g, ''), 'base64');
    if (!buf.length) throw new FileError('upload vazio');
    if (buf.length > MAX_FILE_BYTES) throw new FileError(`ficheiro acima do limite de ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB`);
    const kind = sniff(buf);
    log.ok(srcId, 'Ficheiro enviado por upload (nao e gravado em disco)', opts.name || 'upload', Date.now() - t0, 1, `${buf.length} bytes, tipo real ${kind}`);
    return { buffer: buf, kind, origin: 'upload', label: opts.name || 'upload', declaredMime: m[1], ms: Date.now() - t0 };
  }

  const r = await safeFetchBuffer(url, { timeoutMs: 15_000, maxBytes: MAX_FILE_BYTES });
  if (r.status >= 400) {
    log.empty(srcId, 'Descarregamento do ficheiro', url, r.ms, `HTTP ${r.status}`);
    throw new FileError(`o servidor do ficheiro respondeu HTTP ${r.status}`);
  }
  if (!r.buffer.length) throw new FileError('ficheiro vazio');
  const kind = sniff(r.buffer);
  log.ok(srcId, 'Descarregamento do ficheiro', r.url, r.ms, 1, `${r.buffer.length} bytes, tipo real ${kind}, Content-Type declarado ${r.contentType}`);
  return { buffer: r.buffer, kind, origin: 'url', label: r.url, declaredMime: r.contentType, ms: r.ms };
}
