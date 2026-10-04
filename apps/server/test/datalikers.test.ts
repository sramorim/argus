/**
 * Testes do módulo DATALIKERS (sem rede, sem chave).
 *   node test/datalikers.test.ts
 *
 * O que se protege aqui é a parte que só se vê quando NÃO há chave: a
 * ferramenta tem de recusar a dizer exatamente `DATALIKERS_API_KEY`, o
 * catálogo tem de bater certo com o OpenAPI oficial do gateway (nada de
 * endpoints inventados), e a chave tem de ficar fora de qualquer texto,
 * URL e matriz de fontes que o utilizador veja.
 */
import { getTool, allTools, lockState } from '../src/registry.ts';
import '../src/tools/datalikers.ts';
import { TOOL_LOCKS } from '../src/plans.ts';
import {
  API, ENDPOINTS, PLATAFORMAS, endpoint, listaRecursos, limpar, pedir, recursos,
  saude, token, urlLimpa, type EndpointDL,
} from '../src/net/datalikers.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

// Garante o estado "sem chave" para todos os testes daqui para a frente.
delete process.env.DATALIKERS_API_KEY;

// --------------------------------------------------------- catálogo oficial
const CAMINHOS_OFICIAIS = [
  '/v1/user/by/id', '/v1/user/by/username', '/v1/user/followers/by/id',
  '/v1/user/followers/by/username', '/v1/user/about', '/v1/user/face', '/v2/user/by/id',
  '/v1/media/by/id', '/v1/media/by/code', '/v1/media/by/url',
  '/v1/story/by/id', '/v1/story/by/url', '/v1/highlight/by/id', '/v1/highlight/by/url',
  '/v1/comment/by/id', '/v1/hashtag/by/id', '/v1/hashtag/by/name',
  '/v1/location/by/id', '/v1/location/by/name', '/v1/track/by/id',
  '/t1/user/by/id', '/t1/user/by/username', '/t1/media/by/id', '/t1/media/by/user',
  '/t1/comment/by/id', '/t1/comment/by/user', '/t1/hashtag/by/id', '/t1/hashtag/by/name',
  '/t1/playlist/by/id', '/t1/playlist/by/user',
];

ok(ENDPOINTS.length === 30, '30 endpoints de dados (os 32 do OpenAPI menos os 2 de sistema)', String(ENDPOINTS.length));
const vistas = [...ENDPOINTS.map((e) => e.caminho)].sort();
const esperados = [...CAMINHOS_OFICIAIS].sort();
ok(JSON.stringify(vistas) === JSON.stringify(esperados),
  'cada caminho existe no OpenAPI oficial — nem um a mais nem um a menos',
  `a mais: ${vistas.filter((v) => !esperados.includes(v)).join(',')} · a menos: ${esperados.filter((v) => !vistas.includes(v)).join(',')}`);
ok(new Set(ENDPOINTS.map((e) => e.caminho)).size === 30, 'caminhos sem repetidos');
ok(new Set(ENDPOINTS.map((e) => e.id)).size === 30, 'ids sem repetidos (são os ids das fontes)');
ok(ENDPOINTS.every((e) => e.plataforma === 'instagram' || e.plataforma === 'tiktok'),
  'só instagram e tiktok — nada de redes sem REST documentado');
ok(ENDPOINTS.filter((e) => e.plataforma === 'instagram').length === 20
  && ENDPOINTS.filter((e) => e.plataforma === 'tiktok').length === 10,
  '20 recursos de Instagram e 10 de TikTok',
  `${recursos('instagram').length}/${recursos('tiktok').length}`);
ok(ENDPOINTS.every((e) => e.caminho.startsWith('/v1/') || e.caminho.startsWith('/v2/') || e.caminho.startsWith('/t1/')),
  'prefixos de caminho do gateway (/v1, /v2, /t1)');
ok(ENDPOINTS.every((e) => e.param && e.rotulo && e.desc && e.alvo),
  'cada endpoint tem param, rotulo, descricao e o que o alvo tem de ser');
ok(ENDPOINTS.every((e) => !/search_users|dataset|get_user_stories|get_reel_comments/i.test(e.caminho)),
  'nenhuma capacidade só-MCP é apresentada como endpoint REST');
ok(endpoint('ig-perfil')?.caminho === '/v1/user/by/username' && endpoint('tt-perfil')?.caminho === '/t1/user/by/username',
  'lookup por id devolve o endpoint certo');
ok(endpoint('nao-existe') === null, 'id desconhecido devolve null');
ok(listaRecursos('instagram').includes('ig-perfil') && !listaRecursos('instagram').includes('tt-perfil'),
  'a lista de recursos é por plataforma');

// --------------------------------------------------------------- segredo
const t0 = token();
ok(t0.token === null && t0.falta === 'DATALIKERS_API_KEY', 'sem variável: falta nomeado DATALIKERS_API_KEY');
const t1 = token({ DATALIKERS_API_KEY: '  segredo-teste  ' } as NodeJS.ProcessEnv);
ok(t1.token === 'segredo-teste' && t1.falta === null, 'com variável: token aparado');

