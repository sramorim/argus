/**
 * Testes de interface.
 *
 * Existem por causa de um bug que nenhum teste de backend apanhava: o
 * `ToastHost` estava exportado em `components/ui.tsx` e **nenhuma página o
 * montava**. O `useToast()` devolvia a função vazia do contexto e TODOS os
 * avisos — plano alterado, investigação apagada, chave guardada, ficheiro
 * grande demais — desapareciam sem dar sinal nenhum. O servidor estava
 * perfeito; o utilizador é que ficava às escuras.
 *
 * São dois tipos de verificação:
 *   1. **DOM real** — monta a aplicação e confirma que o aviso aparece mesmo.
 *      É o único sítio onde se apanha "isto está no código mas nunca chegou ao
 *      ecrã".
 *   2. **Integridade** — coisas que ninguém vê atébreaker: classe usada sem
 *      regra no CSS, ícone do manifesto em falta, `og:image` relativo, categoria
 *      de ferramenta sem ícone.
 *
 *   npm run test:ui
 */import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const ROOT = resolve(WEB, '..', '..');
const SRC = join(WEB, 'src');

// ==========================================================================
// 1. DOM REAL
// ==========================================================================

// O DOM tem de existir ANTES de o react-dom ser carregado: ele guarda uma
// referência ao `document` no momento em que o módulo é avaliado. Por isso esta
// parte corre primeiro, e só depois é que o bundle (com o React lá dentro) é
// importado.
const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.navigator ??= dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.KeyboardEvent ??= dom.window.KeyboardEvent;
g.MouseEvent ??= dom.window.MouseEvent;
g.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.window.matchMedia ??= g.matchMedia;
g.requestAnimationFrame ??= (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0);
// O linkedom nao implementa scrollTo nem scrollIntoView, e o AppShell chama os
// dois ao navegar. Sem este stub o teste morre com "not a function" e nunca chega
// a verificar o que interessa.
g.window.scrollTo ??= (() => {}) as any;
g.window.scroll ??= (() => {}) as any;
if (!g.Element.prototype.scrollIntoView) g.Element.prototype.scrollIntoView = function () {};
g.cancelAnimationFrame ??= (id: any) => clearTimeout(id);
g.window.requestAnimationFrame ??= g.requestAnimationFrame;
g.IS_REACT_ACT_ENVIRONMENT = true;

/** Rede falsa: nada sai para a rede, e o teste sabe o que devolveu. */
function stubFetch() {
  const chamadas: { url: string; metodo: string }[] = [];
  const body = (url: string) => {
    if (url.includes('/api/me')) return { user: null };
    if (url.includes('/api/tools')) {
      return {
        tools: [{
          id: 'domain-analyzer', name: 'Analisador de Domínio', category: 'infra',
          summary: 'RDAP, DNS e subdomínios por transparency logs.', longDesc: 'detalhe',
          minPlan: 'free', fields: [{ name: 'domain', label: 'Domínio', type: 'text', required: true }],
          freeTier: true, legalGate: 'none', tags: ['dns', 'rdap'], lock: 'open',
          dailyRuns: 15, maxItems: 25,
        }],
        plan: 'free', usage: null,
      };
    }
    if (url.includes('/api/plans')) return { plans: [] };
    return {};
  };
  g.fetch = async (url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), metodo: init?.method ?? 'GET' });
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(body(String(url))),
      json: async () => body(String(url)),
      headers: { getSetCookie: () => [] },
    } as any;
  };
  return chamadas;
}

const bundle = await esbuild.build({
  entryPoints: [join(HERE, 'harness.tsx')],
  bundle: true, format: 'esm', platform: 'node', target: 'node22',
  outfile: join(ROOT, 'node_modules', '.cache', 'argus-harness.mjs'),
  absWorkingDir: ROOT, logLevel: 'silent',
  loader: { '.css': 'empty' },
});
assert.equal(bundle.errors.length, 0, 'o harness de UI não compila');
const H = await import(pathToFileURL(join(ROOT, 'node_modules', '.cache', 'argus-harness.mjs')).href);
// `createElement` recebe a REFERÊNCIA do componente. Passar a string
// 'ToastHost' fazia o React tratá-la como etiqueta HTML e não renderizava nada.
const React_ = (comp: any, props: any, ...filhos: any[]) => H.el(comp, props, ...filhos);

test('o ToastHost tem de estar montado — senão todos os avisos desaparecem', () => {
  stubFetch();
  const t = H.monta(React_(H.ToastHost, null, React_(H.BotaoAviso)));
  assert.ok(t.html().includes('aria-live="polite"'), 'o contentor de avisos não foi montado no DOM');
  H.disparAviso();
  assert.match(t.texto(), /guardado/, 'o aviso não apareceu no ecrã');
  t.desmontar();
});

test('um aviso de erro leva a classe de erro', () => {
  stubFetch();
  const t = H.monta(React_(H.ToastHost, null, React_(H.BotaoAviso)));
  H.disparAviso('err');
  assert.match(t.html(), /toast-err/, 'o aviso de erro não leva a classe de erro');
  t.desmontar();
});

test('sem provider o aviso não aparece — é isso que torna o teste acima válido', () => {
  // Se isto aparecesse, o teste de cima não provaria nada: a origem tem de ser
  // o ToastHost, não o facto de o botão estar montado.
  const t = H.monta(React_(H.BotaoAviso));
  H.disparAviso();
  assert.ok(!/guardado/.test(t.texto()), 'o aviso apareceu sem provider');
  t.desmontar();
});

