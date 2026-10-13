#!/usr/bin/env node
/**
 * Gera os ícones e imagens da marca ARGOS a partir de UMA fonte:
 * `apps/web/public/brand/argos-a.png` (o "A" em duas faixas com a conexão,
 * fundo transparente), exportada do vector `public/brand/argos-a.svg`.
 *
 * Porquê um script: a marca tem de ser reproduzível. Se o símbolo mudar,
 * troca-se o ficheiro-fonte e `npm run icons` volta a gerar tudo — favicon,
 * ícones da app, a versão pequena da interface, os SVG e a capa social.
 *
 * Saída em apps/web/public:
 *   brand/argos-a-128.png        símbolo pequeno, usado pela interface (Mark)
 *   favicon.png                  32x32, fundo transparente
 *   apple-touch-icon.png, icon-192.png, icon-512.png   sobre azul-marinho
 *   favicon.svg, logo-mark.svg   o símbolo embutido (data URI), para <link rel=icon>
 *   logo.svg                     símbolo + palavra ARGOS + "Inteligência digital"
 *   og-cover.png                 1200x630, capa para redes sociais
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'apps', 'web', 'public');
const FONTE = join(OUT, 'brand', 'argos-a.png');

/* Cores do Design System (as mesmas de apps/web/src/styles.css). */
const NAVY = [5, 13, 31];          // --bg       #050D1F
const NAVY_2 = [15, 30, 61];       // --surface-2 #0F1E3D
const ACCENT = [46, 155, 255];     // --blue     #2E9BFF
const WHITE = [255, 255, 255];
const SUB = [169, 183, 208];       // --t-2      #A9B7D0

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

const src = PNG.sync.read(readFileSync(FONTE));

/**
 * Reduz a imagem-fonte para `size`x`size` com média por área (alfa
 * pré-multiplicado): cada píxel de destino é a média ponderada dos píxeis de
 * origem que cobre. É o que evita o serrilhado e as franjas escuras ao reduzir
 * uma imagem com transparência.
 */
function reduz(size) {
  const out = new Float64Array(size * size * 4);
  const k = src.width / size;
  for (let dy = 0; dy < size; dy++) {
    const y0 = dy * k, y1 = y0 + k;
    for (let dx = 0; dx < size; dx++) {
      const x0 = dx * k, x1 = x0 + k;
      let r = 0, g = 0, b = 0, a = 0, peso = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (src.width * sy + sx) << 2;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al * w; g += src.data[i + 1] * al * w; b += src.data[i + 2] * al * w;
          a += al * w; peso += w;
        }
      }
      const o = (size * dy + dx) << 2;
      out[o] = a ? r / a : 0; out[o + 1] = a ? g / a : 0; out[o + 2] = a ? b / a : 0; out[o + 3] = a / peso;
    }
  }
  return out;
}

/** Pinta o símbolo reduzido sobre `png`, em (ox, oy), com o lado `size`. */
function cola(png, size, ox, oy) {
  const s = reduz(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ox + x, py = oy + y;
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
      const o = (size * y + x) << 2;
      const a = s[o + 3];
      if (a <= 0) continue;
      const i = (png.width * py + px) << 2;
      const ab = png.data[i + 3] / 255;
      const ao = a + ab * (1 - a);
      for (let c = 0; c < 3; c++) {
        png.data[i + c] = Math.round((s[o + c] * a + png.data[i + c] * ab * (1 - a)) / (ao || 1));
      }
      png.data[i + 3] = Math.round(ao * 255);
    }
  }
}

/** O símbolo sozinho, fundo transparente. */
function soSimbolo(size) {
  const png = new PNG({ width: size, height: size });
  cola(png, size, 0, 0);
  return png;
}

/**
 * Ícone da app: o símbolo sobre um quadrado arredondado azul-marinho, com um
 * halo azul por trás. O ecrã do telemóvel corta os cantos sozinho em alguns
 * sistemas; o quadrado cobre a imagem toda para nunca sobrar transparência.
 */
function icone(size) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      const t = clamp((x + y) / (2 * size));
      const d = Math.hypot(x / size - 0.5, y / size - 0.56) / 0.5;
      const halo = Math.max(0, 1 - d) ** 2 * 0.55;
      for (let c = 0; c < 3; c++) {
        const base = NAVY_2[c] + (NAVY[c] - NAVY_2[c]) * t;
        png.data[i + c] = Math.round(base + (ACCENT[c] - base) * halo * 0.6);
      }
      png.data[i + 3] = 255;
    }
  }
  const pad = Math.round(size * 0.13);
  cola(png, size - 2 * pad, pad, pad + Math.round(size * 0.02));
  return png;
}

const grava = (nome, png) => {
  const buf = PNG.sync.write(png);
  writeFileSync(join(OUT, nome), buf);
  console.log(`${nome.padEnd(24)} ${png.width}x${png.height}  ${(buf.length / 1024).toFixed(1)} KB`);
  return buf;
};

mkdirSync(join(OUT, 'brand'), { recursive: true });
grava('brand/argos-a-128.png', soSimbolo(128));
grava('favicon.png', soSimbolo(32));
grava('apple-touch-icon.png', icone(180));
grava('icon-192.png', icone(192));
grava('icon-512.png', icone(512));

