/**
 * Testes do plano de investigação (FASE F) — sem rede, sem servidor.
 *   node test/plan.test.ts
 *
 * Duas peças, como no código:
 *
 *   - `plan.ts` (puro): os 8 fases, o que cada modo inclui, e sobretudo que
 *     nenhum estado é bonito sem razão — `BLOQUEADA` vem sempre com o motivo
 *     concreto (plano, chave em falta, CLI por instalar, tipo de alvo).
 *   - `exec.ts`: o que a execução faz com isso — não chama o que está
 *     bloqueado, não gasta dinheiro sem confirmação, não marca como corrido o
 *     que não correu, e não repete o que já correu a não ser que se peça.
 *
 * Os factos (`Factos`) são fabricados AQUI de propósito: são a entrada do
 * planeador, e inventá-los num teste é exactamente o que não se pode fazer
 * na API.
 */
import {
  FASES, MODOS, ETAPAS, FORA_DO_PLANO,
  montarPlano, validarEscolhas, faseDe, faseSugerida,
  progressoInicial, estadoDaFase, resumoProgresso,
  type FaseNome, type FerramentaPlano, type ItemCatalogo, type Modo, type Plano, type Factos,
} from '../src/investigation/plan.ts';
import { executarPlano, type InvAlvo } from '../src/investigation/exec.ts';
import { allTools, type ToolDef } from '../src/registry.ts';
import { PLANS, type PlanId } from '../src/plans.ts';

// Registar o catálogo inteiro é o mesmo que faz o servidor: os ids que este
// teste valida têm de ser os ids reais, não uma lista escrita à mão.
import '../src/tools/identity.ts';
import '../src/tools/username-intel.ts';
import '../src/tools/paste.ts';
import '../src/tools/graph.ts';
import '../src/tools/social-search.ts';
import '../src/tools/osint-engine.ts';
import '../src/tools/apify.ts';
import '../src/tools/datalikers.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg, `esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`);
}

const CATALOGO: ItemCatalogo[] = allTools().map((t: ToolDef) => ({ id: t.id, nome: t.name, minPlan: t.minPlan }));
const AGORA = '2026-10-01T10:00:00.000Z';

interface Opcoes { seedType?: string; nos?: number; apifyToken?: boolean; plano?: PlanId; clis?: Factos['clis']; }

/**
 * O que `recolherFactos` encontra neste ambiente: nenhum CLI de terceiros
 * instalado, mas os registos locais do Username Intel lá estão.
 */
function clisDe(seedType: string): Factos['clis'] {
  const out: Factos['clis'] = [];
  if (seedType === 'dominio' || seedType === 'ip') {
    out.push(
      { ferramenta: 'osint-engine', id: 'spiderfoot', rotulo: 'SpiderFoot', tipos: ['dominio', 'ip'], ok: false, motivo: '`ARGUS_SPIDERFOOT` em falta' },
      { ferramenta: 'osint-engine', id: 'photon', rotulo: 'Photon', tipos: ['dominio'], ok: false, motivo: '`ARGUS_PHOTON` em falta' },
    );
  }
  if (seedType === 'username' || seedType === 'email') {
    out.push({ ferramenta: 'osint-engine', id: 'openosint', rotulo: 'OpenOSINT', tipos: ['username', 'email'], ok: false, motivo: 'CLI `openosint` não instalado' });
  }
  if (seedType === 'username') {
    out.push(
      { ferramenta: 'username-intel', id: 'sherlock', rotulo: 'Sherlock', tipos: ['username'], ok: true, motivo: '' },
      { ferramenta: 'username-intel', id: 'whatsmyname', rotulo: 'WhatsMyName', tipos: ['username'], ok: true, motivo: '' },
      { ferramenta: 'username-intel', id: 'maigret', rotulo: 'Maigret', tipos: ['username'], ok: true, motivo: '' },
      { ferramenta: 'username-intel', id: 'blackbird', rotulo: 'Blackbird (CLI)', tipos: ['username'], ok: false, motivo: 'CLI `blackbird` não instalado' },
    );
  }
  return out;
}

function factos(o: Opcoes = {}): Factos {
  const seedType = o.seedType ?? 'username';
  return {
    plano: o.plano ?? 'free',
    seed: seedType === 'username' ? 'ana' : 'example.com',
    seedType,
    nos: o.nos ?? 22,
    clis: o.clis ?? clisDe(seedType),
    apifyToken: o.apifyToken ?? false,
  };
}

