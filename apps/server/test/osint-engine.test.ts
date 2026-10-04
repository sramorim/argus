/**
 * Testes do OSINT Engine (sem rede, sem instalar nada).
 *   node test/osint-engine.test.ts
 *
 * O que se protege aqui é a parte que NÃO se vê a correr contra alvos reais:
 * a deteção de tipo de alvo, o que a ferramenta diz que falta antes de tocar a
 * qualquer processo, e a árvore de classificação da saída de um CLI — em
 * particular que saída ilegível vira ERROR e não "resultado encontrado".
 */
import { getTool } from '../src/registry.ts';
import '../src/tools/osint-engine.ts';
import {
  PROVIDERS, detectarTipo, planejar, classificar, TIPOS_DE_ALVO,
  type ProviderOsint, type TipoAlvo,
} from '../src/providers/osint.ts';
import type { CliSaida } from '../src/providers/runtime.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

const p = (id: string): ProviderOsint => {
  const f = PROVIDERS.find((x) => x.id === id);
  if (!f) throw new Error(`provider inexistente no registo: ${id}`);
  return f;
};

const saida = (s: Partial<CliSaida>): CliSaida => ({
  estado: 'ok', stdout: '', stderr: '', ms: 10, codigo: null, truncado: false, nota: '', ...s,
});

