/**
 * Testes da Presença por Cadastro (socialscan em Node), sem rede.
 *   node test/presenca.test.ts
 *
 * Protege os parsers de cada plataforma (o que decide "cadastrado" vs "livre"
 * vs "não verificado") e a recusa de entradas inválidas antes de sair para a
 * rede. A chamada real aos endpoints é exercida no site em produção.
 */
import { getTool } from '../src/registry.ts';
import '../src/tools/presenca.ts';
import { lerMozilla, lerPinterest, lerGitlab, lerReddit } from '../src/tools/presenca.ts';
import { TOOL_LOCKS } from '../src/plans.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}
const CTX = { userId: 't', plan: 'free' as const };

// -------------------------------------------------------------- Mozilla
ok(lerMozilla(200, '{"exists":true}').estado === 'registado', 'Mozilla exists:true → cadastrado');
ok(lerMozilla(200, '{"exists":false}').estado === 'livre', 'Mozilla exists:false → livre');
ok(lerMozilla(200, '{"error":101,"message":"x"}').estado === 'erro', 'Mozilla com error → erro');
ok(lerMozilla(500, '').estado === 'erro', 'Mozilla HTTP 500 → erro');
ok(lerMozilla(200, 'nao-json').estado === 'erro', 'Mozilla corpo inválido → erro');

// ------------------------------------------------------------- Pinterest
ok(lerPinterest(200, '{"resource_response":{"data":true}}').estado === 'registado', 'Pinterest data:true → cadastrado');
ok(lerPinterest(200, '{"resource_response":{"data":false}}').estado === 'livre', 'Pinterest data:false → livre');
ok(lerPinterest(200, '{"resource_response":{}}').estado === 'erro', 'Pinterest sem data → erro');
ok(lerPinterest(403, '').estado === 'erro', 'Pinterest HTTP 403 → erro');

// --------------------------------------------------------------- GitLab
{
  const reg = lerGitlab(200, '{"exists":true}', 'ana');
  ok(reg.estado === 'registado' && reg.link === 'https://gitlab.com/ana', 'GitLab exists:true → cadastrado, com link');
  ok(lerGitlab(200, '{"exists":false}', 'ana').estado === 'livre', 'GitLab exists:false → livre');
  ok(lerGitlab(401, '', 'ana').estado === 'registado', 'GitLab 401 também significa username em uso');
  ok(lerGitlab(500, '', 'ana').estado === 'erro', 'GitLab HTTP 500 → erro');
}

// --------------------------------------------------------------- Reddit
ok(lerReddit(200, '{}', 'ana').estado === 'livre', 'Reddit {} → livre');
{
  const taken = lerReddit(200, '{"json":{"errors":[["USERNAME_TAKEN","that username is already taken"]]}}', 'ana');
  ok(taken.estado === 'registado' && taken.link === 'https://www.reddit.com/user/ana', 'Reddit "already taken" → cadastrado, com link');
}
ok(lerReddit(429, '', 'ana').estado === 'erro', 'Reddit 429 → erro (limite)');
ok(lerReddit(200, '{"error":429}', 'ana').estado === 'erro', 'Reddit error:429 no corpo → erro');

// ---------------------------------------------------- validação sem rede
{
  const r = await getTool('social-presence')!.run({ alvo: 'nao tem arroba nem username valido!!' }, CTX);
  ok(r.findings.some((x) => x.group === 'validacao'), 'entrada inválida é recusada sem rede');
  ok(r.log.sources.every((s) => s.id === 'local'), 'entrada inválida não sai para a rede');
}
{
  const r = await getTool('social-presence')!.run({ alvo: 'nome@' }, CTX);
  ok(r.findings.some((x) => x.group === 'validacao'), 'e-mail truncado é recusado sem rede');
}

// --------------------------------------------------------------- catálogo
ok(!!getTool('social-presence'), 'social-presence está registado');
ok(TOOL_LOCKS['social-presence'] === 'free', 'social-presence é Free', String(TOOL_LOCKS['social-presence']));

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