function plano(modo: Modo, escolhidas: string[] | undefined, f: Factos): Plano {
  return montarPlano({ modo, ferramentas: escolhidas, catalogo: CATALOGO, factos: f, agora: AGORA });
}

function fase(p: Plano, nome: FaseNome) {
  const f = p.fases.find((x) => x.fase === nome);
  if (!f) throw new Error(`fase ${nome} não está no plano`);
  return f;
}
function ferramenta(p: Plano, nome: FaseNome, id: string): FerramentaPlano {
  const f = fase(p, nome).ferramentas.find((x) => x.id === id);
  if (!f) throw new Error(`${id} não está na fase ${nome}`);
  return f;
}
function todos(p: Plano): string[] {
  return p.fases.flatMap((f) => f.ferramentas.map((x) => x.id));
}

// ============================================================ 8 fases
console.log('\n── AS 8 FASES ───────────────────────────────────────────────────');
eq(FASES, ['Discovery', 'OSINT', 'Social', 'Apify', 'Normalization', 'Correlation', 'Intelligence', 'Snapshots'],
  'a ordem das 8 fases é a do spec');
eq(MODOS, ['QUICK', 'FULL', 'CUSTOM'], 'os três modos');
for (const m of MODOS) {
  const p = plano(m, m === 'CUSTOM' ? ['intel-perfil'] : undefined, factos());
  eq(p.fases.map((f) => f.fase), [...FASES], `modo ${m} tem as 8 fases pela ordem`);
  ok(p.fases.every((f) => f.descricao.length > 20), `modo ${m}: todas as fases têm descrição`);
  eq(p.resumo.fases, 8, `modo ${m}: resumo.fases = 8`);
}

// ============================================================ QUICK
console.log('\n── QUICK ─────────────────────────────────────────────────────────');
const quick = plano('QUICK', undefined, factos());
const disc = fase(quick, 'Discovery');
ok(!disc.pulada, 'QUICK: Discovery não é pulada');
eq(disc.ferramentas.map((f) => f.id).sort(), ['username-finder'],
  'QUICK sobre um username: só as ferramentas rápidas desse tipo de alvo');
ok(disc.ferramentas.every((f) => f.estado === 'PRONTO'), 'QUICK: o que entra está PRONTO (free)');
for (const f of quick.fases.slice(1)) {
  ok(f.pulada, `QUICK: ${f.fase} está dita como pulada, não escondida`);
  ok(f.estado === 'PENDENTE', `QUICK: ${f.fase} pulada continua PENDENTE (nunca CONCLUIDA)`, f.estado);
  ok(!!f.motivo, `QUICK: ${f.fase} pulada tem motivo`);
  eq(f.ferramentas.length, 0, `QUICK: ${f.fase} pulada não mostra ferramentas`);
}
eq(quick.resumo.puladas, 7, 'QUICK: 7 fases puladas');
ok(quick.resumo.ferramentas >= 1 && quick.resumo.ferramentas <= 2, 'QUICK: 1–2 ferramentas no total', String(quick.resumo.ferramentas));

const quickEmail = plano('QUICK', undefined, factos({ seedType: 'email' }));
eq(fase(quickEmail, 'Discovery').ferramentas.map((f) => f.id).sort(), [],
  'QUICK sobre um email não tem descoberta rápida: Discovery fica dita como sem ferramenta aplicável');
eq(fase(quickEmail, 'Discovery').estado, 'BLOQUEADA',
  'e a fase diz porque é que não há nada a correr');

// ============================================================ FULL
console.log('\n── FULL ──────────────────────────────────────────────────────────');
const full = plano('FULL', undefined, factos());
ok(full.fases.every((f) => !f.pulada), 'FULL: nenhuma fase é pulada');
ok(full.resumo.catalogo === CATALOGO.length, 'FULL: o resumo diz o tamanho do catálogo');
ok(full.resumo.fora >= 1, 'FULL: as ferramentas fora das 8 fases são contadas, não ignoradas', String(full.resumo.fora));
const foraDoPlano = Object.keys(FORA_DO_PLANO);
ok(foraDoPlano.every((id) => !todos(full).includes(id)),
  `fora das 8 fases e mesmo assim no plano: ${foraDoPlano.filter((id) => todos(full).includes(id)).join(', ')}`);
