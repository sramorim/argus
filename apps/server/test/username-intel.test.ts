/**
 * Testes unitarios da Inteligencia de Username (sem rede).
 *   node test/username-intel.test.ts
 *
 * O que se protege aqui e' a parte que nao se pode verificar a correr contra
 * sites: o parsing dos tres registos e' a arvore de decisao. O ramo que mais
 * importa e' o que recusa dizer FOUND sem controlo — e'e' ele que impede um
 * SPA devolver 200 a qualquer nome e o resultado parecer um perfil.
 */
import { getTool } from '../src/registry.ts';
import {
  parseSherlock, parseWmn, parseMaigret, carregar, classificar, marcador, bloqueado,
  selecionar, controlePara, substitui, type Registo, type Resposta,
} from '../src/tools/username-intel.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

const R = (p: Partial<Registo> = {}): Registo => ({
  provider: 'sherlock', site: 'Exemplo', tpl: 'https://exemplo.test/user/{}',
  metodo: 'GET', regra: 'baseline', ...p,
});
const resp = (p: Partial<Resposta> = {}): Resposta => ({
  status: 200, body: '', url: 'https://exemplo.test/user/alvo', truncado: false, ...p,
});

// ---------------------------------------------------------- registos reais
const sh = carregar('sherlock');
const wm = carregar('whatsmyname');
const mg = carregar('maigret');

ok(!sh.erro && sh.sites.length >= 470, 'sherlock: registo MIT lido com sites suficientes', String(sh.sites.length));
ok(!wm.erro && wm.sites.length >= 680, 'whatsmyname: registo CC BY-SA lido com sites suficientes', String(wm.sites.length));
ok(!mg.erro && mg.sites.length >= 2000, 'maigret: registo MIT lido (URL propria; o resto depende de motores)', String(mg.sites.length));
ok(mg.brutos >= 6200 && sh.brutos >= 480 && wm.brutos >= 710, 'os tres registos sao lidos por inteiro (brutos contados)', `${sh.brutos}/${wm.brutos}/${mg.brutos}`);
ok(mg.desativados >= 600, 'maigret: sites marcados disabled ficam de fora', String(mg.desativados));