test('a app real (main.tsx) monta o ToastHost à volta de tudo', () => {
  stubFetch();
  const src = readFileSync(join(SRC, 'main.tsx'), 'utf8');
  const posToast = src.indexOf('<ToastHost>');
  const posErro = src.indexOf('<ErrorBoundary>');
  assert.ok(posToast > -1, 'main.tsx não monta o ToastHost: TODOS os avisos da app estão mudos');
  assert.ok(posToast > posErro, 'o ToastHost tem de estar dentro do ErrorBoundary, senão um erro deixa avisos pendurados');
  assert.ok(
    /<ToastHost>[\s\S]*?<App \/>/.test(src),
    'o ToastHost tem de envolver o componente <App/>',
  );
});

// ==========================================================================
// 2. INTEGRIDADE — o que só se descobre quando já está no ar
// ==========================================================================

test('toda classe usada no TSX tem regra no CSS', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  const definidas = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

  const fontes: string[] = [];
  const anda = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (/\.tsx$/.test(e.name)) fontes.push(p);
    }
  };
  anda(SRC);

  const faltam = new Set<string>();
  for (const f of fontes) {
    for (const m of readFileSync(f, 'utf8').matchAll(/className="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c && !definidas.has(c)) faltam.add(c);
    }
  }
  assert.equal([...faltam].join(', '), '', 'classes sem estilo: ' + [...faltam].join(', '));
});