// As que ficaram de fora por serem de outro tipo de alvo NÃO são "fora do
// plano": são filtradas, e o resumo tem de o contar para não as esconder.
// Num domínio é que se vê: as ferramentas de username ficam de fora por tipo.
const fullDominio = plano('FULL', undefined, factos({ seedType: 'dominio' }));
const filtradas = CATALOGO.map((c) => c.id)
  .filter((id) => !todos(fullDominio).includes(id) && !FORA_DO_PLANO[id]);
ok(filtradas.length > 0 && filtradas.every((id) => faseDe(id) !== null),
  'as filtradas por tipo continuam a ser ferramentas de uma das 8 fases', filtradas.join(', '));
eq(fullDominio.resumo.fora, foraDoPlano.length + filtradas.length, 'resumo.fora conta tudo o que não entrou');
ok(!todos(full).includes('graph-investigation'), 'graph-investigation nunca entra no plano (criaria outra investigação)');
ok(todos(fullDominio).includes('osint-engine') && !todos(fullDominio).includes('username-finder'),
  'FULL só traz ferramentas do tipo de alvo deste alvo (domínio)');
ok(todos(full).includes('username-finder'),
  'FULL traz a ferramenta de descoberta quando o alvo é um username');
ok(full.resumo.prontas >= 5, 'FULL traz fases prontas', String(full.resumo.prontas));

const semNos = plano('FULL', undefined, factos({ nos: 0 }));
for (const f of ['Normalization', 'Correlation', 'Intelligence', 'Snapshots'] as FaseNome[]) {
  const x = fase(semNos, f);
  eq(x.estado, 'BLOQUEADA', `sem nós: ${f} está BLOQUEADA`);
  ok((x.motivo ?? '').includes('não tem nós'), `sem nós: ${f} diz porquê: ${x.motivo}`);
  eq(x.ferramentas[0]?.kind, 'etapa', `${f} é etapa do motor, não ferramenta do catálogo`);
}

// ============================================================ CUSTOM
console.log('\n── CUSTOM ────────────────────────────────────────────────────────');
const custom = plano('CUSTOM', ['intel-perfil', 'username-finder'], factos());
eq(custom.resumo.ferramentas, 2, 'CUSTOM: só o que foi pedido');
eq(custom.fases.filter((f) => !f.pulada).map((f) => f.fase), ['Discovery', 'Intelligence'],
  'CUSTOM: só as fases que têm ferramentas pedidas');
eq(fase(custom, 'OSINT').motivo, 'fora do plano personalizado', 'CUSTOM: a fóra diz que está fora');
eq(fase(custom, 'Intelligence').ferramentas[0]?.id, 'intel-perfil', 'CUSTOM aceita uma etapa do motor');

const customNaoAplica = plano('CUSTOM', ['username-finder'], factos({ seedType: 'dominio' }));
const na = ferramenta(customNaoAplica, 'Discovery', 'username-finder');
eq(na.estado, 'BLOQUEADA', 'CUSTOM: ferramenta de outro tipo de alvo fica BLOQUEADA, não desaparece');
ok((na.motivo ?? '').includes('não se aplica'), 'CUSTOM: e diz que não se aplica', na.motivo);

// ============================================================ motivos
console.log('\n── MOTIVOS CONCRETOS ─────────────────────────────────────────────');
const tranca = ferramenta(plano('FULL', undefined, factos()), 'OSINT', 'paste-search');
eq(tranca.estado, 'BLOQUEADA', 'paste-search é Pro: no free está BLOQUEADA');
ok(tranca.motivo!.includes('plano free não inclui') && tranca.motivo!.includes('Pro'),
  'a tranca diz o plano actual e o que é preciso', tranca.motivo);

const apifySemToken = ferramenta(plano('FULL', undefined, factos({ seedType: 'username' })), 'Apify', 'apify');
eq(apifySemToken.estado, 'BLOQUEADA', 'Apify sem APIFY_API_TOKEN está BLOQUEADA');
eq(apifySemToken.motivo, '`APIFY_API_TOKEN` em falta', 'falta nomear a variável exacta');

