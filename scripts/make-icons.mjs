#!/usr/bin/env node
/**
 * Gera os ícones PNG do ARGOS a partir da mesma geometria do SVG.
 *
 * Porquê um script em vez de exportar de um editor: o logo tem de ser
 * reproduzível. Se amanhã o traço mudar, `node scripts/make-icons.mjs` volta a
 * gerar tudo — e ninguém depende de um ficheiro binário que ninguém sabe
 * editar.
 *
 * Saída: apps/web/public/{favicon.png, apple-touch-icon.png, icon-192.png,
 *         icon-512.png, og-cover.png}
 */import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'apps', 'web', 'public');

// Geometria em coordenadas 0..32 (a mesma do SVG).
const SILVER = [200, 205, 212];
const RED = [185, 28, 28];
const RED_HI = [220, 38, 38];
const BG = [11, 13, 16];
const BG2 = [20, 23, 28];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/** Cobertura 0..1 de um pixel, com supersampling 3x3. */
function render(size) {
  const png = new PNG({ width: size, height: size });
  const S = 3;
  const scale = 32 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) * scale;
          const y = (py + (sy + 0.5) / S) * scale;
          const c = shade(x, y);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = S * S;
      const i = (size * py + px) << 2;
      if (a > 0) { png.data[i] = Math.round(r / a); png.data[i + 1] = Math.round(g / a); png.data[i + 2] = Math.round(b / a); }
      png.data[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png;
}

/** Cor com alfa para um ponto (x,y) em coordenadas 0..32. */
function shade(x, y) {
  const cx = 16, cy = 16;
  const d = Math.hypot(x - cx, y - cy);
  const rr = 6.9;                              // raio do quadrado arredondado (unidades 0..32)
  const half = 16;

  // Fundo: quadrado arredondado, com um leve gradiente diagonal.
  const qx = Math.abs(x - cx) - (half - rr);
  const qy = Math.abs(y - cy) - (half - rr);
  const inBg = x >= 0 && y >= 0 && x <= 32 && y <= 32
    && (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr) <= 0;
  if (!inBg) return [0, 0, 0, 0];

  const t = clamp((x + y) / 64);
  let col = [BG[0] + (BG2[0] - BG[0]) * t, BG[1] + (BG2[1] - BG[1]) * t, BG[2] + (BG2[2] - BG[2]) * t];

  // Anel exterior (prata, discreto)
  const ringOuter = Math.max(0, 1 - Math.abs(d - 13.7) / 0.7);
  col = over(col, SILVER, ringOuter * 0.34);

  // Forma do olho (superelipse n=1.35): contorno a prata
  const u = x - cx, v = y - cy;
  const e = Math.pow(Math.abs(u / 11.6), 1.35) + Math.pow(Math.abs(v / 6.7), 1.35);
  const edge = 1 - smooth(0, 0.06, Math.abs(e - 1));
  col = over(col, SILVER, edge * 0.95);

  // Anel da íris
  const iris = 1 - smooth(0.35, 0.75, Math.abs(d - 6.2));
  col = over(col, SILVER, iris * 0.8);

  // Pupila: vermelho profundo com um degradé para o canto superior
  const pt = clamp(1 - d / 3.6);
  const pr = RED[0] + (RED_HI[0] - RED[0]) * (1 - pt);
  const pg = RED[1] + (RED_HI[1] - RED[1]) * (1 - pt);
  const pb = RED[2] + (RED_HI[2] - RED[2]) * (1 - pt);
  const pupil = 1 - smooth(3.0, 3.5, d);
  col = over(col, [pr, pg, pb], pupil);

  // Brilho especular
  const spec = 1 - smooth(0.7, 1.25, Math.hypot(x - (cx + 2.3), y - (cy - 2.3)));
  col = over(col, [245, 247, 250], spec * 0.85);

  return [col[0], col[1], col[2], 1];
}

/**
 * Marca com fundo transparente, superamostrada. Usada na capa social, onde o
 * quadrado arredondado do ícone ficava a mais sobre o grafite do cartão.
 */
function markShade(x, y) {
  const c = shade(x, y);
  if (c[3] <= 0) return c;
  // o fundo do quadrado arredondado passa a alpha
  const cx = 16, cy = 16, rr = 6.9, half = 16;
  const qx = Math.abs(x - cx) - (half - rr);
  const qy = Math.abs(y - cy) - (half - rr);
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  const inside = 1 - smooth(-0.8, 0.2, sd);
  return [c[0], c[1], c[2], inside];
}