// --------------------------------------------------------- registo dos 5
ok(PROVIDERS.length === 5, 'estão os cinco providers do escopo', String(PROVIDERS.length));
for (const id of ['spiderfoot', 'photon', 'openosint', 'ghunt', 'holehe']) {
  const x = p(id);
  ok(!!x.licenca && !!x.repo && !!x.instalacao && x.tipos.length > 0 && !!x.binario !== !!x.envCaminho,
    `${x.nome}: licença, repo, instalação, tipos e UMA forma de execução declarados`);
}
ok(PROVIDERS.every((x) => /https:\/\/github\.com\//.test(x.repo)), 'todos apontam para o repositório oficial');
ok(PROVIDERS.some((x) => x.envCaminho === 'ARGUS_SPIDERFOOT') && PROVIDERS.some((x) => x.envCaminho === 'ARGUS_PHOTON'),
  'spiderfoot/photon entram por variável ARGUS_* (não estão no PATH)');

// ------------------------------------------------------------- tipos de alvo
ok(detectarTipo('pessoa@exemplo.com') === 'email', 'detectarTipo: email');
ok(detectarTipo('example.com') === 'dominio', 'detectarTipo: domínio');
ok(detectarTipo('1.1.1.1') === 'ip', 'detectarTipo: IP');
ok(detectarTipo('torvalds') === 'username', 'detectarTipo: username');
ok(detectarTipo('not-found-xyz') === 'username', 'detectarTipo: sem ponto não é domínio');
ok(TIPOS_DE_ALVO.size === 4, 'quatro tipos de alvo aceites');

// -------------------------------------------------------------- planejar
const sp = planejar(p('spiderfoot'), 'example.com', 'dominio', '/tmp/t.json', {});
ok(sp.estado === 'NOT_CONFIGURED' && /ARGUS_SPIDERFOOT/.test((sp as { nota: string }).nota)
  && /git clone/.test((sp as { nota: string }).nota),
  'spiderfoot sem variável: NOT_CONFIGURED com o nome EXATO do que falta e o comando de instalação');

const spPronto = planejar(p('spiderfoot'), 'example.com', 'dominio', '/tmp/t.json', { ARGUS_SPIDERFOOT: '/opt/sf/sf.py' });
ok(spPronto.estado === 'PRONTO' && spPronto.executavel === 'python3' && spPronto.args[0] === '/opt/sf/sf.py'
  && spPronto.args.includes('example.com'),
  'spiderfoot com caminho: corre por python3 com o script e o alvo em argv');

const ph = planejar(p('photon'), 'example.com', 'dominio', '/tmp/t.json', { ARGUS_PHOTON: '/opt/photon.py' });
ok(ph.estado === 'PRONTO' && ph.args.includes('--stdout'), 'photon: --stdout documentado no repo');

const hg = planejar(p('ghunt'), 'a@b.com', 'email', '/tmp/x.json', {});
ok(hg.estado === 'PRONTO' && hg.executavel === 'ghunt' && hg.args.includes('/tmp/x.json'),
  'ghunt: binário no PATH e --json com ficheiro temporário');

const ho = planejar(p('holehe'), 'a@b.com', 'email', '/tmp/x.json', {});
ok(ho.estado === 'PRONTO' && ho.executavel === 'holehe' && ho.args.length === 1 && ho.args[0] === 'a@b.com',
  'holehe: só o email, sem flags inventadas');

const inc = planejar(p('holehe'), 'example.com', 'dominio', '/tmp/x.json', {});
ok(inc.estado === 'INCOMPATIBLE' && /email/.test((inc as { nota: string }).nota),
  'holehe com domínio: INCOMPATIBLE a dizer que só aceita email');

const oo = planejar(p('openosint'), 'a@b.com', 'email', '/tmp/x.json', {});
ok(oo.estado === 'PRONTO' && oo.args[0] === 'email', 'openosint: subcomando email');
const ou = planejar(p('openosint'), 'torvalds', 'username', '/tmp/x.json', {});
ok(ou.estado === 'PRONTO' && ou.args[0] === 'username', 'openosint: subcomendo username');

// ----------------------------------------------------------- classificar
const naoInst = classificar(p('holehe'), saida({ estado: 'nao-instalado', nota: 'caminho não encontrado: holehe' }));
ok(naoInst.estado === 'NOT_INSTALLED' && /pip3 install holehe/.test(naoInst.nota),
  'binário em falta: NOT_INSTALLED com o comando de instalação');

ok(classificar(p('holehe'), saida({ estado: 'timeout', nota: 'sem saída dentro de 90s' })).estado === 'ERROR',
  'timeout é ERROR (nunca "nada encontrado")');

const semSaida = classificar(p('photon'), saida({ estado: 'sem-saida', stdout: '', stderr: '' }));
ok(semSaida.estado === 'ERROR', 'processo sem saída é ERROR, não READY');

const login = classificar(p('ghunt'), saida({ estado: 'erro', stdout: '', stderr: 'Error: please run ghunt login first' }));
ok(login.estado === 'NOT_CONFIGURED' && /ghunt login/.test(login.nota),
  'ghunt sem login: NOT_CONFIGURED a dizer o que falta, não ERROR');

const lixo = classificar(p('spiderfoot'), saida({ stdout: '<html><body>carregando...</body></html>' }));
ok(lixo.estado === 'ERROR' && /JSON/.test(lixo.nota), 'saída ilegível é ERROR com a razão (nada é inventado)');

const photonOk = classificar(p('photon'), saida({ stdout: 'https://a.test/1\nhttps://a.test/2\n' }));
ok(photonOk.estado === 'READY' && photonOk.itens.length === 2 && photonOk.itens[0].valor === 'https://a.test/1',
  'photon: --stdout devolve linhas que viram itens reais');

const sfOk = classificar(p('spiderfoot'), saida({ stdout: '[{"type":"DOMAIN_NAME","data":"example.com"}]' }));
ok(sfOk.estado === 'READY' && sfOk.itens.length === 1, 'spiderfoot: JSON lido como está');

const sfNdjson = classificar(p('spiderfoot'), saida({ stdout: '{"a":1}\n{"b":2}\n' }));
ok(sfNdjson.estado === 'READY' && sfNdjson.itens.length === 2, 'spiderfoot: JSON Lines também é lido');

const hoTxt = classificar(p('holehe'), saida({ stdout: 'Twitter: Email used\nInstagram: Not found\n' }));
ok(hoTxt.estado === 'READY' && hoTxt.itens.length === 1 && /Twitter: Email used/.test(String(hoTxt.itens[0].valor))
  && /bruta/.test(String(hoTxt.itens[0].rotulo)) && /evidência/.test(hoTxt.nota),
  'holehe: texto fica como evidência bruta, sem o re-classificarmos');

const vazio = classificar(p('openosint'), saida({ stdout: '[]' }));
ok(vazio.estado === 'READY' && vazio.itens.length === 0 && /sem registos/.test(vazio.nota),
  'JSON vazio = READY sem registos (nada encontrado é resultado, não erro)');

const ghuntSemFicheiro = classificar(p('ghunt'), saida({ stdout: '', stderr: '' }));
ok(ghuntSemFicheiro.estado === 'ERROR', 'ghunt sem stdout nem ficheiro: ERROR honesto');

// --------------------------------------------------------- registado na mesa
const t = getTool('osint-engine');
ok(!!t, 'ferramenta registada');
ok(t?.fields.length === 3 && t.fields[0]?.name === 'alvo', 'três campos, alvo primeiro', String(t?.fields.length));
ok(t?.minPlan === 'free' && t.freeTier === true, 'gratuita no plano free (CLIs locais)');
ok(t?.legalGate === 'lgpd', 'gate legal LGPD');

// valida antes de correr qualquer processo
const semAlvo = await t!.run({ alvo: '' }, { userId: 'u', plan: 'free' });
ok(semAlvo.findings.some((f) => f.group === 'validacao'), 'alvo em falta: valida sem tocar em nenhum binário');
const comEspaco = await t!.run({ alvo: 'exemplo.com com espaco' }, { userId: 'u', plan: 'free' });
ok(comEspaco.findings.some((f) => f.group === 'validacao'), 'alvo com espaço: rejeitado');

const incompativel = await t!.run({ alvo: 'example.com', tipo: 'dominio', providers: 'holehe' }, { userId: 'u', plan: 'free' });
ok(incompativel.findings.some((f) => f.group === 'provider' && String(f.value).startsWith('INCOMPATIBLE')),
  'provider incompatível reporta INCOMPATIBLE sem executar nada');
ok(incompativel.log.sources.some((s) => s.id === 'p-osint-holehe' && s.status === 'skipped'),
  'fonte registada como skipped com a razão');

const tipoForcado = await t!.run({ alvo: 'a@b.com', tipo: 'email', providers: 'holehe, ghunt' }, { userId: 'u', plan: 'free' });
ok(tipoForcado.findings.filter((f) => f.group === 'provider').length === 2,
  'dois providers escolhidos = dois estados reportados');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
