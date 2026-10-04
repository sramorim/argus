/**
 * Testes do engine APIFY (sem rede, sem token).
 *   node test/apify.test.ts
 *
 * O que se protege aqui é a parte que só se vê quando NÃO há chave: a ferramenta
 * tem de recusar a dizer exatamente `APIFY_API_TOKEN`, o registry tem de ter os
 * oito actors com os campos do spec, e a chave tem de ficar fora de qualquer
 * texto que o utilizador veja.
 */
import { getTool } from '../src/registry.ts';
import '../src/tools/apify.ts';
import {
  ACTORS, correr, escolherActors, limpar, foraDeAlcance, registarActor, saude, token,
  estadoDe, matriz, type ActorDef,
} from '../src/net/apify.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

// ---------------------------------------------------------------- registry
ok(ACTORS.length === 8, 'os oito actors do conjunto inicial', String(ACTORS.length));
ok(ACTORS.every((a) => a.actorId && a.name && a.platform && Array.isArray(a.inputSchema)
  && Array.isArray(a.outputSchema) && typeof a.enabled === 'boolean'
  && typeof a.input === 'function' && typeof a.normalizer === 'function'),
  'cada actor tem actorId, name, platform, inputSchema, outputSchema, enabled e normalizer');
ok(ACTORS.every((a) => /^(instagram|tiktok|facebook|x)$/.test(a.platform)), 'plataformas dentro do escopo');
const oficiais = ACTORS.filter((a) => a.oficial).length;
ok(oficiais === 5 && ACTORS.length - oficiais === 3,
  `5 actors apify/* oficiais e 3 de terceiros marcados como tal`, `${oficiais}/${ACTORS.length - oficiais}`);
ok(ACTORS.filter((a) => a.platform === 'instagram').length === 4, '4 actors de Instagram');
ok(ACTORS.filter((a) => a.platform === 'tiktok').length === 2, '2 actors de TikTok');
ok(ACTORS.some((a) => a.platform === 'facebook') && ACTORS.some((a) => a.platform === 'x'), 'Facebook e X presentes');
ok(new Set(ACTORS.map((a) => a.actorId)).size === 8, 'actorIds sem repetidos');

// ------------------------------------------- conta Free: quem pode ir por API
ok(ACTORS.every((a) => typeof a.viaApiNaFree === 'boolean'),
  'todos os actors declaram viaApiNaFree (obrigatório no tipo)');
const semApiFree = ACTORS.filter((a) => !a.viaApiNaFree).map((a) => a.actorId);
ok(semApiFree.length === 1 && semApiFree[0] === 'apidojo/tweet-scraper',
  'apidojo/tweet-scraper é o único indisponível via API na conta Free', semApiFree.join(','));

// ------------------------------------------------------------ input puro
const ig = ACTORS.find((a) => a.actorId === 'apify/instagram-scraper')!;
ok(JSON.stringify(ig.input('@ana')) === JSON.stringify({ directUrls: ['https://www.instagram.com/ana/'] }),
  'instagram-scraper: URL de perfil montada a partir do username');
const igp = ACTORS.find((a) => a.actorId === 'apify/instagram-profile-scraper')!;
ok(JSON.stringify(igp.input('@ana')) === JSON.stringify({ usernames: ['ana'] }),
  'instagram-profile-scraper: usernames com @ removido');
const tt = ACTORS.find((a) => a.actorId === 'clockworks/tiktok-scraper')!;
ok(JSON.stringify(tt.input('ana')) === JSON.stringify({ profiles: ['https://www.tiktok.com/@ana'] }),
  'tiktok-scraper: URL de perfil montada');
const fb = ACTORS.find((a) => a.actorId === 'apify/facebook-posts-scraper')!;
ok(JSON.stringify(fb.input('https://facebook.com/x')) === JSON.stringify({ startUrls: [{ url: 'https://facebook.com/x' }] }),
  'facebook-posts-scraper: startUrls no formato documentado');
const tw = ACTORS.find((a) => a.actorId === 'apidojo/tweet-scraper')!;
ok(JSON.stringify(tw.input('@ana')) === JSON.stringify({ twitterHandles: ['ana'] }),
  'tweet-scraper: twitterHandles');
const ffw = ACTORS.find((a) => a.actorId === 'apify/instagram-followers-following-scraper')!;
ok(ffw.input('ana').dataToScrape === 'Followers', 'followers/following: dataToScrape documentado');