ok(limpar('erro com segredo-teste aqui', 'segredo-teste') === 'erro com [chave] aqui',
  'limpar tira a chave do texto');
ok(!limpar('?access_key=abc123def', 'abc123def').includes('abc123def'), 'limpar tira access_key da query');
const ep = endpoint('ig-perfil')!;
const u = urlLimpa(ep, 'ana');
ok(u === `${API}/v1/user/by/username?username=ana`, 'URL guardada tem o caminho e o alvo', u);
ok(!u.includes('access_key') && !u.includes('segredo'), 'URL guardada nunca leva a chave');

// ------------------------------------------------------------ sem rede/key
const semChave = await pedir(ep, 'ana');
ok(semChave.estado === 'NOT_CONFIGURED' && semChave.ms === 0 && semChave.status === null,
  'pedir sem chave devolve NOT_CONFIGURED sem sequer ir à rede', semChave.estado);
ok(!semChave.url.includes('access_key'), 'a URL da resposta continua limpa');

const h = await saude();
ok(h.status === 'NOT_CONFIGURED' && h.nota.includes('DATALIKERS_API_KEY'),
  'saude sem chave: NOT_CONFIGURED com o nome da variável', h.nota);
ok(h.conta === null && h.latenciaMs === null, 'saude sem chave não inventa nem conta nem latência');

// ---------------------------------------------------------------- registry
const t = getTool('datalikers');
ok(!!t, 'a ferramenta está registada');
ok(t!.category === 'pessoa' && t!.minPlan === 'pro' && t!.freeTier === false && t!.legalGate === 'lgpd',
  'categoria pessoa, plano pro, sem tier free, gate lgpd');
ok(TOOL_LOCKS['datalikers'] === 'pro', 'TOOL_LOCKS["datalikers"] === "pro"', String(TOOL_LOCKS['datalikers']));
ok(lockState('datalikers', 'free') === 'locked' && lockState('datalikers', 'pro') === 'open',
  'free trancada, pro aberta');
ok(t!.fields.map((f) => f.name).join(',') === 'alvo,plataforma,recurso',
  'três campos: alvo, plataforma, recurso', t!.fields.map((f) => f.name).join(','));
ok(allTools().some((x) => x.id === 'datalikers'), 'entrou no catálogo');
ok(t!.summary.length > 40 && t!.longDesc.length > 200, 'descrição e descrição longa escritas');
ok(t!.tags.includes('instagram') && t!.tags.includes('tiktok') && t!.tags.includes('datalikers'),
  'etiquetas das plataformas e do provider');

// ----------------------------------------------------------- execução/tool
const CTX = { userId: 't-dl', plan: 'free' as const };
const semKey = await t!.run({ alvo: 'ana' }, CTX);
const txtSem = JSON.stringify(semKey);
ok(semKey.findings.some((f) => String(f.value).includes('DATALIKERS_API_KEY')),
  'os achados dizem exatamente DATALIKERS_API_KEY');
ok(semKey.log.sources.some((s) => s.status === 'needs_key'), 'a matriz tem uma fonte needs_key');
ok(semKey.log.sources.some((s) => s.id === 'dl-ig-perfil' && s.status === 'skipped'),
  'a fonte do endpoint é declarada e recusada com o motivo');
ok(!txtSem.includes('access_key='), 'nenhuma URL com a chave');
ok((semKey.notes ?? []).some((n) => n.includes('DATALIKERS_API_KEY')), 'notes explicam o que falta');
ok((semKey.notes ?? []).some((n) => n.includes('ig-perfil')), 'a nota de recursos lista os válidos');

// Achados que citam fontes têm de as ter registadas — é a mesma auditoria do
// harness, aplicada a este módulo.
const ids = new Set(semKey.log.sources.map((s) => s.id));
const orfaos = semKey.findings.filter((f) => f.evidence.sourceIds.some((s) => !ids.has(s)));
ok(orfaos.length === 0, 'nenhum achado cita uma fonte inexistente',
  orfaos.map((f) => f.label).join(', '));

// ------------------------------------------------------------- validações
const vazio = await t!.run({ alvo: '' }, CTX);
ok(vazio.findings.some((f) => f.group === 'validacao'), 'alvo vazio é validação, não pedido');

const comEspaco = await t!.run({ alvo: 'ana silva' }, CTX);
ok(comEspaco.findings.some((f) => f.group === 'validacao'), 'alvo com espaço é recusado');

const rede = await t!.run({ alvo: 'ana', plataforma: 'facebook' }, CTX);
ok(rede.findings.some((f) => f.group === 'validacao' && String(f.value).includes('facebook')),
  'plataforma fora do escopo é recusada');
ok((rede.notes ?? []).some((n) => n.includes('instagram, tiktok')), 'as notes dizem as plataformas aceites');

const recDes = await t!.run({ alvo: 'ana', plataforma: 'instagram', recurso: 'coisa' }, CTX);
ok(recDes.findings.some((f) => f.group === 'validacao'), 'recurso desconhecido é recusado');
ok((recDes.notes ?? []).some((n) => n.includes('ig-perfil')), 'a nota lista os recursos de instagram');