const apifyComToken = ferramenta(plano('FULL', undefined, factos({ seedType: 'username', apifyToken: true })), 'Apify', 'apify');
eq(apifyComToken.estado, 'PRONTO', 'Apify com token está PRONTO');
ok((apifyComToken.nota ?? '').includes('pay-per-event'), 'PRONTO avisa que custa dinheiro', apifyComToken.nota);

const osintVazio = ferramenta(plano('FULL', undefined, factos({ seedType: 'dominio' })), 'OSINT', 'osint-engine');
eq(osintVazio.estado, 'BLOQUEADA', 'OSINT Engine sem nenhum CLI instalado está BLOQUEADA');
ok((osintVazio.motivo ?? '').includes('ARGUS_SPIDERFOOT') && (osintVazio.motivo ?? '').includes('ARGUS_PHOTON'),
  'o motivo aponta as variáveis que faltam, uma a uma', osintVazio.motivo);

const osintPoucos = ferramenta(plano('FULL', undefined, factos({
  seedType: 'dominio',
  clis: [
    { ferramenta: 'osint-engine', id: 'spiderfoot', rotulo: 'SpiderFoot', tipos: ['dominio', 'ip'], ok: true, motivo: '' },
    { ferramenta: 'osint-engine', id: 'photon', rotulo: 'Photon', tipos: ['dominio'], ok: false, motivo: '`ARGUS_PHOTON` em falta' },
  ],
})), 'OSINT', 'osint-engine');
eq(osintPoucos.estado, 'PRONTO', 'com um CLI instalado a ferramenta pode correr');
ok((osintPoucos.nota ?? '').includes('1 de 2'), 'e diz quantos estão prontos e o que falta', osintPoucos.nota);

// Um alvo que nenhum CLI aceita: a ferramenta sai do plano em vez de aparecer
// como "vai correr" para depois falhar sem explicação.
const osintTelefone = plano('FULL', undefined, factos({ seedType: 'telefone' }));
ok(!todos(osintTelefone).includes('osint-engine'),
  'OSINT Engine não entra no plano para um telefone (nenhum CLI o aceita)');
eq(ferramenta(osintTelefone, 'OSINT', 'paste-search').estado, 'BLOQUEADA',
  'a fase OSINT continua a dizer o que existe (e que está trancado no free)');

const osintSemVerificacao = ferramenta(plano('FULL', undefined, factos({ seedType: 'dominio', clis: [] })), 'OSINT', 'osint-engine');
eq(osintSemVerificacao.estado, 'BLOQUEADA', 'sem verificação não se afirma que os CLIs estão cá');
ok((osintSemVerificacao.motivo ?? '').includes('verificação'), 'e o motivo é a falta de verificação', osintSemVerificacao.motivo);

const usernameCli = ferramenta(plano('FULL', undefined, factos({ seedType: 'username' })), 'OSINT', 'username-intel');
eq(usernameCli.estado, 'PRONTO', 'username-intel corre com os 3 registos mesmo sem o Blackbird');
ok((usernameCli.nota ?? '').includes('blackbird'), 'mas o que falta está dito na nota', usernameCli.nota);

const usernameSemCli = ferramenta(plano('FULL', undefined, factos({ seedType: 'username', clis: [] })), 'OSINT', 'username-intel');
eq(usernameCli.id, 'username-intel', 'a ferramenta existe');
ok(usernameSemCli.estado === 'BLOQUEADA' && (usernameSemCli.motivo ?? '').includes('verificação'),
  'sem verificação dos registos não se marca como PRONTO', usernameSemCli.motivo);

const apifyNoPlano = plano('FULL', undefined, factos({ seedType: 'servico', apifyToken: true }));
eq(fase(apifyNoPlano, 'Apify').estado, 'PRONTO', 'aplicabilidade: serviço é aceite pelo Apify');
eq(fase(plano('FULL', undefined, factos({ seedType: 'cve' })), 'Apify').estado, 'BLOQUEADA',
  'aplicabilidade: um CVE não é um alvo para scraping');

const estadoFase = fase(plano('FULL', undefined, factos({ seedType: 'dominio' })), 'Apify');
eq(estadoFase.estado, 'BLOQUEADA', 'fase sem ferramentas aplicáveis fica BLOQUEADA');
ok((estadoFase.motivo ?? '').includes('tipo "dominio"'), 'e diz porque é que não há nada a correr', estadoFase.motivo);