// ----------------------------------------------------------- normalizador
const item = { username: 'ana', followersCount: 1234, bio: 'ola', campoDesconhecido: { x: 1 } };
const d = ig.normalizer(item);
ok(d.some((x) => x.rotulo === 'campos públicos' && (x.valor as Record<string, unknown>).followersCount === 1234),
  'normalizador destaca os campos públicos conhecidos');
ok(d.some((x) => x.rotulo.includes('outros') && (x.valor as Record<string, unknown>).campoDesconhecido !== undefined),
  'o resto dos campos NÃO é descartado — vai tudo para o achado');
ok(d.some((x) => JSON.stringify(x.valor).includes('ola')), 'bio mantida');
ok(ig.normalizer('texto').length === 1 && ig.normalizer('texto')[0].valor === 'texto', 'item escalar passa como está');
ok(ig.normalizer(null).length === 0, 'null não gera achado vazio');
ok(ig.normalizer({ a: 1 }).length >= 1, 'objeto sem campos conhecidos continua a ser devolvido');

// ---------------------------------------------------------------- filtros
ok(escolherActors().length === 8, 'sem filtros: os oito');
ok(escolherActors('instagram').length === 4, 'plataforma instagram: 4 actors');
ok(escolherActors('tiktok').length === 2, 'plataforma tiktok: 2 actors');
ok(escolherActors('x').length === 1, 'plataforma x: 1 actor');
ok(escolherActors(undefined, 'apify/instagram-scraper').length === 1, 'por actorId exato');
ok(escolherActors(undefined, 'nao-existe-zzz').length === 8, 'actor inexistente não anula a seleção');

// ------------------------------------------------------------------ token
ok(token({}).falta === 'APIFY_API_TOKEN', 'sem chave: falta exatamente APIFY_API_TOKEN', String(token({}).falta));
ok(token({ APIFY_API_TOKEN: 'abc' }).token === 'abc', 'APIFY_API_TOKEN aceite (nome do spec)');
ok(token({ APIFY_TOKEN: 'def' }).token === 'def', 'APIFY_TOKEN aceite (nome da doc oficial do Apify)');
ok(token({ APIFY_API_TOKEN: '  ' }).falta === 'APIFY_API_TOKEN', 'chave em branco conta como ausente');

const segredo = 'SEGREDO123ABC';
ok(!limpar(`falhou com ${segredo}`, segredo).includes(segredo), 'a chave é removida das mensagens de erro');
ok(!limpar('GET https://x?token=' + segredo + '&a=1', segredo).includes(segredo), 'a chave sai da query string');
ok(!limpar('Authorization: Bearer ' + segredo, segredo).includes(segredo), 'a chave sai dos headers de erro');
ok(limpar('texto sem chave', null) === 'texto sem chave', 'sem chave, o texto fica como está');

// ---------------------------------------------------------- sem token: sem rede
const semToken = await saude({});
ok(semToken.status === 'NOT_CONFIGURED' && semToken.nota.includes('APIFY_API_TOKEN'),
  'health check sem token: NOT_CONFIGURED a nomear APIFY_API_TOKEN, sem pedido nenhum', semToken.nota);
ok(semToken.latenciaMs === null, 'health check sem token não regista latência (não houve pedido)');

const corrida = await correr(ACTORS[0], 'ana', {});
ok(corrida.status === 'NOT_CONFIGURED' && corrida.itens.length === 0 && corrida.nota.includes('APIFY_API_TOKEN'),
  'runner sem token: recusa com a variável certa e zero itens');

const m = matriz({});
ok(m.length === 8 && m.every((x) => x.apikey.includes('APIFY_API_TOKEN')), 'matriz de dependências: 8 linhas, chave em falta escrita');
ok(m.some((x) => x.servicoExterno.includes('apify.com/')), 'matriz cita o serviço externo');

// -------------------------------------------------- o segredo nunca é estado
const comToken = matriz({ APIFY_API_TOKEN: segredo });
ok(comToken.length === 8 && comToken.every((x) => !JSON.stringify(x).includes(segredo)),
  'matriz com token: o valor não aparece em nenhuma linha, só "(configurada)"');
ok(comToken.every((x) => x.apikey.includes('APIFY_API_TOKEN')),
  'mesmo com token, o campo apikey continua a nomear a VARIÁVEL');

