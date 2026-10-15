#!/usr/bin/env node
/**
 * Desenha o lobo do ARGOS — arte 100% original, gerada por código.
 *
 * Cabeça de lobo geométrica em traço neon sobre fundo transparente: orelhas
 * pontudas, sobrancelhas angulares, focinho estreito e nós de circuito nas
 * extremidades (é o que o ARGOS faz: liga informação pública). Nada aqui foi
 * copiado de outro aplicativo: cada segmento foi definido à mão neste ficheiro.
 *
 * Saída: `apps/web/public/brand/argos-a.png` (1024x1024, transparente).
 * Depois corre `npm run icons` para regenerar favicon, ícones e capa social.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'apps', 'web', 'public', 'brand', 'argos-a.png');

const NEON = [46, 155, 255];    // --blue #2E9BFF
const NEON_HI = [111, 192, 255]; // destaque #6FC0FF
const NO = [245, 166, 35];      // âmbar dos nós #F5A623

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

const S = 1024;
const png = new PNG({ width: S, height: S });
const X = (u) => u * S;
const Y = (v) => v * S;

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function risca(p, q, w, cor) {
  const ax = X(p[0]), ay = Y(p[1]), bx = X(q[0]), by = Y(q[1]);
  const half = w / 2;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - w));
  const x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx) + w));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - w));
  const y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by) + w));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const al = 1 - smooth(half - 1.2, half + 1.2, distSeg(x + 0.5, y + 0.5, ax, ay, bx, by));
      if (al <= 0) continue;
      const i = (S * y + x) << 2;
      const ab = png.data[i + 3] / 255;
      const ao = al + ab * (1 - al);
      for (let c = 0; c < 3; c++) {
        png.data[i + c] = Math.round((cor[c] * al + png.data[i + c] * ab * (1 - al)) / (ao || 1));
      }
      png.data[i + 3] = Math.round(ao * 255);
    }
  }
}

function no(p, r, cor) {
  const cx = X(p[0]), cy = Y(p[1]);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(S - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(S - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const al = 1 - smooth(r - 1.4, r + 1.4, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
      if (al <= 0) continue;
      const i = (S * y + x) << 2;
      const ab = png.data[i + 3] / 255;
      const ao = al + ab * (1 - al);
      for (let c = 0; c < 3; c++) {
        png.data[i + c] = Math.round((cor[c] * al + png.data[i + c] * ab * (1 - al)) / (ao || 1));
      }
      png.data[i + 3] = Math.round(ao * 255);
    }
  }
}

const W = 34; // espessura do traço
const esp = (lista, cor = NEON) => {
  for (let k = 0; k + 1 < lista.length; k++) risca(lista[k], lista[k + 1], W, cor);
};
const mir = (lista) => lista.map(([u, v]) => [1 - u, v]);

// Orelhas: triângulos pontudos para cima e para fora.
const orelhaE = [[0.10, 0.06], [0.30, 0.20], [0.245, 0.375]];
esp(orelhaE); esp(mir(orelhaE));
// Filete interno da orelha.
const orelhaInE = [[0.165, 0.155], [0.26, 0.225], [0.235, 0.315]];
esp(orelhaInE, NEON_HI); esp(mir(orelhaInE), NEON_HI);

// Testa e sobrancelhas: da orelha ao centro, olhar angular.
const testaE = [[0.30, 0.20], [0.50, 0.315]];
esp(testaE); esp(mir(testaE));
const sobrolhoE = [[0.335, 0.42], [0.455, 0.475]];
esp(sobrolhoE, NEON_HI); esp(mir(sobrolhoE), NEON_HI);

// Laterais: da orelha ao focinho, estreitando.
const lateralE = [[0.245, 0.375], [0.33, 0.60], [0.415, 0.775]];
esp(lateralE); esp(mir(lateralE));

// Focinho: queixo em V e cana do nariz.
const queixo = [[0.415, 0.775], [0.50, 0.845], [0.585, 0.775]];
esp(queixo);
const cana = [[0.50, 0.315], [0.50, 0.66]];
esp(cana, NEON_HI);

// Nós de circuito nas extremidades.
for (const p of [
  [0.10, 0.06], [0.90, 0.06],           // pontas das orelhas
  [0.165, 0.155], [0.835, 0.155],       // filetes
  [0.335, 0.42], [0.665, 0.42],         // olhos
  [0.33, 0.60], [0.67, 0.60],           // maçãs
  [0.50, 0.845],                        // queixo
]) no(p, 20, NO);

writeFileSync(OUT, PNG.sync.write(png));
console.log('lobo gravado em', OUT);
