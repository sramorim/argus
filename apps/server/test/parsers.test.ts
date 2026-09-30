/**
 * Testes unitarios de parsing (sem rede).
 *   node test/parsers.test.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { parseJpegExif, pngTextChunks } from '../src/tools/finance-dev-br.ts';
import { detectSeedType } from '../src/tools/graph.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

// ---------- EXIF com GPS real ----------
const SAMPLE = '/data/data/com.termux/files/usr/tmp/opencode/gps.jpg';
if (existsSync(SAMPLE)) {
  const buf = readFileSync(SAMPLE);
  const exif = parseJpegExif(buf);
  ok(!!exif, 'EXIF: le o segmento Exif de um JPEG real');
  if (exif) {
    console.log('    extraido:', JSON.stringify(exif).slice(0, 400));
    ok(typeof exif.Fabricante === 'string' || typeof exif.Modelo === 'string',
      'EXIF: extrai fabricante/modelo da camara', JSON.stringify(exif));
    ok(typeof exif.GPS === 'string' && /-?\d+\.\d+, -?\d+\.\d+/.test(exif.GPS),
      'EXIF: extrai coordenadas GPS em decimal', String(exif.GPS));
    const [lat, lon] = (exif.GPS ?? '0,0').split(',').map(Number);
    ok(Math.abs(lat) > 0 && Math.abs(lat) < 90 && Math.abs(lon) > 0 && Math.abs(lon) < 180,
      'EXIF: coordenadas dentro de intervalos validos', `${lat},${lon}`);
  }
} else {
  console.log('(amostra gps.jpg ausente — saltando teste EXIF)');
}

// ---------- JPEG sem EXIF ----------
const noExif = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9])]);
ok(parseJpegExif(noExif) === null, 'EXIF: devolve null para JPEG sem segmento Exif');
ok(parseJpegExif(Buffer.from('nao sou um jpeg')) === null, 'EXIF: devolve null para lixo nao-JPEG');

// ---------- deteccao de tipo de alvo ----------
const CASES: [string, string][] = [
  ['torvalds', 'username'], ['github.com', 'dominio'], ['a@b.com', 'email'],
  ['8.8.8.8', 'ip'], ['https://x.com', 'servico'], ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'wallet'],
  ['CVE-2021-44228', 'cve'], ['+5511998877665', 'telefone'], ['11.222.333/0001-81', 'empresa'],
  ['01310-100', 'endereco'],
];
for (const [input, expected] of CASES) {
  const got = detectSeedType(input);
  ok(got === expected, `detectSeedType("${input}") -> ${expected}`, `obtido: ${got}`);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