const relatorio = {
  linhas: [{ nome: 'x', healthCheck: `falhou com ${segredo}`, configuracao: `Bearer ${segredo}`, erro: null }],
  nota: `pedido ?token=${segredo} falhou`,
};
const limpo = foraDeAlcance(relatorio, segredo);
ok(!JSON.stringify(limpo).includes(segredo), 'foraDeAlcance redige o valor em todo o relatório');
ok(JSON.stringify(limpo).includes('[chave'), 'a redação é visível a quem lê (não se esconde, apaga-se)');
ok(foraDeAlcance('texto sem chave', null) === 'texto sem chave', 'sem token, foraDeAlcance devolve como está');
ok(foraDeAlcance(42, segredo) === 42 && foraDeAlcance(null, segredo) === null, 'números e null passam intactos');

// ------------------------------------------------------- registry aberto
const novo: ActorDef = {
  actorId: 'exemplo/actor-teste', name: 'Actor de teste', platform: 'x', oficial: false,
  viaApiNaFree: true,
  inputSchema: ['alvo'], outputSchema: ['texto'], enabled: true,
  input: (a) => ({ alvo: a }), normalizer: (i) => [{ rotulo: 'item', valor: i as never }],
};
registarActor(novo);
ok(ACTORS.some((a) => a.actorId === 'exemplo/actor-teste'), 'registry aberto: um actor novo é uma entrada');
registarActor({ ...novo, name: 'Actor de teste v2' });
ok(ACTORS.filter((a) => a.actorId === 'exemplo/actor-teste').length === 1
  && ACTORS.find((a) => a.actorId === 'exemplo/actor-teste')!.name === 'Actor de teste v2',
  'registar o mesmo actor duas vezes atualiza, não duplica');
ACTORS.splice(ACTORS.findIndex((a) => a.actorId === 'exemplo/actor-teste'), 1);

// -------------------------------------------------------------- na mesa
const t = getTool('apify');
ok(!!t, 'ferramenta registada');
ok(t?.fields.length === 4 && t.fields[0]?.name === 'alvo', 'quatro campos, alvo primeiro', String(t?.fields.length));
ok(t?.minPlan === 'free' && t.freeTier === true, 'gratuita no plano free (sem chave não gasta nada)');
ok(t?.legalGate === 'lgpd', 'gate legal LGPD');

const semAlvo = await t!.run({ alvo: '' }, { userId: 'u', plan: 'free' });
ok(semAlvo.findings.some((f) => f.group === 'validacao'), 'alvo em falta: valida sem sair da cadeia');

const run = await t!.run({ alvo: '@exemplo' }, { userId: 'u', plan: 'free' });
const txt = JSON.stringify(run.findings) + JSON.stringify(run.log.sources) + JSON.stringify(run.notes);
ok(run.findings.filter((f) => f.group === 'actor').length === 8, 'oito actors reportados por estado',
  String(run.findings.filter((f) => f.group === 'actor').length));
ok(run.findings.filter((f) => f.group === 'actor').every((f) => String(f.value).startsWith('NOT_CONFIGURED')),
  'todos NOT_CONFIGURED quando não há chave');
ok(txt.includes('APIFY_API_TOKEN'), 'a mensagem nomeia APIFY_API_TOKEN');
ok(run.log.sources.some((s) => s.status === 'needs_key'), 'fonte needs_key registada');
ok(run.findings.filter((f) => f.group !== 'validacao').every((f) => f.evidence.sourceIds.length > 0),
  'todo achado cita fonte');
ok(!txt.includes('Bearer') && !/token=[A-Za-z0-9]/.test(txt), 'nenhuma credencial no output');
ok((run.notes ?? []).some((n) => n.includes('APIFY_API_TOKEN')), 'notes explicam o que falta');

const soUm = await t!.run({ alvo: '@exemplo', actors: 'apify/instagram-scraper', confirmarCusto: 'sim' },
  { userId: 'u', plan: 'free' });
ok(soUm.findings.filter((f) => f.group === 'actor').length === 1, 'seleção por actorId: um só');
ok(soUm.findings.filter((f) => f.group === 'actor').every((f) => String(f.value).startsWith('NOT_CONFIGURED')),
  'continua a recusar sem chave, mesmo com custo confirmado');

const soTweet = await t!.run({ alvo: '@exemplo', actors: 'apidojo/tweet-scraper' },
  { userId: 'u', plan: 'free' });
ok((soTweet.notes ?? []).some((n) => n.includes('apidojo/tweet-scraper') && n.includes('indisponível via API')),
  'tweet-scraper: a nota de indisponibilidade via API na conta Free aparece antes de qualquer pedido');

const st = estadoDe(ACTORS[0].actorId);
ok(st.status === 'NOT_CONFIGURED' && st.error?.includes('APIFY_API_TOKEN') === true, 'estado observado do actor guardado honestamente');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