for (const [nome, lista] of [['sherlock', sh.sites], ['whatsmyname', wm.sites], ['maigret', mg.sites]] as const) {
  const semHttp = lista.filter((s) => !/^https?:\/\//.test(s.tpl));
  ok(semHttp.length === 0, `${nome}: todas as URLs do registo sao absolutas`, `${semHttp.length} nao sao`);
  const semMarcador = lista.filter((s) => !/(\{\}|\{account\}|\{username\})/.test(s.tpl));
  ok(semMarcador.length === 0, `${nome}: todas as URLs trazem marcador do username`, `${semMarcador.length} nao trazem`);
}

ok(sh.sites.some((s) => s.regra === 'message' && (s.falta?.length ?? 0) > 0),
  'sherlock: errorType message vira cadeia de ausencia');
ok(sh.sites.some((s) => s.regra === 'status'), 'sherlock: errorType status_code vira regra de status');
ok(sh.sites.some((s) => s.regra === 'response_url' && s.erroUrl), 'sherlock: errorType response_url guarda a URL de erro');
ok(wm.sites.some((s) => (s.ok?.[0] ?? 0) !== 200), 'whatsmyname: guarda o e_code proprio (nem e sempre 200)');
ok(wm.sites.some((s) => (s.falta?.length ?? 0) > 0 && (s.tem?.length ?? 0) > 0),
  'whatsmyname: traz m_string e e_string (presenca e ausencia)');
ok(mg.sites.some((s) => typeof s.naoReclamado === 'string'), 'maigret: guarda o usernameUnclaimed como controlo negativo');
ok(mg.sites.filter((s) => s.regra === 'baseline').length >= 20,
  'maigret: entradas sem checkType ficam em baseline (nao se adivinha o motor)', String(mg.sites.filter((s) => s.regra === 'baseline').length));

// parsers directos, com dados minimos fabricados (sem rede, sem tocar no disco)
ok(parseSherlock({ Ex: { url: 'https://a.test/{}', errorType: 'message', errorMsg: 'nao existe' } })
  .some((r) => r.regra === 'message' && r.falta?.[0] === 'nao existe'), 'parseSherlock: mensagem de erro vira falta');
ok(parseWmn({ sites: [{ name: 'A', uri_check: 'https://a.test/{account}', e_code: 200, e_string: 'Perfil', m_string: 'Nao', m_code: 404 }] })
  .some((r) => r.tem?.[0] === 'Perfil' && r.falta?.[0] === 'Nao' && r.faltaStatus === undefined),
  'parseWmn: com m_string definida, o m_code nao decide sozinho');
const pm = parseMaigret({ sites: { A: { url: 'https://a.test/{username}', disabled: true }, B: { url: 'https://b.test/{username}' } } });
ok(pm.desativados === 1 && pm.sites.length === 1, 'parseMaigret: disabled sai do registo e conta', JSON.stringify(pm));

// ---------------------------------------------------------------- substitui
ok(substitui('https://a.test/user/{}', 'a b') === 'https://a.test/user/a%20b', 'substitui {} com o username codificado');
ok(substitui('https://a.test/{account}', 'x') === 'https://a.test/x', 'substitui {account}');
ok(substitui('https://{username}.biz/', 'alvo') === 'https://alvo.biz/', 'substitui {username} no host');
ok(substitui('{"u":"{account}"}', 'z') === '{"u":"z"}', 'substitui dentro do payload');

// ------------------------------------------------------------------ bloqueio
ok(bloqueado(resp({ status: 403 })), 'bloqueado: 403 e bloqueio, nao e "nao existe"');
ok(bloqueado(resp({ status: 429 })), 'bloqueado: 429 e bloqueio');
ok(bloqueado(resp({ status: 200, body: 'Just a moment... checking your browser' })), 'bloqueado: pagina de desafio');
ok(!bloqueado(resp({ status: 404, body: '' })), 'bloqueado: 404 nao e bloqueio');

// ------------------------------------------------------------------ marcador
const m1 = marcador('<title>Telegram: Contact @userum</title>', 'userum');
const m2 = marcador('<title>Telegram: Contact @dois</title>', 'dois');
ok(m1 !== '' && m1 === m2, 'marcador: o username tirado do titulo nao conta como diferenca', `${JSON.stringify(m1)} vs ${JSON.stringify(m2)}`);
ok(marcador('<title>Alfa (usuario ativo)</title>', 'alfa') !== marcador('<title>Beta (visitante)</title>', 'beta'),
  'marcador: titulos diferentes continuam diferentes');
ok(marcador('<title>Just a moment</title>', 'x') === '', 'marcador: titulo generico nao e' + ' sinal');

// ------------------------------------------------------------------- regex
const comRe = R({ re: /^[a-z0-9]{4,12}$/ });
const ctrl = controlePara(comRe);
ok(ctrl !== null && comRe.re!.test(ctrl!), 'controlePara: gera controlo que passa o regexCheck do site', String(ctrl));
ok(controlePara(R({ re: /^$/ })) === null, 'controlePara: sem controlo possivel devolve null');
ok(controlePara(R({ naoReclamado: 'noonewouldeverusethis7' })) === 'noonewouldeverusethis7',
  'controlePara: usa o usernameUnclaimed do proprio registo');

// -------------------------------------------------------------- amostra
const amostra = sh.sites;
const cinco = selecionar(amostra, 5);
ok(cinco.length === 5, 'selecionar: amostra com o tamanho pedido', String(cinco.length));
ok(new Set(cinco.map((s) => s.site)).size === 5, 'selecionar: sem repetir o mesmo site');
ok(selecionar(amostra, 10_000).length === amostra.length, 'selecionar: pedido maior que o registo devolve tudo');
ok(selecionar(amostra, 5).map((s) => s.site).join() === cinco.map((s) => s.site).join(),
  'selecionar: deterministica (duas chamadas iguais, mesma amostra)');

// -------------------------------------------------------------- classificar
ok(classificar(R(), null).estado === 'ERROR', 'classificar: sem resposta, ERROR (nunca NOT_FOUND)');
ok(classificar(R(), resp({ status: 403 })).estado === 'BLOCKED', 'classificar: 403 e BLOCKED');

const regraAusencia = R({ regra: 'message', falta: ['User not found'] });
const vAusencia = classificar(regraAusencia, resp({ status: 200, body: '<h1>User not found</h1>' }));
ok(vAusencia.estado === 'NOT_FOUND', 'classificar: cadeia de ausencia decide sem controlo', vAusencia.via);

const comRegra = R({ re: /^[a-z0-9]{4,12}$/ });
const vRegex = classificar(comRegra, resp({ status: 200 }), undefined, 'username-com-espacos');
ok(vRegex.estado === 'NOT_FOUND', 'classificar: fora do regex do site e NOT_FOUND', vRegex.via);

const regraStatus = R({ regra: 'status', ok: [200] });
const vSemCtrl = classificar(regraStatus, resp({ status: 200, body: '<title>Perfil Alvo</title>' }), undefined, 'alvo');
ok(vSemCtrl.estado === 'PRECISA_CONTROLO', 'classificar: 200 sem controlo nunca e FOUND', `${vSemCtrl.estado}: ${vSemCtrl.via}`);

const vCtrl404 = classificar(regraStatus, resp({ status: 200, body: '<title>Perfil Alvo</title>' }),
  resp({ status: 404 }), 'alvo');
ok(vCtrl404.estado === 'FOUND', 'classificar: alvo 200 e controlo 404 = o site distingue', vCtrl404.via);

const vSoft = classificar(regraStatus, resp({ status: 200, body: '<title>Perfil publico</title>' }),
  resp({ status: 200, body: '<title>Perfil publico</title>' }), 'alvo', 'controlo');
ok(vSoft.estado === 'UNKNOWN', 'classificar: mesmo conteudo nos dois = soft-404, nao e FOUND', vSoft.via);

const vDif = classificar(regraStatus, resp({ status: 200, body: '<title>Perfil de Alvo Real</title>' }),
  resp({ status: 200, body: '<title>Outra pagina qualquer</title>' }), 'alvo', 'controlo');
ok(vDif.estado === 'FOUND', 'classificar: conteudo diferente do controlo = FOUND', vDif.via);

const regraPresenca = R({ regra: 'message', tem: ['"user_id":'] });
const vPresSemCtrl = classificar(regraPresenca, resp({ status: 200, body: '{"user_id":1}' }), undefined, 'alvo');
ok(vPresSemCtrl.estado === 'PRECISA_CONTROLO', 'classificar: presenca sem cadeia de ausencia exige controlo', vPresSemCtrl.estado);
const vPresCtrlLimpo = classificar(regraPresenca, resp({ status: 200, body: '{"user_id":1}' }),
  resp({ status: 200, body: '<title>vazio</title>' }), 'alvo', 'controlo');
ok(vPresCtrlLimpo.estado === 'FOUND', 'classificar: presenca so no alvo = FOUND', vPresCtrlLimpo.via);
const vPresCtrlIgual = classificar(regraPresenca, resp({ status: 200, body: '{"user_id":1}' }),
  resp({ status: 200, body: '{"user_id":1}' }), 'alvo', 'controlo');
ok(vPresCtrlIgual.estado === 'UNKNOWN', 'classificar: presenca tambem no controlo nao prova nada', vPresCtrlIgual.via);

const vAusenciaNaoExiste = classificar(regraAusencia, resp({ status: 200, body: '<h1>User not found</h1>' }));
ok(vAusenciaNaoExiste.estado === 'NOT_FOUND', 'classificar: a cadeia de ausencia vale mesmo com status 200', vAusenciaNaoExiste.via);

// WhatsMyName: a e_string e' a condicao de existencia — 200 sem ela nao prova nada
const registoX = R({ regra: 'status', ok: [200], tem: ['"reason":"taken"'], temObrigatorio: true, falta: ['"reason":"available"'] });
ok(classificar(registoX, resp({ status: 200, body: '{"reason":"available"}' })).estado === 'NOT_FOUND',
  'classificar: cadeia de ausencia do WhatsMyName decide mesmo com status 200');
ok(classificar(registoX, resp({ status: 200, body: '{"reason":"taken"}' })).estado === 'FOUND',
  'classificar: e_string presente = FOUND sem precisar de controlo');
const vSemMarca = classificar(registoX, resp({ status: 200, body: '{"algo":"outro"}' }), undefined, 'alvo');
ok(vSemMarca.estado === 'UNKNOWN', 'classificar: 200 sem a marca de existencia nao e FOUND (API de disponibilidade)', vSemMarca.via);
ok(classificar(registoX, resp({ status: 404, body: '' })).estado === 'NOT_FOUND',
  'classificar: 404 continua a ser NOT_FOUND');
const registoOpcional = R({ regra: 'message', tem: ['"user_id":'], temObrigatorio: undefined });
ok(classificar(registoOpcional, resp({ status: 200, body: '{"outro":1}' }), undefined, 'alvo').estado === 'PRECISA_CONTROLO',
  'classificar: marca de presenca opcional (Maigret) cai no controlo, nao em NOT_FOUND');

const regraUrl = R({ regra: 'response_url', erroUrl: 'https://exemplo.test/404' });
ok(classificar(regraUrl, resp({ status: 200, url: 'https://exemplo.test/404' })).estado === 'NOT_FOUND',
  'classificar: redirecionado para a URL de erro = NOT_FOUND');
ok(classificar(regraUrl, resp({ status: 200, url: 'https://exemplo.test/user/alvo' }), undefined, 'alvo').estado
  === 'PRECISA_CONTROLO', 'classificar: nao redirecionou = precisa do controlo');

ok(classificar(R(), resp({ status: 500 })).estado === 'UNKNOWN', 'classificar: 500 e UNKNOWN, nao e NOT_FOUND');

// ------------------------------------------------------------ registo na mesa
const t = getTool('username-intel');
ok(!!t, 'ferramenta registada');
ok(t?.fields.length === 4 && t.fields[0]?.name === 'username', 'quatro campos, username primeiro', String(t?.fields.length));
ok(t?.minPlan === 'free' && t.freeTier === true, 'gratuita no plano free');
ok(t?.legalGate === 'lgpd', 'gate legal LGPD, como as outras de identidade');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
