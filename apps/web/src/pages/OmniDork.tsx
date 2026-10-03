/**
 * OmniDork Builder — módulo independente de composição de dorks.
 *
 * Porquê um módulo próprio e não mais uma ferramenta do catálogo: ele não
 * consulta servidor nenhum. Monta a consulta no browser e entrega-a ao motor
 * de busca escolhido numa separador nova — o processamento acontece no motor,
 * por conta do utilizador, com custo zero de servidor. Encaixá-lo no fluxo
 * `api.run()` seria mentira: não há execução, não há cota, não há proveniência
 * a mostrar.
 *
 * Três decisões que ficam escritas porque não são óbvias:
 *
 * 1. **A consulta é derivada, nunca guardada.** `keywords`, `content type`,
 *    `file extension`, `target website` e `focus on download pages` entram;
 *    a string de saída sai sempre recalculada. É o que permite o caixa de
 *    output mostrar os operadores em tempo real sem um único `useEffect`.
 * 2. **`file extension` tem prioridade sobre `content type`.** São dois
 *    caminhos para o mesmo operador `filetype:`; quando o utilizador escolhe
 *    um formato avançado, esse é o que vale, e o ecrã diz-o.
 * 3. **O feed é só de inteligência pública.** Recon, ficheiros e intel —
 *    sem categorias de vulnerabilidade e sem fases de infraestrutura/exploit.
 *    Isto não é uma lista de exploits a meio caminho: são consultas sobre
 *    material que já é público.
 *
 * Identidade: preto #09090b, grelha fina, mono, e neon #22c55e para tudo o
 * que é accionável. O azul da aplicação não entra aqui dentro — as classes
 * são todas prefixadas `od-` e os tokens vivem no `.od-root`, para o módulo
 * poder ser retirado sem deixar rasto no resto da interface.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '../components/Icons';
import { useToast } from '../components/ui';

// ------------------------------------------------------------------ opções

const TIPOS = [
  { id: 'all', label: 'All Content' },
  { id: 'video', label: 'Videos' },
  { id: 'document', label: 'Documents' },
  { id: 'audio', label: 'Audio' },
  { id: 'software', label: 'Software' },
  { id: 'image', label: 'Images' },
  { id: 'archive', label: 'Archives' },
] as const;
type Tipo = (typeof TIPOS)[number]['id'];

const EXTENSOES = [
  { id: 'any', label: 'Any Format' },
  { id: 'pdf', label: 'PDF' },
  { id: 'doc', label: 'DOC' },
  { id: 'mp4', label: 'MP4' },
  { id: 'mp3', label: 'MP3' },
  { id: 'zip', label: 'ZIP' },
] as const;
type Extensao = (typeof EXTENSOES)[number]['id'];

/** Motores: só a base de pesquisa. Nenhum pedido sai daqui. */
const MOTORES = [
  { id: 'google', label: 'Google', base: 'https://www.google.com/search?q=' },
  { id: 'bing', label: 'Bing', base: 'https://www.bing.com/search?q=' },
  { id: 'yahoo', label: 'Yahoo', base: 'https://search.yahoo.com/search?p=' },
  { id: 'duckduckgo', label: 'DuckDuckGo', base: 'https://duckduckgo.com/?q=' },
  { id: 'startpage', label: 'Startpage', base: 'https://www.startpage.com/sp/search?query=' },
  { id: 'brave', label: 'Brave Search', base: 'https://search.brave.com/search?q=' },
] as const;
type Motor = (typeof MOTORES)[number]['id'];

/** `filetype:` por tipo de conteúdo — o que vale quando a extensão está em "Any". */
const FILETYPE_POR_TIPO: Record<Tipo, string | null> = {
  all: null,
  video: '(mp4 OR mkv OR webm)',
  document: '(pdf OR doc OR docx)',
  audio: '(mp3 OR wav OR flac)',
  software: '(exe OR apk OR msi)',
  image: '(jpg OR png OR webp)',
  archive: '(zip OR rar OR 7z)',
};