// ============================================================ validação
console.log('\n── VALIDAÇÃO (400s) ──────────────────────────────────────────────');
const e1 = validarEscolhas('normal', undefined, CATALOGO);
eq(e1?.erro, 'modo_invalido', 'modo desconhecido');
ok(e1!.aceites!.join(',') === 'QUICK,FULL,CUSTOM', 'os aceites estão no erro', e1!.aceites!.join(','));
eq(validarEscolhas('CUSTOM', [], CATALOGO)?.erro, 'custom_vazio', 'CUSTOM sem lista');
eq(validarEscolhas('QUICK', undefined, CATALOGO), null, 'QUICK válido');
const e2 = validarEscolhas('CUSTOM', ['imaginei'], CATALOGO);
eq(e2?.erro, 'ferramenta_desconhecida', 'id que não existe');
ok((e2!.aceites ?? []).includes('username-finder') && (e2!.aceites ?? []).length >= 6,
  'o erro ensina os ids reais', String(e2!.aceites?.length));
const e3 = validarEscolhas('CUSTOM', ['graph-investigation'], CATALOGO);
eq(e3?.erro, 'ferramenta_fora_do_plano', 'id real mas fora das 8 fases');
eq(e3?.fase, 'Discovery', 'e diz em que fase cairia');
ok(e3!.msg.includes('graph-investigation'), 'o erro explica porque é que não entra', e3!.msg);
eq(faseSugerida('graph-investigation')?.fase, 'Discovery', 'graph-investigation explicado');
eq(faseDe('intel-snapshot'), 'Snapshots', 'etapa pertence à sua fase');
eq(faseDe('username-finder'), 'Discovery', 'ferramenta pertence à sua fase');
eq(faseDe('nada'), null, 'id sem fase devolve null');

// ============================================================ progresso
console.log('\n── PROGRESSO ─────────────────────────────────────────────────────');
const pFull = plano('FULL', undefined, factos());
const prog = progressoInicial(pFull);
eq(prog.modo, 'FULL', 'o progresso herda o modo');
eq(prog.fases.length, 8, 'o progresso tem as 8 fases');
ok(prog.fases.every((f) => f.estado === 'PENDENTE' && f.executadoEm === null),
  'nada começou: tudo PENDENTE e sem hora');
ok(prog.fases.every((f, i) => f.ferramentas.length === pFull.fases[i]!.ferramentas.length),
  'cada fase do progresso espelha as ferramentas do plano');

const r = resumoProgresso(prog);
eq(r.executadas, 0, 'resumo: zero executadas de partida');
eq(r.pendentes, 8, 'resumo: oito pendentes de partida');

const soPulada = { ...prog.fases[1]!, pulada: true, ferramentas: [] };
eq(estadoDaFase(soPulada).estado, 'PENDENTE', 'fase pulada continua PENDENTE');
const vazia = { ...prog.fases[1]!, pulada: false, ferramentas: [] };
eq(estadoDaFase(vazia).estado, 'BLOQUEADA', 'fase sem ferramentas nunca é CONCLUIDA');

const base = { fase: 'OSINT' as FaseNome, estado: 'PENDENTE' as const, pulada: false, executadoEm: null };
eq(estadoDaFase({ ...base, ferramentas: [{ id: 'a', estado: 'EXECUTADA', ms: 1 }, { id: 'b', estado: 'EXECUTADA', ms: 2 }] }).estado,
  'CONCLUIDA', 'CONCLUIDA só com tudo corrido');
eq(estadoDaFase({ ...base, ferramentas: [{ id: 'a', estado: 'EXECUTADA', ms: 1 }, { id: 'b', estado: 'NAO_EXECUTADA', ms: 0 }] }).estado,
  'PARCIAL', 'metade corrida é PARCIAL');
eq(estadoDaFase({ ...base, ferramentas: [{ id: 'a', estado: 'NAO_EXECUTADA', ms: 0, erro: 'plano free' }, { id: 'b', estado: 'QUOTA', ms: 0, erro: 'limite' }] }).estado,
  'BLOQUEADA', 'nada correu é BLOQUEADA');
ok((estadoDaFase({ ...base, ferramentas: [{ id: 'a', estado: 'NAO_EXECUTADA', ms: 0, erro: 'plano free' }] }).motivo ?? '').includes('plano free'),
  'o estado vem com o motivo real');