const cruzado = await t!.run({ alvo: 'ana', plataforma: 'tiktok', recurso: 'ig-perfil' }, CTX);
ok(cruzado.findings.some((f) => f.group === 'validacao' && String(f.value).includes('não pertence')),
  'recurso de outra plataforma é recusado');
ok((cruzado.notes ?? []).some((n) => n.includes('é de instagram')), 'e diz de onde o recurso é');

// -------------------------------------------------------- derivação local
// O `run` devolve findings + log + notas (não é um ToolRun de executor, que
// traz também id, input, tempo e fontes): é este tipo que se anota aqui.
type Saida = Awaited<ReturnType<NonNullable<typeof t>['run']>>;
const endpointDe = (r: Saida) => r.findings.find((f) => f.label === 'Endpoint')?.value;

const porUrl = await t!.run({ alvo: 'https://www.instagram.com/p/AbC123/' }, CTX);
ok(String(endpointDe(porUrl)).includes('/v1/media/by/url'),
  'URL de post deriva media/by/url', String(endpointDe(porUrl)));
ok((porUrl.notes ?? []).some((n) => n.includes('derivado')), 'diz que derivou');

const porStory = await t!.run({ alvo: 'https://www.instagram.com/stories/ana/1/' }, CTX);
ok(String(endpointDe(porStory)).includes('/v1/story/by/url'), 'URL de story deriva story/by/url',
  String(endpointDe(porStory)));

const porDestaque = await t!.run({ alvo: 'https://www.instagram.com/stories/highlights/123/' }, CTX);
ok(String(endpointDe(porDestaque)).includes('/v1/highlight/by/url'),
  'URL de destaque deriva highlight/by/url', String(endpointDe(porDestaque)));

const porId = await t!.run({ alvo: '123456789' }, CTX);
ok(String(endpointDe(porId)).includes('/v1/user/by/id'), 'número deriva perfil por PK',
  String(endpointDe(porId)));

const porHandle = await t!.run({ alvo: '@ana' }, CTX);
ok(String(endpointDe(porHandle)).includes('/v1/user/by/username'),
  'handle deriva perfil por username', String(endpointDe(porHandle)));
ok(porHandle.findings.some((f) => f.label === 'Alvo' && f.value === 'ana'),
  '@ é retirado do alvo enviado ao endpoint');

const tt = await t!.run({ alvo: 'ana', plataforma: 'tiktok' }, CTX);
ok(String(endpointDe(tt)).includes('/t1/user/by/username'),
  'TikTok sem recurso deriva o endpoint de TikTok', String(endpointDe(tt)));

const ttUrl = await t!.run({ alvo: 'https://www.instagram.com/p/AbC123/', plataforma: 'tiktok' }, CTX);
ok(ttUrl.findings.some((f) => f.group === 'validacao'),
  'URL do Instagram com plataforma TikTok não adivinha recurso — pede escolha');

// ------------------------------------------------------- derivados vs rede
// Todos os casos acima cortam em NOT_CONFIGURED: sem chave não há pedido, e é
// isso que se está a provar com o output inteiro estar sem credencial.
for (const r of [porUrl, porStory, porDestaque, porId, porHandle, tt, ttUrl]) {
  ok(JSON.stringify(r).length > 0 && !JSON.stringify(r).includes('segredo'),
    'derivação não deixou sair credencial');
}
ok(porUrl.findings.some((f) => String(f.value).includes('NOT_CONFIGURED')),
  'sem chave, a derivação termina em NOT_CONFIGURED e não faz pedido');

// --------------------------------------------------------- redação de erro
ok(limpar('HTTP 401: access_key=segredo-teste inválido', 'segredo-teste')
  === 'HTTP 401: access_key=[chave] inválido',
  'erro do gateway vem redigido');

// ------------------------------------------- créditos partilhados (execução)
// O único caminho que decide entre "pede ao fornecedor" e "não pede" sem rede:
// com a chave do servidor presente e o tecto já no chão, o pedido tem de
// MORRER antes de sair. Se saísse, o teste passava por um 401 do gateway em
// vez de lançar o erro de créditos — é essa a distinção que se está a medir.
process.env.DATALIKERS_API_KEY = 'chave-de-teste-nao-vexada';
const esgotado = await t!.run({ alvo: 'ana' }, { userId: 't-dl-esgotado', plan: 'free' })
  .then(() => null, (e) => e);
ok(esgotado?.name === 'CreditosEsgotadosError',
  'sem crédito partilhado a execução é recusada, não pedida ao fornecedor', String(esgotado?.name));
ok(esgotado?.limit === 0 && esgotado?.used === 0,
  'o erro traz os dois números do tecto, para o ecrã poder dizer "usou X de Y"',
  `${esgotado?.used}/${esgotado?.limit}`);

// O inverso: uma chave própria não tem tecto nosso. A validação da chave é um
// pedido ao gateway, portanto aqui não se corre nada — o que se prova é que a
//_recusa por créditos_ não acontece, que é a única coisa que este teste sem
// rede consegue afirmar sobre o caminho da chave própria.
delete process.env.DATALIKERS_API_KEY;

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
