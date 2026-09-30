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
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.KeyboardEvent ??= dom.window.KeyboardEvent;
g.MouseEvent ??= dom.window.MouseEvent;
g.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.window.matchMedia ??= g.matchMedia;
g.requestAnimationFrame ??= (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0);
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

test('o pedido de plano é um link de verdade, não um "pedido registado" falso', () => {
  const plans = readFileSync(join(SRC, 'pages', 'Plans.tsx'), 'utf8');
  assert.match(plans, /wa\.me/, 'o fluxo de ativação tem de abrir um canal de contacto real');
  assert.ok(!/Pedido registado/.test(plans), '"Pedido registado" é mentira: nada é registado');

  const api = readFileSync(join(SRC, 'api.ts'), 'utf8');
  assert.match(api, /export function pedidoPlanoLink/, 'falta o link de pedido com a mensagem pronta');
  assert.match(api, /encodeURIComponent/, 'a mensagem tem de ser percent-encoded na URL');
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

  // HOST e PORT são injected pelo Render; as de tuning têm valor por omissão
  // razoável e não precisam de ser declaradas.
  const injetadas = new Set(['HOST', 'PORT']);
  const opcionais = new Set([
    'ARGUS_ALLOWED_ORIGINS', 'ARGUS_AUTH_MAX', 'ARGUS_AUTH_WINDOW_MIN',
    'ARGUS_COOKIE_SAMESITE', 'ARGUS_IP_MAX', 'ARGUS_REGISTER_MAX', 'ARGUS_RUN_MAX',
    'ARGUS_SESSION_DAYS', 'ARGUS_UPLOAD_MAX', 'ARGUS_WEB_DIST',
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