eq(estadoDaFase({ ...base, ferramentas: [{ id: 'a', estado: 'ERRO', ms: 1, erro: 'x' }, { id: 'b', estado: 'ERRO', ms: 1, erro: 'y' }] }).estado,
  'ERRO', 'tudo em erro é ERRO');
eq(estadoDaFase({ ...base, ferramentas: [{ id: 'a', estado: 'PENDENTE', ms: 0 }] }).estado,
  'PENDENTE', 'sem tentativa ainda é PENDENTE');

// ============================================================ execução
console.log('\n── EXECUÇÃO ──────────────────────────────────────────────────────');
const inv: InvAlvo = {
  id: 'inv-falsa', user_id: 'u-teste', seed: 'ana', seed_type: 'username',
  title: 'teste', created_at: AGORA, updated_at: AGORA,
};
const ctx = { userId: 'u-teste', plan: 'free' as PlanId, byok: {} };

/** Plano só com a fase Apify (uma ferramenta) e uma entrada inventada. */
function planoApify(f: Factos): Plano {
  const p = plano('CUSTOM', ['apify'], f);
  const apify = ferramenta(p, 'Apify', 'apify');
  if (apify.estado !== 'PRONTO') throw new Error(`apify tinha de estar PRONTO: ${apify.motivo}`);
  return p;
}

const pApify = planoApify(factos({ seedType: 'username', apifyToken: true }));

// 1. sem confirmação de custo não se gasta dinheiro do utilizador
const semCusto = await executarPlano({
  plano: pApify, progresso: null, inv, ctx, confirmarCusto: false, reexecutar: false, agora: () => AGORA,
});
const fApify = semCusto.fases.find((x) => x.fase === 'Apify')!;
eq(fApify.ferramentas[0]!.estado, 'NAO_EXECUTADA', 'Apify sem confirmação: não correu, e está dito');
ok((fApify.ferramentas[0]!.erro ?? '').includes('confirmarCusto'), 'diz exactamente o que falta', fApify.ferramentas[0]!.erro);
eq(fApify.estado, 'BLOQUEADA', 'a fase nunca aparece como concluída');
ok(!!fApify.executadoEm, 'a fase ficou registada com hora');

// 2. o que está bloqueado no plano nem sequer é chamado
const pBloqueada = plano('CUSTOM', ['apify'], factos({ seedType: 'username', apifyToken: false }));
const bloqueado = await executarPlano({
  plano: pBloqueada, progresso: null, inv, ctx, confirmarCusto: true, reexecutar: false, agora: () => AGORA,
});
const fBloq = bloqueado.fases.find((x) => x.fase === 'Apify')!;
eq(fBloq.ferramentas[0]!.estado, 'NAO_EXECUTADA', 'ferramenta bloqueada no plano não é executada');
eq(fBloq.ferramentas[0]!.erro, '`APIFY_API_TOKEN` em falta', 'e guarda o motivo do plano');

// 3. uma ferramenta que o planeador desconhece dá ERRO — não dá "concluída"
const pFalsa: Plano = {
  ...pApify,
  fases: [{
    ...fase(pApify, 'Apify'),
    ferramentas: [{ id: 'inventada', rotulo: 'Inventada', kind: 'ferramenta', estado: 'PRONTO', input: {} }],
  }, ...pApify.fases.filter((f) => f.fase !== 'Apify')],
};
const desconhecida = await executarPlano({
  plano: pFalsa, progresso: null, inv, ctx, confirmarCusto: false, reexecutar: false, agora: () => AGORA,
});
const fDesconhecida = desconhecida.fases.find((x) => x.fase === 'Apify')!;
eq(fDesconhecida.ferramentas[0]!.estado, 'ERRO', 'ferramenta inexistente: ERRO, nunca EXECUTADA');
ok((fDesconhecida.ferramentas[0]!.erro ?? '').includes('desconhecida'), 'com a mensagem real', fDesconhecida.ferramentas[0]!.erro);
eq(fDesconhecida.estado, 'ERRO', 'a fase reflete o erro');