/** `filetype:` pela extensão avançada — manda sobre o tipo de conteúdo. */
const FILETYPE_POR_EXT: Record<Extensao, string | null> = {
  any: null, pdf: 'pdf', doc: 'doc', mp4: 'mp4', mp3: 'mp3', zip: 'zip',
};

// ------------------------------------------------------------------- feed

type Categoria = 'recon' | 'files' | 'intel';
type Fase = '1' | '2' | '5';

interface Dork {
  id: string;
  nome: string;
  categoria: Categoria;
  fase: Fase;
  /** Template: `{alvo}` é substituído pelas palavras-chave escritas no construtor. */
  modelo: string;
  porque: string;
}

const CATEGORIAS: { id: 'all' | Categoria; label: string }[] = [
  { id: 'all', label: 'All Categories' },
  { id: 'recon', label: 'Reconnaissance' },
  { id: 'files', label: 'Sensitive Files' },
  { id: 'intel', label: 'Intelligence' },
];

const FASES: { id: Fase; label: string }[] = [
  { id: '1', label: '1: Recon' },
  { id: '2', label: '2: Files' },
  { id: '5', label: '5: Intel' },
];

const ROTULO_CATEGORIA: Record<Categoria, string> = {
  recon: 'Reconnaissance', files: 'Sensitive Files', intel: 'Intelligence',
};
const ROTULO_FASE: Record<Fase, string> = { '1': '1: Recon', '2': '2: Files', '5': '5: Intel' };

/**
 * Doze consultas, três categorias, três fases. Não há aqui SQL Injection, XSS,
 * LFI/RFI, nem fases de infraestrutura ou exploit — o feed é de fontes
 * públicas, e uma lista de exploits disfarçada de "dorks prontas" seria a
 * parte mais perigosa e a menos honesta deste módulo.
 */
const DORKS: Dork[] = [
  { id: 'r1', nome: 'Indexed pages', categoria: 'recon', fase: '1',
    modelo: 'site:{alvo}', porque: 'Everything the engine has indexed under the domain.' },
  { id: 'r2', nome: 'Login and admin surfaces', categoria: 'recon', fase: '1',
    modelo: 'site:{alvo} inurl:(admin OR login OR painel OR signin)',
    porque: 'Entry points that are already published, not attempts to break in.' },
  { id: 'r3', nome: 'Parameterised URLs', categoria: 'recon', fase: '1',
    modelo: 'site:{alvo} inurl:(id= OR q= OR url= OR redirect)',
    porque: 'Shows how the target structures its public routes.' },
  { id: 'r4', nome: 'External mentions', categoria: 'recon', fase: '1',
    modelo: '"{alvo}" -site:{alvo}', porque: 'What others publish about the target.' },

  { id: 'f1', nome: 'Directory listing', categoria: 'files', fase: '2',
    modelo: 'intitle:"index of" site:{alvo}',
    porque: 'Open directory indexes the operator forgot to close.' },
  { id: 'f2', nome: 'Configuration files', categoria: 'files', fase: '2',
    modelo: 'site:{alvo} filetype:(env OR conf OR ini OR yaml)',
    porque: 'Config files that the engine already has on record.' },
  { id: 'f3', nome: 'Backups and dumps', categoria: 'files', fase: '2',
    modelo: 'site:{alvo} filetype:(bak OR old OR sql OR gz)',
    porque: 'Old copies are the usual way a "removed" file stays public.' },
  { id: 'f4', nome: 'Spreadsheets and exports', categoria: 'files', fase: '2',
    modelo: 'site:{alvo} filetype:(xls OR xlsx OR csv)',
    porque: 'Tabular data is published far more often than intended.' },

  { id: 'i1', nome: 'Public documents naming the target', categoria: 'intel', fase: '5',
    modelo: '"{alvo}" filetype:pdf',
    porque: 'Reports, decks and filings that are public by definition.' },
  { id: 'i2', nome: 'Professional profiles', categoria: 'intel', fase: '5',
    modelo: 'site:linkedin.com/in "{alvo}"',
    porque: 'Self-published professional identity.' },
  { id: 'i3', nome: 'Contact details in public pages', categoria: 'intel', fase: '5',
    modelo: '"{alvo}" (intext:contato OR intext:email OR intext:telefone)',
    porque: 'Contact data the subject chose to publish.' },
  { id: 'i4', nome: 'Mentions in code hosts', categoria: 'intel', fase: '5',
    modelo: '"{alvo}" (site:github.com OR site:gitlab.com OR site:bitbucket.org)',
    porque: 'Names and handles that leak into repositories.' },
];