test('a visibilidade por largura é feita em CSS, não com window.innerWidth no render', () => {
  const shell = readFileSync(join(SRC, 'pages', 'AppShell.tsx'), 'utf8');
  assert.ok(
    !/window\.innerWidth/.test(shell),
    'AppShell volta a ler window.innerWidth no render: a visibilidade dos botões ' +
    'fica presa ao último render e não acompanha o redimensionamento nem a rotação do telemóvel',
  );
  assert.match(shell, /only-narrow/, 'os botões de telemóvel devem usar .only-narrow');

  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  assert.match(css, /\.only-narrow\s*\{\s*display:\s*none/, '.only-narrow escondida por omissão');
  assert.match(
    css, /@media \(max-width: 1000px\)\s*\{[\s\S]*?\.only-narrow\s*\{\s*display:\s*grid/,
    '.only-narrow tem de aparecer no media query dos ecrãs estreitos',
  );
});

test('as categorias de ferramenta têm todas ícone e nome próprios', () => {
  const icons = readFileSync(join(SRC, 'components', 'Icons.tsx'), 'utf8');
  // O corpo do objeto começa no primeiro `{` depois do nome. Não se pode usar
  // um regex `nome[^=]*=` porque a anotação de tipo tem `=>` dentro dela.
  const bloco = (nome: string) => {
    const i = icons.indexOf(nome);
    assert.ok(i > -1, `não encontrei ${nome} em Icons.tsx`);
    const inicio = icons.indexOf('{', i);
    const fim = icons.indexOf('\n};', inicio);
    assert.ok(fim > inicio, `${nome} não tem o fecho esperado`);
    return icons.slice(inicio, fim);
  };
  const catIcon = bloco('CATEGORY_ICON');
  const catLabel = bloco('CATEGORY_LABEL');

  const usadas = new Set<string>();
  for (const f of ['infra', 'identity', 'threat', 'finance-dev-br', 'tls', 'graph']) {
    const p = join(ROOT, 'apps', 'server', 'src', 'tools', `${f}.ts`);
    for (const m of readFileSync(p, 'utf8').matchAll(/category:\s*'([a-z-]+)'/g)) usadas.add(m[1]!);
  }
  assert.ok(usadas.size >= 8, `só encontrei ${usadas.size} categorias`);

  const semIcone = [...usadas].filter((c) => !new RegExp(`\\b${c}:`).test(catIcon));
  const semNome = [...usadas].filter((c) => !new RegExp(`\\b${c}:`).test(catLabel));
  assert.equal(semIcone.join(','), '', 'sem ícone (cairiam no ícone genérico)');
  assert.equal(semNome.join(','), '', 'sem nome (o utilizador veria o id cru)');
});

/**
 * A arquitectura de informação é a decisão de produto mais importante do
 * frontend, e é o que a referência usada de exemplo demonstra melhor: agrupar
 * por objetivo, não despejar tudo num índice.
 *
 * Estes testes montam a app com o catálogo real e verificam que a navegação
 * corresponde ao que o `ia.ts` declara. Se um grupo apanhar uma ferramenta que
 * não lhe pertence, ou se uma ferramenta desaparecer de todos os grupos, o
 * teste falha — que é exactamente o tipo de coisa que só se descobre a abrir.
 */
test('a navegação é por grupos, e cada ferramenta está exactamente num', () => {
  const tools = H.stubApi();

  // 1. As 26 ferramentas do catálogo estão todas em algum grupo.
  const porId = new Map(tools.map((t) => [t.id, t]));
  const faltam = H.GRUPOS.flatMap((g) => g.ferramentas).filter((id) => !porId.has(id));
  assert.equal(faltam.join(', '), '', 'ferramentas em grupos que não existem no catálogo: ' + faltam.join(', '));

  // 2. Nenhuma ferramenta está em dois grupos (senão aparece duas vezes no menu).
  const contagem = new Map<string, number>();
  for (const g of H.GRUPOS) for (const id of g.ferramentas) contagem.set(id, (contagem.get(id) ?? 0) + 1);
  const duplicadas = [...contagem].filter(([, n]) => n > 1).map(([id]) => id);
  assert.equal(duplicadas.join(', '), '', 'ferramentas em mais de um grupo: ' + duplicadas.join(', '));

  // 3. Toda a ferramenta do catálogo está em algum grupo.
  const todas = new Set(H.GRUPOS.flatMap((g) => g.ferramentas));
  const orfas = tools.map((t) => t.id).filter((id) => !todas.has(id));
  assert.equal(orfas.join(', '), '', 'ferramentas do catálogo sem grupo (ficariam inalcançáveis): ' + orfas.join(', '));
});

test('a organização não promete ferramentas que não existem', () => {
  const tools = H.stubApi();
  const ids = new Set(tools.map((t) => t.id));
  // A referência tem Instagram/TikTok/X/Reddit/YouTube e Leak Check. Aqui não
  // existem e não podem ser prometidas. Este teste existe para travar essa
  // tentação, que é o modo mais fácil de passar de "26 reais" a "36 inventadas".
  const inexistentes = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube', 'leak-check', 'onion-finder'];
  for (const g of H.GRUPOS) {
    for (const id of g.ferramentas) {
      assert.ok(
        !inexistentes.includes(id),
        `o grupo "${g.nome}" lista "${id}", que não é uma ferramenta do ARGUS`,
      );
    }
    assert.ok(
      g.ferramentas.every((id) => ids.has(id)),
      `o grupo "${g.nome}" lista ferramentas que não existem: ${g.ferramentas.filter((i) => !ids.has(i)).join(', ')}`,
    );
    assert.ok(g.resumo.length > 20, `o grupo "${g.nome}" não explica o que serve`);
  }
});

test('os grupos são poucos e descritos — a sidebar não é uma lista gigante', () => {
  assert.ok(H.GRUPOS.length <= 9, `${H.GRUPOS.length} grupos é demasiado para um menu lateral`);
  for (const g of H.GRUPOS) {
    assert.ok(g.nome.length >= 3 && g.nome.length <= 30, `nome de grupo estranho: "${g.nome}"`);
    assert.ok(g.ferramentas.length >= 1, `grupo "${g.nome}" vazio`);
  }
});

test('a busca encontra por nome, etiqueta e grupo', () => {
  const tools = H.stubApi();
  // A busca também acerta pelo resumo do grupo, por isso "username" devolve a
  // ferramenta E as irmãs do mesmo grupo. O que se exige é que a ferramenta
  // esteja lá — não que a busca seja uma lista exacta.
  assert.ok(H.buscar(tools, 'username').some((t: any) => t.id === 'username-finder'), 'devia achar o localizador de username');
  assert.ok(H.buscar(tools, 'telefone').length >= 1, 'devia achar o analisador de telefone');
  assert.ok(H.buscar(tools, 'dns').length >= 1, 'devia achar por etiqueta');
  assert.ok(H.buscar(tools, 'infraestrutura').length >= 1, 'devia achar pelo nome do grupo');
  assert.equal(H.buscar(tools, 'nao-existe-nada').length, 0, 'não devia inventar resultados');
});

/** A app montada de verdade, com o shell e o painel. */
function montaApp(so: Record<string, unknown> = {}, vista: string = 'dashboard') {
  const tools = H.stubApi(so);
  const user = { userId: 'u1', plan: 'free', email: 'ui@exemplo.test', name: 'UI', isAdmin: false };
  const V = H.VISTAS.find((v: any) => v.id === vista) ?? H.VISTAS[0];
  const view = { k: V.id } as any;
  return {
    tools,
    t: H.monta(H.el(H.AppShell, {
      user, tools, usage: { today: 2, daily: 15, concurrent: 1, inflight: 0 },
      view, setView: () => {}, onLogout: () => {}, refreshUser: () => {},
    })),
  };
}

test('a app monta a sidebar com camadas expansíveis e marca a atual', () => {
  const { t } = montaApp();
  const html = t.html();
  // Não se assume a ordem dos atributos no HTML (o renderizador põe-nos por
  // ordem alfabética): apanha-se o <div ...> cujos atributos trazem class="layer".
  const camadas = [...html.matchAll(/<div ([^>]*class="layer"[^>]*)>/g)].map((m) => m[1]);
  assert.equal(camadas.length, H.GRUPOS.length, `deviam ser ${H.GRUPOS.length} camadas, apareceram ${camadas.length}`);

  // Todas começam fechadas excepto a primeira: é o que evita a parede de texto.
  const abertas = camadas.map((atributos) => atributos.includes('data-open="true"'));
  assert.equal(abertas.filter(Boolean).length, 1, 'só uma camada deve estar aberta de inicio');
  assert.equal(abertas[0], true, 'a primeira camada devia estar aberta');
  assert.ok(abertas.slice(1).every((a) => a === false), 'as restantes deviam estar fechadas');
  assert.ok(/aria-expanded="false"/.test(html), 'o botão das camadas fechadas devia dizer aria-expanded=false');
  // Cada camada abre e fecha: é o comportamento que se pede, não uma lista.
  assert.equal((html.match(/aria-expanded="(true|false)"/g) ?? []).length, H.GRUPOS.length,
    'cada camada tem de ter um botão que abre e fecha');
  t.desmontar();
});

/**
 * O espaço de trabalho: a área de trabalho, as janelas e a barra de tarefas.
 *
 * Estes testes existem porque a navegação deixou de ser "uma página de cada
 * vez": agora abrem-se várias janelas e é a barra de tarefas que diz o que está
 * aberto. O que se verifica é o que se pede ao utilizador — todos os ícones lá
 * estão, um clique abre, o × fecha, minimizar esconde e a barra restaura.
 */
test('a área de trabalho tem um ícone por ferramenta e por aplicação', () => {
  const { tools, t } = montaApp();
  const html = t.html();

  // Uma secção por grupo, com o nome que o `ia.ts` declara.
  for (const g of H.GRUPOS) {
    assert.ok(html.includes(g.nome), `falta no desktop a secção "${g.nome}"`);
  }

  // As ferramentas aparecem com o seu id — é isso que liga o ícone à janela.
  for (const f of tools) {
    assert.ok(html.includes(`data-tool="${f.id}"`), `falta o ícone de ${f.id}`);
  }
  const nIcones = (html.match(/class="desk-icon"/g) ?? []).length;
  const nApps = H.VISTAS.filter((v: any) => v.id !== 'admin').length;   // utilizador comum
  assert.equal(nIcones, tools.length + nApps,
    `${nIcones} ícones: deviam ser ${tools.length} ferramentas + ${nApps} aplicações`);
  t.desmontar();
});

test('um clique num ícone abre a janela, e o × a fecha e a tira da barra de tarefas', () => {
  const { t } = montaApp();
  // O painel abre sozinho: é o primeiro ecrã.
  assert.equal(t.caixa.querySelectorAll('.janela').length, 1, 'o painel devia estar aberto de inicio');
  assert.equal(t.caixa.querySelectorAll('.task-item').length, 1, 'a barra de tarefas devia mostrar a janela do painel');

  H.clica(t, '.desk-icon[data-tool="domain-analyzer"]');
  const nomes = [...t.caixa.querySelectorAll('.win-name')].map((n) => n.textContent);
  assert.equal(t.caixa.querySelectorAll('.janela').length, 2, 'a ferramenta devia abrir sem fechar o painel');
  assert.ok(nomes.includes('Analisador de Domínio'), `janelas abertas: ${nomes.join(' | ')}`);
  assert.equal(t.caixa.querySelectorAll('.task-item').length, 2, 'a barra de tarefas devia listar as duas');

  // O conteúdo da ferramenta está DENTRO da janela, não numa página à parte.
  const janela = t.caixa.querySelector('.janela[aria-label="Analisador de Domínio"]');
  assert.ok(janela, 'a janela devia ser identificável pelo título');
  assert.ok(janela!.querySelector('.win-body'), 'a janela não tem área de conteúdo');
  // Os três controlos da barra de título, com nome para quem usa leitor de ecrã.
  for (const o of ['Minimizar', 'Maximizar', 'Fechar']) {
    assert.ok(janela!.querySelector(`[aria-label^="${o}"]`), `falta o botão ${o}`);
  }

  H.clica(t, '.janela[aria-label="Analisador de Domínio"] .win-close');
  assert.equal(t.caixa.querySelectorAll('.win-name').length, 1, 'o × devia fechar a janela');
  assert.equal(t.caixa.querySelectorAll('.task-item').length, 1, 'a barra de tarefas devia seguir a janela fechada');
  assert.ok(
    [...t.caixa.querySelectorAll('.win-name')].some((n) => n.textContent === 'Painel'),
    'fechar a ferramenta não devia fechar o painel',
  );
  t.desmontar();
});

test('minimizar esconde a janela e a barra de tarefas restaura-a', () => {
  const { t } = montaApp();
  const painel = '.janela[aria-label="Painel"]';
  assert.equal(t.caixa.querySelector(`${painel}[data-min="false"]`) !== null, true, 'o painel devia começar visível');

  H.clica(t, `${painel} [aria-label^="Minimizar"]`);
  assert.equal(t.caixa.querySelector(`${painel}[data-min="true"]`) !== null, true, 'minimizar devia esconder a janela');

  H.clica(t, '.task-item');
  assert.equal(t.caixa.querySelector(`${painel}[data-min="false"]`) !== null, true,
    'carregar na barra de tarefas devia restaurar a janela');
  t.desmontar();
});

test('maximizar ocupa a área toda e o botão passa a dizer Restaurar', () => {
  const { t } = montaApp();
  const painel = '.janela[aria-label="Painel"]';
  H.clica(t, `${painel} [aria-label^="Maximizar"]`);
  assert.equal(t.caixa.querySelector(`${painel}[data-max="true"]`) !== null, true, 'devia maximizar');
  assert.ok(t.caixa.querySelector('[aria-label^="Restaurar"]'), 'o botão devia passar a Restaurar');

  H.clica(t, `${painel} [aria-label^="Restaurar"]`);
  assert.equal(t.caixa.querySelector(`${painel}[data-max="false"]`) !== null, true, 'devia voltar ao tamanho anterior');
  t.desmontar();
});

test('o painel é o primeiro ecrã e tem a acção principal em grande', () => {

  const { t } = montaApp();
  const html = t.html();
  assert.match(html, /Nova investigação/, 'falta a acção principal');
  assert.match(html, /hero-panel/, 'falta o bloco principal do painel');
  // O painel não pode despejar 26 cartões: tem de estar agrupado.
  const cartoes = (html.match(/class="tool-card"/g) ?? []).length;
  assert.ok(cartoes <= H.GRUPOS.length, `${cartoes} cartões soltos no painel — o objectivo é agrupar, não despejar`);
  // E tem de mostrar o estado real da cota, não um número inventado.
  assert.match(html, /2\/15/, 'não mostra o uso real da cota');
  t.desmontar();
});

test('o rodapé leva a marca e o copyright', () => {
  const { t } = montaApp();
  const html = t.html();
  assert.match(html, /© 2026 SR\. Amorim/, 'falta o copyright no rodapé');
  assert.match(html, /Todos os direitos reservados/);
  assert.match(html, /wa\.me\/5547997876098/, 'o WhatsApp tem de vir do servidor');
  t.desmontar();
});

test('a paleta é azul profissional — sem verde de Matrix nem vermelho de gamer', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  // Lê o valor pelo nome do token, sem depender do alinhamento de espaços.
  const token = (nome: string) => new RegExp(nome + '\\s*:\\s*(#[0-9A-Fa-f]{3,8})').exec(css)?.[1];
  const esperado: Record<string, string> = {
    '--bg': '#07111F',
    '--surface': '#0D1B2A',
    '--surface-2': '#102338',
    '--line': '#1E334A',
    '--blue': '#1677FF',
    '--blue-2': '#2F8CFF',
    '--blue-3': '#58B0FF',
    '--t-1': '#F4F7FB',
    '--t-3': '#91A4B8',
    '--erro': '#EF4444',
    '--ok': '#22C55E',
  };
  for (const [nome, valor] of Object.entries(esperado)) {
    assert.equal(token(nome), valor, `${nome} devia ser ${valor}, obtive ${token(nome)}`);
  }
  // E não pode haver verde Matrix como cor de interface.
  assert.ok(!/#00FF00|#0F0\b|green/i.test(css), 'há verde na interface');
});

test('o pedido de plano é um canal de contacto real, não um "pedido registado" falso', () => {
  const plans = readFileSync(join(SRC, 'pages', 'Plans.tsx'), 'utf8');
  const api = readFileSync(join(SRC, 'api.ts'), 'utf8');

  // O link pode vir de dois sítios legítimos: escrito à mão, ou montado pelo
  // servidor. O que é proibido é o botão que confirma um pedido que ninguém
  // recebeu.
  assert.ok(
    /wa\.me/.test(plans) || /pedidoPlanoLink/.test(plans),
    'o fluxo de ativação tem de abrir um canal de contacto real',
  );
  assert.ok(!/Pedido registado/.test(plans), '"Pedido registado" é mentira: nada é registado');
  assert.match(api, /export function pedidoPlanoLink/, 'falta o link de pedido com a mensagem pronta');
  assert.match(api, /encodeURIComponent/, 'a mensagem tem de ser percent-encoded na URL');

  // E o número tem de vir do servidor, para não voltar a divergir do Contacto.
  const server = readFileSync(join(ROOT, 'apps', 'server', 'src', 'index.ts'), 'utf8');
  assert.match(server, /app\.get\('\/api\/contact'/, 'o servidor tem de ser a fonte do contacto');
});

/**
 * O número de WhatsApp e o nome do autor não podem estar escritos à mão no
 * frontend: já aconteceu o número divergir do que o dono usava, em três
 * sítios diferentes, e ninguém deu por isso.
 */
test('o contacto e a autoria vêm do servidor, não escritos à mão', () => {
  const server = readFileSync(join(ROOT, 'apps', 'server', 'src', 'index.ts'), 'utf8');
  assert.match(server, /app\.get\('\/api\/contact'/, 'falta o endpoint /api/contact');
  assert.match(server, /config\.contacto\.whatsapp/, 'o endpoint tem de ler o contacto da config');

  const config = readFileSync(join(ROOT, 'apps', 'server', 'src', 'config.ts'), 'utf8');
  assert.match(config, /ARGUS_CONTACTO_WHATSAPP/, 'o número tem de vir do ambiente');
  assert.match(config, /ARGUS_AUTHOR/, 'o autor tem de vir do ambiente');
  // A validação é o que impede o número errado de voltar.
  assert.match(config, /celular brasileiro tem 9 digitos/, 'falta a validação do formato do número');

  // Nenhuma página pode ter o número colado.
  const paginas: string[] = [];
  const anda = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (/\.tsx$/.test(e.name)) paginas.push(p);
    }
  };
  anda(join(SRC, 'pages'));
  for (const f of paginas) {
    const src = readFileSync(f, 'utf8');
    assert.ok(
      !/55\s?4?79?\d{9}/.test(src),
      `${f} tem um número de WhatsApp escrito à mão — tem de vir de /api/contact`,
    );
  }
});

test('a marca é a mesma no React e nos ficheiros SVG', () => {
  const ui = readFileSync(join(SRC, 'components', 'ui.tsx'), 'utf8');
  const svg = readFileSync(join(WEB, 'public', 'logo-mark.svg'), 'utf8');
  for (const cor of ['#DC2626', '#B91C1C', '#C8CDD4']) {
    assert.ok(ui.includes(cor), `a marca em React perdeu ${cor}`);
    assert.ok(svg.includes(cor), `o logo-mark.svg perdeu ${cor}`);
  }
});

test('a capa social é 1200x630 e as etiquetas OG são absolutas', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const img = /og:image"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
  assert.match(img, /^https:\/\//, 'og:image tem de ser absoluto: as plataformas não resolvem relativos');
  assert.match(html, /og:image:width"\s+content="1200"/);
  assert.match(html, /og:image:height"\s+content="630"/);
  assert.match(html, /twitter:card"\s+content="summary_large_image"/);
});

test('todo o ficheiro referenciado pelo HTML e pelo manifesto existe', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const ref = new Set<string>();
  for (const m of html.matchAll(/(?:href|content)="\/([^"?#]+\.(?:png|svg|webmanifest|ico))"/g)) ref.add(m[1]!);

  const manifest = JSON.parse(readFileSync(join(WEB, 'public', 'site.webmanifest'), 'utf8'));
  for (const i of manifest.icons) if (i.src.startsWith('/')) ref.add(i.src.slice(1));

  const emFalta = [...ref].filter((f) => !existsSync(join(WEB, 'public', f)));
  assert.equal(emFalta.join(', '), '', 'referenciados mas inexistentes: ' + emFalta.join(', '));
});

test('o gerador de ícones produz tudo o que o manifesto e o HTML pedem', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'make-icons.mjs'), 'utf8');
  for (const alvo of ['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-cover.png']) {
    assert.ok(script.includes(alvo), `make-icons.mjs deixou de gerar ${alvo}`);
    assert.ok(existsSync(join(WEB, 'public', alvo)), `${alvo} não está em public/`);
  }
  assert.match(script, /1200,\s*630/, 'a capa social tem de ser 1200x630');
});

test('o buildCommand do Render instala o que o build precisa', () => {
  const yml = readFileSync(join(ROOT, 'render.yaml'), 'utf8');
  const build = /buildCommand:\s*(.+)/.exec(yml)?.[1] ?? '';
  assert.match(build, /npm ci/, 'tem de instalar com npm ci, para respeitar o lockfile');
  // O ficheiro põe NODE_ENV=production nas envVars, e o npm omite as
  // devDependencies nesse caso. Sem --include=dev o build instala 9 pacotes, não
  // encontra o vite e morre. Foi verificado com um `npm ci` real, não é teórico.
  assert.match(
    build, /--include=dev/,
    'falta --include=dev: com NODE_ENV=production o npm não instala o vite e o build falha',
  );
  assert.match(yml, /healthCheckPath:\s*\/api\/health/, 'sem healthCheckPath o Render não sabe se o serviço está vivo');
  assert.match(yml, /ARGUS_DB[\s\S]{0,40}\/var\/data/, 'o ARGUS_DB tem de apontar para o disco montado');
  assert.match(yml, /mountPath:\s*\/var\/data/, 'o disco tem de montar em /var/data');
});

/**
 * Este teste é a história do deploy partido.
 *
 * O `render.yaml` nasceu quando o ARGUS vivia dentro de `central-amorim/probe/`,
 * por isso trazia `rootDir: probe`. Quando o ARGUS passou a ter repositório
 * próprio (`sramorim/argus`, com o código na raiz), esse `rootDir` continuou lá
 * e o Render recusou criar o serviço com:
 *
 *     Root directory 'probe' does not exist
 *
 * A regra que este teste fixa: **se `render.yaml` declarar um `rootDir`, essa
 * pasta tem de existir no repositório.** É o que impede a mesma confusão de
 * voltar, seja por renomear o repositório, mover a pasta ou trocar o layout.
 */
test('se o render.yaml declarar rootDir, essa pasta tem de existir no repositório', () => {
  const yml = readFileSync(join(ROOT, 'render.yaml'), 'utf8');
  const m = /^\s*rootDir:\s*(\S+)\s*$/m.exec(yml);

  if (!m) {
    // Caso esperado hoje: sem rootDir, o Render constrói a partir da raiz.
    assert.ok(
      existsSync(join(ROOT, 'package.json')),
      'sem rootDir, a raiz do repositório tem de ser o ARGUS (package.json na raiz)',
    );
    return;
  }

  const dir = m[1]!.replace(/^["']|["']$/g, '');
  const normalizado = dir === '.' ? '' : dir.replace(/^\/+|\/+$/g, '');
  assert.ok(
    !normalizado || existsSync(join(ROOT, normalizado)),
    `rootDir "${dir}" não existe no repositório — o Render vai recusar com ` +
    `"Root directory '${dir}' does not exist"`,
  );
});

/** Os comandos do Blueprint têm de correr a partir da raiz, onde vive o código. */
test('os comandos do Blueprint partem da raiz, onde estão as workspaces', () => {
  const raiz = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(existsSync(join(ROOT, 'package.json')), 'o package.json tem de estar na raiz');
  assert.deepEqual(
    raiz.workspaces,
    ['apps/server', 'apps/web'],
    'as workspaces deixaram de estar onde os scripts as esperam',
  );
  for (const ws of raiz.workspaces as string[]) {
    assert.ok(existsSync(join(ROOT, ws, 'package.json')), `falta ${ws}/package.json`);
  }
  // `npm start` tem de chegar ao servidor; se o workspace renomear e o script
  // apontar para o nome antigo, o arranque falha com "No workspaces found".
  for (const s of ['start', 'build', 'test']) {
    assert.ok(raiz.scripts[s], `falta o script "${s}" na raiz`);
  }
  // Cada `--workspace=` tem de apontar para uma workspace que exista de facto.
  const nomes = new Set<string>();
  for (const dir of raiz.workspaces as string[]) {
    nomes.add(JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).name);
  }
  for (const [nome, cmd] of Object.entries<string>(raiz.scripts)) {
    for (const m of cmd.matchAll(/--workspace=(\S+)/g)) {
      assert.ok(
        nomes.has(m[1]!),
        `o script "${nome}" aponta para a workspace inexistente "${m[1]}" ` +
        `( workspaces reais: ${[...nomes].join(', ')} )`,
      );
    }
  }
});

/**
 * Toda variável que o código lê em produção tem de estar declarada no
 * Blueprint. Uma que falte não dá erro — dá comportamento errado em silêncio,
 * que é o pior tipo de bug.
 */
test('toda variável de produção de que o código precisa está no render.yaml', () => {
  const yml = readFileSync(join(ROOT, 'render.yaml'), 'utf8');
  const usadas = new Set<string>();
  for (const f of ['config.ts', 'security.ts', 'index.ts', 'registry.ts']) {
    const src = readFileSync(join(ROOT, 'apps', 'server', 'src', f), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) usadas.add(m[1]!);
    for (const m of src.matchAll(/(?:str|bool|int|list)\('([A-Z_][A-Z0-9_]*)'/g)) usadas.add(m[1]!);
  }

  // HOST e PORT são injected pelo Render; as de tuning e as deliberadamente
  // opcionais têm valor por omissão razoável e não precisam de ser declaradas.
  const injetadas = new Set(['HOST', 'PORT']);
  const opcionais = new Set([
    'ARGUS_ALLOWED_ORIGINS', 'ARGUS_AUTH_MAX', 'ARGUS_AUTH_WINDOW_MIN',
    'ARGUS_COOKIE_SAMESITE', 'ARGUS_IP_MAX', 'ARGUS_REGISTER_MAX', 'ARGUS_RUN_MAX',
    'ARGUS_SESSION_DAYS', 'ARGUS_UPLOAD_MAX', 'ARGUS_WEB_DIST',
    // O link do autor só existe se o dono tiver um site para pôr lá. Vazio =
    // o rodapé mostra o copyright sem link, que é o comportamento pretendido.
    'ARGUS_AUTHOR_LINK',
  ]);

  const declaradas = new Set([...yml.matchAll(/^\s*-\s*key:\s*([A-Z_][A-Z0-9_]*)/gm)].map((m) => m[1]!));
  const faltam = [...usadas]
    .filter((v) => !injetadas.has(v) && !opcionais.has(v) && !declaradas.has(v))
    .sort();

  assert.equal(
    faltam.join(', '), '',
    'variáveis que o código lê e o Blueprint não declara: ' + faltam.join(', '),
  );

  // E o inverso: declarar uma variável que o código não lê é lixo que vai
  // sobrar no painel sem ninguém saber para que serve.
  const conhecidas = new Set<string>([...usadas, ...injetadas]);
  const orfas = [...declaradas].filter((v) => !conhecidas.has(v)).sort();
  assert.equal(orfas.join(', '), '', 'variáveis no Blueprint que o código não lê: ' + orfas.join(', '));
});

test('o package.json e o package-lock.json concordam (o `npm ci` do Render depende disto)', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const problemas: string[] = [];
  for (const [ws] of Object.entries<any>(lock.packages)) {
    if (!ws.startsWith('apps/')) continue;
    const pj = JSON.parse(readFileSync(join(ROOT, ws, 'package.json'), 'utf8'));
    const locked = lock.packages[ws] ?? {};
    for (const kind of ['dependencies', 'devDependencies']) {
      const declarado = pj[kind] ?? {};
      const noLock = locked[kind] ?? {};
      for (const [nome, faixa] of Object.entries(declarado)) {
        if (noLock[nome] !== faixa) problemas.push(`${ws} ${kind} ${nome}: package.json=${faixa} lock=${noLock[nome] ?? 'ausente'}`);
      }
      for (const nome of Object.keys(noLock)) {
        if (declarado[nome] === undefined) problemas.push(`${ws} ${kind} ${nome}: só no lock`);
      }
    }
  }
  assert.equal(problemas.join('\n'), '', 'package.json ≠ package-lock.json:\n' + problemas.join('\n'));
});

// ==========================================================================
// 6. PLANO DE INVESTIGAÇÃO (FASE F)
// ==========================================================================
//
// Estes testes não montam o painel — o harness não muda. Lêem o código e
// verificam o que só se descobre quando alguém "melhora" o painel a meio:
// passar a inventar estados, a esconder o que ficou bloqueado ou a confirmar
// custos do Apify sozinho. Nada disto é visível num screenshot.

const invSrc = readFileSync(join(SRC, 'pages', 'Investigations.tsx'), 'utf8');
const apiSrc = readFileSync(join(SRC, 'api.ts'), 'utf8');

/** O corpo de um objecto exportado, do nome ao `};` que o fecha. */
function corpo(src: string, nome: string): string {
  const i = src.indexOf(nome);
  assert.ok(i > -1, `não encontrei ${nome}`);
  const a = src.indexOf('{', i);
  const b = src.indexOf('\n};', a);
  assert.ok(b > a, `${nome} não tem o fecho esperado`);
  return src.slice(a, b);
}

test('o painel mostra as 8 fases que o servidor mandou, não uma lista escrita aqui', () => {
  // O que o utilizador vê tem de ser o que o planeador decidiu, por isso as
  // fases entram do JSON do plano e nunca de um array fixo no cliente.
  assert.match(invSrc, /plano\.fases\.map\(/, 'as fases vêm de plano.fases');
  assert.match(invSrc, /progresso\?\.fases\.find\(/, 'o estado corrido vem do progresso do servidor');
  assert.ok(!/\[\s*'Discovery'/.test(invSrc), 'as 8 fases não podem estar escritas à mão na página');

  // E a ordem é a do planeador, que é quem a define.
  const planSrc = readFileSync(join(ROOT, 'apps/server', 'src', 'investigation', 'plan.ts'), 'utf8');
  const bloco = planSrc.match(/export const FASES[^=]*=\s*\[([\s\S]*?)\] as const/);
  assert.ok(bloco, 'o planeador deixou de exportar a lista FASES');
  const fases = [...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    fases,
    ['Discovery', 'OSINT', 'Social', 'Apify', 'Normalization', 'Correlation', 'Intelligence', 'Snapshots'],
    'a ordem das 8 fases',
  );
});

test('o painel usa exactamente os três endpoints do plano', () => {
  const bloco = apiSrc.slice(apiSrc.indexOf('plano: ('), apiSrc.indexOf('history: ('));
  assert.ok(bloco.length > 0, 'os métodos do plano desapareceram do api.ts');
  assert.match(bloco, /req<PlanoResposta>\(`\/api\/investigations\/\$\{encodeURIComponent\(id\)\}\/plan`\),/, 'ler o plano é GET .../plan');
  assert.match(bloco, /\/plan`,\s*\{\s*method: 'POST'/, 'gerar o plano é POST .../plan');
  assert.match(bloco, /\/plan\/executar`,\s*\{\s*method: 'POST'/, 'executar é POST .../plan/executar');
  assert.equal((bloco.match(/method: 'POST'/g) ?? []).length, 2, 'dois POSTs — gerar e executar, mais nada');
});

test('os três modos são alcançáveis no painel e o CUSTOM pede a lista ao servidor', () => {
  assert.ok(invSrc.includes("gerar('QUICK')"), 'modo QUICK sem botão');
  assert.ok(invSrc.includes("gerar('FULL')"), 'modo FULL sem botão');
  assert.ok(invSrc.includes("gerar('CUSTOM', escolhidas)"), 'modo CUSTOM sem botão');
  // Os candidatos do CUSTOM vêm do plano que o servidor devolveu — o cliente
  // não tem catálogo nenhum para escolher por conta própria.
  assert.match(invSrc, /setCandidatos\(ferramentasDo\(/, 'os candidatos vêm do plano do servidor');
  assert.ok(!invSrc.includes("from '../ia'"), 'a página não importa o catálogo da IA para decidir o plano');
});

test('nenhum estado é calculado no cliente: contagens e rótulos vêm do servidor', () => {
  // As contagens mostradas são as do `resumo` que o servidor calculou; a
  // página não soma ferramentas por conta própria.
  assert.match(invSrc, /resumo\.concluidas/, 'o total de concluídas vem do resumo');
  assert.match(invSrc, /resumo\.executadas/, 'o total de executadas vem do resumo');
  assert.ok(
    !/filter\([^)]*estado\s*===\s*'(EXECUTADA|CONCLUIDA)'/.test(invSrc),
    'a página passou a contar estados à mão',
  );

  // E os rótulos/cores são os dos mapas partilhados, completos e sem verde
  // onde não houve execução.
  assert.match(invSrc, /ROTULO_FASE\[estado\]/, 'o rótulo da fase vem de ROTULO_FASE');
  assert.match(invSrc, /CLASSE_FASE\[estado\]/, 'a cor da fase vem de CLASSE_FASE');
  assert.match(invSrc, /ROTULO_FERRAMENTA\[reg\.estado\]/, 'o rótulo da ferramenta vem do mapa partilhado');

  const fase = corpo(apiSrc, 'ROTULO_FASE');
  for (const k of ['PENDENTE', 'PRONTO', 'BLOQUEADA', 'CONCLUIDA', 'PARCIAL', 'ERRO']) {
    assert.ok(new RegExp(`${k}:`).test(fase), `ROTULO_FASE sem ${k}`);
  }
  const ferr = corpo(apiSrc, 'ROTULO_FERRAMENTA');
  for (const k of ['EXECUTADA', 'TRANCADA', 'QUOTA', 'ERRO', 'NAO_EXECUTADA', 'PENDENTE']) {
    assert.ok(new RegExp(`${k}:`).test(ferr), `ROTULO_FERRAMENTA sem ${k}`);
  }
  const classes = corpo(apiSrc, 'CLASSE_FASE');
  assert.match(classes, /PENDENTE:\s*'tag'/, 'pendente não é sucesso: não pode ser verde');
  assert.match(classes, /CONCLUIDA:\s*'tag-ok'/, 'concluída é verde');
  assert.match(classes, /ERRO:\s*'tag-err'/, 'erro é vermelho');
  const classesFerr = corpo(apiSrc, 'CLASSE_FERRAMENTA');
  assert.match(classesFerr, /EXECUTADA:\s*'st st-ok'/, 'executada é verde');
  assert.match(classesFerr, /NAO_EXECUTADA:\s*'st st-skipped'/, 'não executada não pode parecer executada');
});

test('o que ficou bloqueado aparece com o motivo — nada é escondido do utilizador', () => {
  assert.match(invSrc, /fase\.motivo \?\? reg\?\.motivo/, 'o motivo da fase lê-se do plano e do progresso');
  assert.match(invSrc, /\{plan\.motivo\}/, 'o motivo da ferramenta aparece na linha');
  assert.match(invSrc, /className="fase-motivo"/, 'o motivo tem sítio próprio no cabeçalho');
  // Uma fase pulada continua visível com o seu motivo em vez de desaparecer.
  assert.match(invSrc, /fase\.pulada/, 'a página sabe distinguir as puladas');
  assert.match(invSrc, /<span className="tag tag-free">pulada<\/span>/, 'a fase pulada é dita, não omitida');
});

test('o custo do Apify só corre com confirmação explícita do utilizador', () => {
  assert.match(invSrc, /confirmarCusto: custo/, 'o corpo leva o estado do custo');
  assert.ok(!invSrc.includes('confirmarCusto: true'), 'o cliente nunca confirma custo sozinho');
  const custo = invSrc.match(/const \[custo, setCusto\] = useState\(([^)]*)\)/);
  assert.ok(custo, 'o estado do custo não começa indefinido');
  assert.equal(custo![1], 'false', 'custo começa em false: sem confirmação, sem despesa');
  // E só aparece a confirmação quando o Apify está mesmo no plano e pronto.
  assert.match(invSrc, /precisaCusto/, 'a confirmação depende do plano ter o Apify pronto');
});

test('o painel do plano é honesto no ecrã: sem verde decorativo, sem window.innerWidth', () => {
  assert.ok(!/window\.innerWidth/.test(invSrc), 'o painel não decide nada pela largura da janela');
  assert.ok(!/#00FF00|\bgreen\b/.test(invSrc), 'sem verde de Matrix no painel');
  // O aviso de que sem nós não há cálculo tem de estar escrito, não subentendido.
  assert.match(invSrc, /sem nós/, 'o painel diz o que acontece sem nós para calcular');
  // E todas as classes com estado têm cor própria no CSS.
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  assert.match(css, /\.tag-err\s*\{/, 'a classe de erro existe');
  assert.match(css, /\.fase\[data-estado='ERRO'\]/, 'a fase em erro fica marcada na borda');
  assert.match(css, /\.fase\[data-estado='BLOQUEADA'\]/, 'a fase bloqueada fica marcada na borda');
});
