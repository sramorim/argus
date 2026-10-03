/**
 * Testes unitarios de parsing (sem rede).
 *   node test/parsers.test.ts
 */
import { detectSeedType } from '../src/tools/graph.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

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