// ------------------------------------------------------------------ utilitários

/** `https://exemplo.com/rota` → `exemplo.com`. Um `site:` com caminho não devolve nada. */
const limparSite = (v: string) => v.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');

interface Peca { op: string | null; valor: string }

const montarPecas = (k: { keywords: string; tipo: Tipo; ext: Extensao; site: string; download: boolean }): Peca[] => {
  const pecas: Peca[] = [];
  const kw = k.keywords.trim();
  if (kw) pecas.push({ op: null, valor: kw });

  const ft = FILETYPE_POR_EXT[k.ext] ?? FILETYPE_POR_TIPO[k.tipo];
  if (ft) pecas.push({ op: 'filetype', valor: ft });

  const site = limparSite(k.site);
  if (site) pecas.push({ op: 'site', valor: site });

  if (k.download) pecas.push({ op: 'inurl', valor: 'download' });
  return pecas;
};

const juntar = (pecas: Peca[]) =>
  pecas.map((p) => (p.op ? `${p.op}:${p.valor}` : p.valor)).join(' ');

/** Abre o motor numa separador nova. Âncora e não `window.open`: um clique
 *  do utilizador é navegação de topo, que nenhum bloqueador de pop-up corta. */
const abrirMotor = (base: string, consulta: string) => {
  const a = document.createElement('a');
  a.href = base + encodeURIComponent(consulta);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/**
 * Copiar sem mentir. O `clipboard` só existe em contexto seguro e pode ser
 * recusado; o textarea é o caminho de reserva. Devolve `false` quando o
 * navegador não deixou — quem chama é que decide o aviso, para nunca dizer
 * "copiado" a quem não copiou.
 */
const copiarTexto = async (texto: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

// ------------------------------------------------------------------ módulo

export default function OmniDork() {
  const [keywords, setKeywords] = useState('');
  const [tipo, setTipo] = useState<Tipo>('all');
  const [download, setDownload] = useState(false);
  const [motor, setMotor] = useState<Motor>('google');
  const [ext, setExt] = useState<Extensao>('any');
  const [site, setSite] = useState('');
  const [avancado, setAvancado] = useState(true);
  const [categoria, setCategoria] = useState<'all' | Categoria>('all');
  const [fase, setFase] = useState<Fase | null>(null);
  const toast = useToast();

  const pecas = useMemo(
    () => montarPecas({ keywords, tipo, ext, site, download }),
    [keywords, tipo, ext, site, download],
  );
  const consulta = juntar(pecas);
  const motorActual = MOTORES.find((m) => m.id === motor) ?? MOTORES[0]!;
  const podePesquisar = consulta.trim().length > 0;
  const extManda = ext !== 'any';

  const lista = useMemo(
    () => DORKS.filter((d) => (categoria === 'all' || d.categoria === categoria) && (fase === null || d.fase === fase)),
    [categoria, fase],
  );

  const render = (modelo: string) =>
    modelo.replace('{alvo}', keywords.trim() || site.trim() || '{target}');

  const copiar = async (texto: string) => {
    const ok = await copiarTexto(texto);
    toast(ok ? 'ok' : 'err', ok ? 'Query copied.' : 'The browser refused the copy.');
  };

  const pesquisar = () => {
    if (!podePesquisar) return;
    abrirMotor(motorActual.base, consulta);
  };

  return (
    <div className="od-root">
      {/* ---------------------------------------------------------- cabeçalho */}
      <header className="od-head">
        <div className="od-kicker">OSINT QUERY MODULE</div>
        <h1 className="od-title">OmniDork Builder</h1>
        <p className="od-lead">
          Compose the query, read it as it is built, then hand it to the search
          engine. The request is made by your browser, on the engine&apos;s own
          site — nothing is sent to ARGOS and nothing is billed.
        </p>
        <div className="od-tags">
          <span className="od-tag">client-side</span>
          <span className="od-tag">zero server cost</span>
          <span className="od-tag">public sources only</span>
        </div>
      </header>

      {/* ------------------------------------------------------------ construtor */}
      <section className="od-panel" aria-label="Builder">
        <div className="od-panel-head">
          <span>Builder</span>
          <span className="od-grow" />
          <span className="od-badge">{motorActual.label}</span>
        </div>

        <div className="od-field">
          <label className="od-label" htmlFor="od-keywords">Search Keywords</label>
          <input
            id="od-keywords" className="od-input" type="text" value={keywords}
            placeholder="target name, domain or handle…" autoComplete="off"
            spellCheck={false} autoCapitalize="none" autoCorrect="off"
            onChange={(e) => setKeywords(e.target.value)}
          />
        </div>

        <div className="od-row">
          <div className="od-field">
            <label className="od-label" htmlFor="od-tipo">Content Type</label>
            <select id="od-tipo" className="od-input od-select" value={tipo} disabled={extManda}
              onChange={(e) => setTipo(e.target.value as Tipo)}>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="od-field">
            <label className="od-label" htmlFor="od-motor">Search Engine</label>
            <select id="od-motor" className="od-input od-select" value={motor}
              onChange={(e) => setMotor(e.target.value as Motor)}>
              {MOTORES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <label className="od-check" htmlFor="od-download">
          <input id="od-download" type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
          <span>Focus on Download Pages</span>
        </label>

        {/* ------------------------------------------ opções avançadas */}
        <div className="od-adv">
          <button
            className="od-adv-head" type="button"
            aria-expanded={avancado} aria-controls="od-adv-corpo"
            onClick={() => setAvancado((a) => !a)}
          >
            <Icon.chevronDown className={`od-caret${avancado ? ' od-caret-open' : ''}`} />
            <span>Advanced Options</span>
            <span className="od-grow" />
            {extManda && <span className="od-badge">filetype:{ext}</span>}
          </button>

          {avancado && (
            <div className="od-adv-corpo" id="od-adv-corpo">
              <div className="od-row">
                <div className="od-field">
                  <label className="od-label" htmlFor="od-ext">File Extension</label>
                  <select id="od-ext" className="od-input od-select" value={ext}
                    onChange={(e) => setExt(e.target.value as Extensao)}>
                    {EXTENSOES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </div>
                <div className="od-field">
                  <label className="od-label" htmlFor="od-site">Target Website</label>
                  <input
                    id="od-site" className="od-input" type="text" value={site}
                    placeholder="example.com" autoComplete="off" spellCheck={false}
                    autoCapitalize="none" autoCorrect="off"
                    onChange={(e) => setSite(e.target.value)}
                  />
                </div>
              </div>

              {extManda && (
                <p className="od-note">
                  File Extension overrides Content Type — both write the same
                  <code className="od-code"> filetype:</code> operator, and the
                  explicit format wins.
                </p>
              )}

              {/* ---------------------------------- caixa de output dinâmico */}
              <div className="od-out" aria-live="polite">
                <div className="od-out-head">
                  <span>QUERY</span>
                  <span className="od-grow" />
                  <span className="od-out-len">{consulta.length} ch</span>
                </div>
                <div className="od-out-body">
                  {pecas.length === 0 ? (
                    <span className="od-out-empty">
                      waiting for a target — type a keyword, a site, or pick a content type
                    </span>
                  ) : (
                    pecas.map((p, i) => (
                      <span className="od-part" key={`${i}-${p.op ?? 'kw'}`}>
                        {i > 0 && ' '}
                        {p.op && <span className="od-q-op">{p.op}:</span>}
                        <span className={p.op ? 'od-q-val' : 'od-q-key'}>{p.valor}</span>
                      </span>
                    ))
                  )}
                </div>
                {pecas.length > 0 && (
                  <div className="od-ops">
                    {pecas.map((p, i) => p.op !== null && (
                      <span className="od-op" key={`op-${i}`}>{p.op}:{p.valor.slice(0, 34)}</span>
                    ))}
                    {!pecas.some((p) => p.op !== null) && (
                      <span className="od-op od-op-plain">keywords only</span>
                    )}
                  </div>
                )}
              </div>

              {/* ------------------------------------------- acções */}
              <div className="od-actions">
                <motion.button
                  className="od-btn" type="button" onClick={() => copiar(consulta)} disabled={!podePesquisar}
                  whileHover={{ y: -1 }} whileTap={{ scale: 0.99 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                >
                  <Icon.copy /> Copy Query
                </motion.button>
                <motion.button
                  className="od-btn od-btn-main" type="button" onClick={pesquisar} disabled={!podePesquisar}
                  whileHover={{ y: -1 }} whileTap={{ scale: 0.99 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                >
                  <Icon.search /> Search
                </motion.button>
              </div>
              {!podePesquisar && (
                <p className="od-note">Nothing to search yet — the query box above is empty.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- feed */}
      <section className="od-panel od-feed" aria-label="Filters">
        <div className="od-panel-head">
          <span>Filters</span>
          <span className="od-grow" />
          <span className="od-badge">{lista.length} dorks</span>
        </div>

        <div className="od-filters">
          <div className="od-filter">
            <span className="od-label">Category</span>
            <div className="od-chips" role="group" aria-label="Category">
              {CATEGORIAS.map((c) => (
                <button
                  key={c.id} className="od-chip" type="button"
                  aria-pressed={categoria === c.id}
                  onClick={() => setCategoria(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="od-filter">
            <span className="od-label">Phase</span>
            <div className="od-chips" role="group" aria-label="Phase">
              {FASES.map((f) => (
                <button
                  key={f.id} className="od-chip" type="button"
                  aria-pressed={fase === f.id}
                  title="Click again to show every phase"
                  onClick={() => setFase((atual) => (atual === f.id ? null : f.id))}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="od-list">
          {lista.map((d) => {
            const q = render(d.modelo);
            return (
              <article className="od-item" key={d.id}>
                <div className="od-item-top">
                  <span className="od-item-name">{d.nome}</span>
                  <span className="od-item-tags">
                    <span className="od-tag">{ROTULO_CATEGORIA[d.categoria]}</span>
                    <span className="od-tag">{ROTULO_FASE[d.fase]}</span>
                  </span>
                </div>
                <code className="od-item-q">{q}</code>
                <div className="od-item-foot">
                  <span className="od-item-why">{d.porque}</span>
                  <span className="od-grow" />
                  <button
                    className="od-btn od-btn-sm" type="button"
                    onClick={() => { void copiar(q); }}
                  >
                    <Icon.copy /> Copy
                  </button>
                  <button
                    className="od-btn od-btn-sm od-btn-main" type="button"
                    onClick={() => abrirMotor(motorActual.base, q)}
                  >
                    <Icon.search /> Search
                  </button>
                </div>
              </article>
            );
          })}

          {lista.length === 0 && (
            <div className="od-empty">
              <b>No dork in this combination.</b>
              <span>Clear the phase, or switch back to All Categories.</span>
            </div>
          )}
        </div>
      </section>

      <p className="od-foot">
        Queries are opened directly on {motorActual.label} in a new tab. ARGOS
        neither sees nor stores what you search for here.
      </p>
    </div>
  );
}