// ---------------------------------------------------------------- SVG
// O SVG usado como ícone (<link rel="icon">) não pode pedir ficheiros de fora:
// o símbolo vai embutido como data URI, a partir de uma versão de 64 px.
const b64 = PNG.sync.write(soSimbolo(64)).toString('base64');
const simboloSvg = (x, y, s) => `<image x="${x}" y="${y}" width="${s}" height="${s}" href="data:image/png;base64,${b64}"/>`;
const aviso = '<!-- ARGOS — gerado por scripts/make-icons.mjs a partir de public/brand/argos-a.png. Não editar à mão. -->';
const mark = `${aviso}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="ARGOS">
  ${simboloSvg(0, 0, 32)}
</svg>
`;
writeFileSync(join(OUT, 'logo-mark.svg'), mark);
writeFileSync(join(OUT, 'favicon.svg'), mark);
writeFileSync(join(OUT, 'logo.svg'), `${aviso}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 272 56" width="272" height="56" role="img" aria-label="ARGOS — inteligência digital">
  ${simboloSvg(2, 6, 44)}
  <text x="54" y="33" fill="#FFFFFF" font-family="Montserrat,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
        font-size="26" font-weight="800" letter-spacing="4">ARGOS</text>
  <text x="55" y="46" fill="#A9B7D0" font-family="Inter,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
        font-size="8.2" font-weight="600" letter-spacing="2.2">INTELIGÊNCIA DIGITAL</text>
</svg>
`);
console.log('favicon.svg, logo-mark.svg, logo.svg');

// ---------------------------------------------------------------------------
// Capa social (og:image), 1200x630: as plataformas cortam a 1.91:1, e um
// quadrado de 512 aparecia minúsculo, com barras pretas dos lados.
// ---------------------------------------------------------------------------

/** Distância de um ponto a um segmento, para desenhar traços com antisserrilhado. */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Letras da palavra ARGOS como traços normalizados (caixa 0..1, base em y=1):
 * num PNG não há fontes, e um traço técnico mantém a palavra nítida.
 */
const WORDMARK = {
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.21, 0.63], [0.79, 0.63]]],
  R: [[[0, 0], [0, 1]], [[0, 0], [0.68, 0], [0.94, 0.27], [0.68, 0.54], [0, 0.54]], [[0.52, 0.54], [1, 1]]],
  G: [[[0.94, 0.24], [0.72, 0.02], [0.34, 0.02], [0.05, 0.3], [0.05, 0.7], [0.34, 0.98], [0.72, 0.98], [0.95, 0.75], [0.95, 0.56], [0.58, 0.56]]],
  O: [[[0.94, 0.27], [0.72, 0.02], [0.28, 0.02], [0.05, 0.27], [0.05, 0.73], [0.28, 0.98], [0.72, 0.98], [0.94, 0.73], [0.94, 0.27]]],
  S: [[[0.94, 0.21], [0.7, 0.02], [0.3, 0.02], [0.05, 0.25], [0.3, 0.5], [0.72, 0.5], [0.95, 0.72], [0.7, 0.98], [0.28, 0.98], [0.05, 0.79]]],
};
const tracking = 0.26;
const wordWidth = (n) => n + (n - 1) * tracking;

function traco(a, b, ox, oy, capH, stroke, png, cor) {
  const { data, width: W, height: H } = png;
  const ax = ox + a[0] * capH, ay = oy + a[1] * capH;
  const bx = ox + b[0] * capH, by = oy + b[1] * capH;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - stroke));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + stroke));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - stroke));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + stroke));
  const half = stroke / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const al = 1 - smooth(half - 0.9, half + 0.9, distSeg(x + 0.5, y + 0.5, ax, ay, bx, by));
      if (al <= 0) continue;
      const i = (W * y + x) << 2;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - al) + cor[c] * al);
    }
  }
}

function capa(W = 1200, H = 630) {
  const png = new PNG({ width: W, height: H });
  const cx = W / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) << 2;
      const d = Math.hypot((x - cx) / (W * 0.55), (y - H * 0.38) / (H * 0.7));
      const glow = Math.max(0, 1 - d) ** 2.2;
      for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(NAVY[c] + (ACCENT[c] - NAVY[c]) * glow * 0.32);
      png.data[i + 3] = 255;
    }
  }
  const lado = 300;
  cola(png, lado, Math.round(cx - lado / 2), 40);

  const capH = 70;
  const letras = Object.keys(WORDMARK);
  const total = wordWidth(letras.length) * capH;
  let penX = cx - total / 2;
  const topo = 40 + lado + 30;
  for (const ch of letras) {
    for (const poly of WORDMARK[ch]) {
      for (let k = 0; k + 1 < poly.length; k++) traco(poly[k], poly[k + 1], penX, topo, capH, capH * 0.1, png, WHITE);
    }
    penX += capH * (1 + tracking);
  }
  // Filete do accent por baixo da palavra.
  const fy = topo + capH + 34;
  for (let y = fy; y < fy + 3; y++) {
    for (let x = Math.round(cx - 70); x < Math.round(cx + 70); x++) {
      const i = (W * y + x) << 2;
      png.data[i] = ACCENT[0]; png.data[i + 1] = ACCENT[1]; png.data[i + 2] = ACCENT[2];
    }
  }
  // Traço discreto no lugar do subtítulo (texto real não é controlável num PNG).
  for (let y = fy + 22; y < fy + 24; y++) {
    for (let x = Math.round(cx - 140); x < Math.round(cx + 140); x++) {
      const i = (W * y + x) << 2;
      png.data[i] = SUB[0]; png.data[i + 1] = SUB[1]; png.data[i + 2] = SUB[2];
    }
  }
  return png;
}

grava('og-cover.png', capa(1200, 630));
console.log('ícones gerados em', OUT);