function over(base, top, alpha) {
  const a = clamp(alpha);
  if (a <= 0) return base;
  return [base[0] * (1 - a) + top[0] * a, base[1] * (1 - a) + top[1] * a, base[2] * (1 - a) + top[2] * a];
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['favicon.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];
for (const [name, size] of targets) {
  const png = render(size);
  const buf = PNG.sync.write(png);
  writeFileSync(join(OUT, name), buf);
  console.log(`${name.padEnd(22)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------------------
// Capa social (og:image).
//
// Tem de ser 1200x630: as plataformas cortam a imagem a 1.91:1 e um quadrado
// de 512x512 aparecia minúsculo, com barras pretas dos lados. O 512x512 continua
// a ser o ícone da app — são coisas diferentes.
// ---------------------------------------------------------------------------

/** Distância de um ponto a um segmento, para desenhar traços com antisserrilhado. */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Letra do logótipo como traços normalizados (caixa 0..1, base em y=1).
 * Traço técnico, não uma fonte: é o que mantém a identidade do ARGOS —
 * um SVG não dá para controlar a renderização de texto num PNG social.
 */
const WORDMARK = {
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.21, 0.63], [0.79, 0.63]]],
  R: [[[0, 0], [0, 1]], [[0, 0], [0.68, 0], [0.94, 0.27], [0.68, 0.54], [0, 0.54]], [[0.52, 0.54], [1, 1]]],
  G: [[[0.94, 0.24], [0.72, 0.02], [0.34, 0.02], [0.05, 0.3], [0.05, 0.7], [0.34, 0.98], [0.72, 0.98], [0.95, 0.75], [0.95, 0.56], [0.58, 0.56]]],
  O: [[[0.94, 0.27], [0.72, 0.02], [0.28, 0.02], [0.05, 0.27], [0.05, 0.73], [0.28, 0.98], [0.72, 0.98], [0.94, 0.73], [0.94, 0.27]]],
  S: [[[0.94, 0.21], [0.7, 0.02], [0.3, 0.02], [0.05, 0.25], [0.3, 0.5], [0.72, 0.5], [0.95, 0.72], [0.7, 0.98], [0.28, 0.98], [0.05, 0.79]]],
};
const tracking = 0.26;

/** Largura normalizada da palavra (inclui o espaçamento entre letras). */
function wordWidth(n) { return n + (n - 1) * tracking; }

function renderCover(W = 1200, H = 630) {
  const png = new PNG({ width: W, height: H });
  const data = png.data;
  const cx = W / 2;

  // Fundo: grafite com um brilho radial suave atrás do símbolo.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) << 2;
      const d = Math.hypot((x - cx) / (W * 0.62), (y - H * 0.42) / (H * 0.72));
      const glow = Math.max(0, 1 - d) ** 2.2;
      const vig = 1 - 0.28 * Math.min(1, Math.hypot((x - cx) / cx, (y - H / 2) / (H / 2)) ** 2);
      const base = 10 + 9 * glow;
      const v = base * vig;
      data[i] = Math.round(v * 1.02);
      data[i + 1] = Math.round(v * 1.06);
      data[i + 2] = Math.round(v * 1.15);
      data[i + 3] = 255;
    }
  }

  // Símbolo, centrado no terço superior.
  const markSize = 168;
  const markX = cx - markSize / 2;
  const markY = 118;
  for (let py = 0; py < markSize; py++) {
    for (let px = 0; px < markSize; px++) {
      const c = markShade(((px + 0.5) / markSize) * 32, ((py + 0.5) / markSize) * 32);
      if (c[3] <= 0) continue;
      const i = (W * (markY + py) + (markX + px)) << 2;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
      data[i + 3] = Math.round(255 * c[3]);
    }
  }

  // Filete vermelho por baixo do símbolo.
  const barY = markY + markSize + 30, barH = 3, barW = 96;
  for (let y = barY; y < barY + barH; y++) {
    for (let x = cx - barW / 2; x < cx + barW / 2; x++) {
      const i = (W * y + x) << 2;
      data[i] = 220; data[i + 1] = 38; data[i + 2] = 38;
    }
  }

  // Logótipo ARGOS em traço, centrado por baixo.
  const capH = 74;
  const letters = Object.keys(WORDMARK);
  const totalW = wordWidth(letters.length) * capH;
  let penX = cx - totalW / 2;
  const textTop = barY + barH + 46;
  const stroke = capH * 0.1;
  for (const ch of letters) {
    const paths = WORDMARK[ch];
    for (const poly of paths) {
      for (let k = 0; k + 1 < poly.length; k++) {
        strokeLine(poly[k], poly[k + 1], penX, textTop, capH, stroke, data, W, H);
      }
    }
    penX += capH * (1 + tracking);
  }

  // Subtítulo: uma linha de texto real não é controlável num PNG, por isso
  // fica um traço discreto que dá peso sem prometer o que não está escrito.
  const subY = textTop + capH + 34, subW = totalW * 0.42;
  for (let y = subY; y < subY + 2; y++) {
    for (let x = cx - subW / 2; x < cx + subW / 2; x++) {
      const i = (W * y + x) << 2;
      data[i] = 58; data[i + 1] = 64; data[i + 2] = 72;
    }
  }
  return png;
}

/** Rasteriza um segmento do logótipo (coords normalizadas -> píxeis). */
function strokeLine(a, b, ox, oy, capH, stroke, data, W, H) {
  const ax = ox + a[0] * capH, ay = oy + a[1] * capH;
  const bx = ox + b[0] * capH, by = oy + b[1] * capH;
  const pad = stroke;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + pad));
  const half = stroke / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = distSeg(x + 0.5, y + 0.5, ax, ay, bx, by);
      const a = 1 - smooth(half - 0.9, half + 0.9, d);
      if (a <= 0) continue;
      const i = (W * y + x) << 2;
      data[i] = Math.round(data[i] * (1 - a) + SILVER[0] * a);
      data[i + 1] = Math.round(data[i + 1] * (1 - a) + SILVER[1] * a);
      data[i + 2] = Math.round(data[i + 2] * (1 - a) + SILVER[2] * a);
    }
  }
}

{
  const png = renderCover(1200, 630);
  const buf = PNG.sync.write(png);
  writeFileSync(join(OUT, 'og-cover.png'), buf);
  console.log(`${'og-cover.png'.padEnd(22)} 1200x630 ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log('ícones gerados em', OUT);
