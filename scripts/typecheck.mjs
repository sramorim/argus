#!/usr/bin/env node
/**
 * Typecheck das duas workspaces, em paralelo e com cache incremental.
 *
 * Porque não `tsc && tsc` em sequência: no Termux (Android, arm64) o TypeScript
 * é limitado pela leitura de ficheiros, não pela CPU — cada `tsc` passava de
 * dois minutos. Em sequência o ciclo eram mais de cinco; em paralelo o
 * trabalho de I/O sobrepõe-se.
 *
 * E o `--incremental` é o que importa no dia a dia: a primeira passagem paga o
 * preço e escreve um `.tsbuildinfo`; as seguintes só refazem o que mudou e
 * passam de segundos. Sem isto, "typecheck" era coisa de meio dia.
 *
 *   node scripts/typecheck.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');

const PROJETOS = [
  { nome: 'server', dir: join(ROOT, 'apps', 'server') },
  { nome: 'web', dir: join(ROOT, 'apps', 'web') },
];

/** Corre um `tsc` e devolve { code, ms, linhas }. */
function corre(nome, dir) {
  return new Promise((resolveP) => {
    const cache = join(dir, 'node_modules', '.cache', 'argus');
    try { mkdirSync(cache, { recursive: true }); } catch { /* sem cache: só fica mais lento */ }
    const t0 = Date.now();
    const filho = spawn(
      process.execPath,
      [TSC, '-p', 'tsconfig.json', '--noEmit', '--incremental', '--tsBuildInfoFile', join(cache, `${nome}.tsbuildinfo`)],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('error', (e) => resolveP({ nome, code: 1, ms: Date.now() - t0, linhas: [`não consegui arrancar o tsc: ${e.message}`] }));
    filho.on('exit', (code) => resolveP({ nome, code: code ?? 1, ms: Date.now() - t0, linhas: saida.split('\n').filter(Boolean) }));
  });
}

const t0 = Date.now();
const resultados = await Promise.all(PROJETOS.map((p) => corre(p.nome, p.dir)));

let falhou = 0;
for (const r of resultados) {
  const estado = r.code === 0 ? '\x1b[32mok\x1b[0m' : '\x1b[31mFALHOU\x1b[0m';
  console.log(`${estado.padEnd(20)} ${r.nome.padEnd(8)} ${(r.ms / 1000).toFixed(1)}s`);
  if (r.linhas.length) for (const l of r.linhas) console.log('   ' + l);
  if (r.code !== 0) falhou++;
}
console.log(`\n${PROJETOS.length - falhou}/${PROJETOS.length} workspaces sem erros de tipo · ${((Date.now() - t0) / 1000).toFixed(1)}s no total`);
process.exit(falhou ? 1 : 0);