// 4. re-executar só o que falta: o que já correu não repete
const pExec = planoApify(factos({ seedType: 'username', apifyToken: true }));
const inicio = progressoInicial(pExec);
const jaExecutada = {
  ...inicio,
  fases: inicio.fases.map((f) => f.fase === 'Apify'
    ? { ...f, ferramentas: f.ferramentas.map((x) => ({ ...x, estado: 'EXECUTADA' as const, contagem: 42, ms: 7 })) }
    : f),
};
const semRepetir = await executarPlano({
  plano: pExec, progresso: jaExecutada, inv, ctx, confirmarCusto: false, reexecutar: false, agora: () => AGORA,
});
const registo1 = semRepetir.fases.find((x) => x.fase === 'Apify')!.ferramentas[0]!;
eq(registo1.estado, 'EXECUTADA', 'o que já correu não volta a correr');
eq(registo1.contagem, 42, 'a contagem de quem já correu é preservada');

const repetir = await executarPlano({
  plano: pExec, progresso: jaExecutada, inv, ctx, confirmarCusto: false, reexecutar: true, agora: () => AGORA,
});
const registo2 = repetir.fases.find((x) => x.fase === 'Apify')!.ferramentas[0]!;
ok(registo2.estado !== 'EXECUTADA' || registo2.contagem !== 42,
  'reexecutar: true volta a tentar mesmo o que já tinha corrido', JSON.stringify(registo2));

// 5. o progresso guarda-se a meio: cada fase executada fica escrita
const pMeio = plano('CUSTOM', ['intel-perfil'], factos({ nos: 22 }));
const meio = await executarPlano({
  plano: pMeio, progresso: null, inv, ctx, confirmarCusto: false, reexecutar: false, agora: () => AGORA,
});
// Os factos dizem que há nós, mas a investigação não existe: a etapa recusa-se
// a calcular sobre nada em vez de devolver um perfil vazio a seguir por CONCLUIDA.
const fIntel = meio.fases.find((x) => x.fase === 'Intelligence')!;
eq(fIntel.estado, 'ERRO', 'etapa do motor: sem nós reais não há cálculo');
ok((fIntel.ferramentas[0]!.erro ?? '').includes('nós'), 'diz porque é que não calculou', fIntel.ferramentas[0]!.erro);
ok(fIntel.ferramentas[0]!.contagem === undefined, 'não devolve contagem de nada');
eq(meio.fases.filter((f) => f.pulada).length, 7, 'as restantes 7 fases ficaram fora do plano');

const pSemNos = plano('CUSTOM', ['intel-perfil'], factos({ nos: 0 }));
const semNada = await executarPlano({
  plano: pSemNos, progresso: null, inv, ctx, confirmarCusto: false, reexecutar: false, agora: () => AGORA,
});
const fSemNos = semNada.fases.find((x) => x.fase === 'Intelligence')!;
eq(fSemNos.ferramentas[0]!.estado, 'NAO_EXECUTADA', 'sem nós: a etapa não corre (e não inventa)');
eq(fSemNos.estado, 'BLOQUEADA', 'a fase fica BLOQUEADA, não CONCLUIDA');
ok((fSemNos.ferramentas[0]!.erro ?? '').length > 5, 'com o motivo', fSemNos.ferramentas[0]!.erro);

// ============================================================ resumo
console.log('\n── RESUMO ────────────────────────────────────────────────────────');
const s = resumoProgresso(semCusto);
eq(s.fases, 8, 'resumo conta fases');
eq(s.executadas, 0, 'resumo: nada executado sem confirmação');
eq(s.bloqueadas, 1, 'resumo: a única fase do plano ficou bloqueada');
eq(s.pendentes, 7, 'resumo: as 7 puladas continuam pendentes');
ok(Object.values(ETAPAS).length === 4, 'quatro etapas do motor');
eq(Object.keys(FORA_DO_PLANO).length, 1, 'uma ferramenta do catálogo fora das 8 fases, com explicação');
eq(ETAPAS['intel-snapshot']?.fase, 'Snapshots', 'a etapa de snapshot pertence aos Snapshots');
for (const [id, v] of Object.entries(ETAPAS)) {
  ok(faseDe(id) === v.fase, `etapa ${id} na fase certa`);
}
ok(todos(pFull).every((id) => faseDe(id) !== null), 'toda a ferramenta do plano tem fase');
eq(CATALOGO.length, 8, 'o catálogo real é o que está registado');
ok(Object.keys(PLANS).length === 3, 'três planos');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
