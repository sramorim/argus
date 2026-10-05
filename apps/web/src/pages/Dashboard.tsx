/**
 * Painel — o primeiro ecrã de quem entra.
 *
 * Mobile-first, e a ordem responde ao que a pessoa quer fazer nos primeiros
 * cinco segundos:
 *
 *   1. **Hero** — o que isto é, e o botão de começar. Um CTA, o principal.
 *   2. **Atalhos** — os quatro destinos de sempre, a um toque.
 *   3. **Ferramentas principais** — o que dá para investigar, não a
 *      tecnologia por trás. APIFY e OSINT Engine continuam a existir e a ser
 *      alcançáveis na lateral; não aparecem aqui como se fossem o produto.
 *   4. **Investigações recentes** — o trabalho a continuar, com dados reais.
 *   5. **Fontes e status** — as fontes que o produto consegue consultar e o
 *      estado em que cada uma está, lido de `GET /api/health`.
 *
 * A regra que atravessa este ecrã: **mostrar o estado real**. Se não há
 * sessões, diz que não há. Se a cota acabou, diz que acabou. O selo ONLINE só
 * aparece quando o servidor respondeu READY. Não se enche a página de
 * cartões a competir entre si para parecer mais cheio.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SVGProps } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { api, type ToolPublic, type Usage, type User, type LinhaSaude, type EstadoSaude } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, SearchInput, Skeleton, useToast } from '../components/ui';
import { GRUPOS, porGrupo, buscar, ATALHOS, NOME_PLANO } from '../ia';
import type { View } from './AppShell';

interface Resumo {
  sessoes: { id: string; title: string; seed: string; updated_at: string; seed_type?: string; node_count?: number; edge_count?: number }[];
  historico: { id: string; tool_id: string; created_at: string; bytes: number }[];
}

/**
 * O estado de uma fonte, nos quatro estados que o Design System admite.
 *
 * A sigla continua a ser a do servidor — o ecrã não a renomeia, traduz o
 * que ela quer dizer e mostra sempre cor **e** palavra. Uma fonte em
 * `DISABLED` é uma fonte desligada, não uma fonte com problema.
 */
const ESTADO_FONTE: Record<string, { chave: 'ok' | 'lim' | 'nc' | 'erro'; texto: string }> = {
  READY: { chave: 'ok', texto: 'ONLINE' },
  RATE_LIMITED: { chave: 'lim', texto: 'LIMITADO' },
  NOT_CONFIGURED: { chave: 'nc', texto: 'NÃO CONFIGURADO' },
  NOT_INSTALLED: { chave: 'nc', texto: 'NÃO INSTALADO' },
  MISSING_SECRET: { chave: 'nc', texto: 'NÃO CONFIGURADO' },
  ERROR: { chave: 'erro', texto: 'ERRO' },
  DISABLED: { chave: 'nc', texto: 'DESLIGADO' },
  INCOMPATIBLE: { chave: 'nc', texto: 'INCOMPATÍVEL' },
};

const estadoDe = (s: EstadoSaude | string) => ESTADO_FONTE[s] ?? { chave: 'nc' as const, texto: s };

/**
 * Uma linha por fonte consultável, a partir do que o servidor devolveu.
 *
 * Não é a lista de contas do utilizador — não há contas ligadas a esta
 * plataforma — é o que o ARGOS consegue ir buscar e em que estado está
 * agora. Se o servidor deixar de reportar uma fonte, ela desaparece daqui.
 */
function FontesStatus({ linhas, onVerTudo }: { linhas: LinhaSaude[] | null; onVerTudo: () => void }) {
  if (linhas === null) {
    return <Skeleton lines={2} />;
  }
  return (
    <>
      <div className="fontes-strip">
        {linhas.map((l) => {
          const e = estadoDe(l.status);
          return (
            <div className="fonte-pill" key={`${l.nome}-${l.status}`} title={`${l.nome} — ${l.healthCheck}`}>
              <span className="fonte-ico"><Icon.database /></span>
              <span className="ponto" data-e={e.chave} />
              <span className="fonte-txt">
                <span className="fonte-nome">{l.nome}</span>
                <span className="fonte-estado" data-e={e.chave}>{e.texto}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-sm btn-quiet" type="button" onClick={onVerTudo}>
          ver o estado do sistema
        </button>
      </div>
    </>
  );
}

export default function Dashboard({
  user, tools, usage, setView,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null; setView: (v: View) => void;
}) {
  const [q, setQ] = useState('');
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [saude, setSaude] = useState<{ linhas: LinhaSaude[]; geral: EstadoSaude } | null>(null);
  const [erro, setErro] = useState('');
  const toast = useToast();

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.investigations().then((r) => r.investigations).catch(() => []),
      api.history().then((r) => r.runs).catch(() => []),
      // O estado do sistema é real ou não é nada: se o pedido falhar, a secção
      // fica em branco com a mensagem do servidor em vez de mostrar "online".
      api.saude(false).then((r) => r.relatorio).catch(() => null),
    ]).then(([sessoes, hist, rel]) => {
      if (!vivo) return;
      setResumo({ sessoes: sessoes.slice(0, 4) as Resumo['sessoes'], historico: hist.slice(0, 5) });
      if (rel && Array.isArray(rel.providers)) {
        setSaude({
          geral: rel.estadoGeral,
          /*
           * Só as fontes remotas — o que o ARGUS vai buscar fora. As linhas de
           * CLI (SpiderFoot, Photon, GHunt…) e os actors do Apify também são
           * dependências reais, mas são a tecnologia por trás da ferramenta: o
           * painel mostra a finalidade, e o ecrã de Estado do Sistema mostra as
           * 23 linhas com o detalhe. Mostrar 18 pílulas aqui seria mostrar a
           * canalização em vez do produto.
           */
          linhas: rel.providers.filter((l) => l.tipo === 'api' || l.tipo === 'endpoint'),
        });
      }
    });
    return () => { vivo = false; };
  }, []);

  const restantes = usage ? Math.max(0, usage.daily - usage.today) : null;
  const encontrados = q.trim() ? buscar(tools, q) : tools;
  const geral = saude ? estadoDe(saude.geral) : null;

  /* As ferramentas que o utilizador vê primeiro: as que respondem a uma
     pergunta de presença pública. A escolha vem de `ATALHOS` — que é a
     ordem de utilidade já decidida no `ia.ts` — filtrada pelo que o plano
     dele abre. Nada entra aqui por estar no catálogo. */
  const principais = ATALHOS
    .map((a) => tools.find((t) => t.id === a.id))
    .filter((t): t is ToolPublic => !!t && t.lock !== 'locked')
    .slice(0, 4);

  const atalhosVista: { v: View; nome: string; icone: (p: Record<string, unknown>) => ReactElement }[] = [
    { v: { k: 'dashboard' }, nome: 'Painel', icone: Icon.grid },
    { v: { k: 'nova' }, nome: 'Nova investigação', icone: Icon.target },
    { v: { k: 'inv' }, nome: 'Investigações', icone: Icon.network },
    { v: { k: 'history' }, nome: 'Histórico', icone: Icon.history },
  ];

  return (
    <div className="page">
      {/* ---------- 1. hero: o que é isto e como começar ---------- */}
      <section className="hero-panel">
        <div className="hero-globo" aria-hidden>
          <GloboRede />
        </div>
        <div className="hero-panel-txt">
          <span className="hero-kicker">Sistema de inteligência de redes sociais</span>
          <h1 className="hero-titulo">
            Investigue.<br />
            Analise.<br />
            <span className="destaque">Conecte.</span>
          </h1>
          <p className="hero-sub">
            Dados abertos, múltiplas fontes, em um só lugar. Cada achado diz de que fonte veio,
            quando e com que confiança.
          </p>
          <div className="hero-estado">
            {geral ? (
              <>
                <span className="ponto" data-e={geral.chave} />
                <span className="micro">{geral.texto}</span>
                <span className="t-xs dim" style={{ letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--font)' }}>
                  {saude!.linhas.filter((l) => l.status === 'READY').length} de {saude!.linhas.length} fontes prontas
                </span>
              </>
            ) : (
              <span className="micro">A ler o estado do sistema…</span>
            )}
          </div>
        </div>
        <div className="hero-cta">
          <motion.button
            className="btn btn-primary"
            type="button"
            onClick={() => setView({ k: 'nova' })}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          >
            <Icon.target /> NOVA INVESTIGAÇÃO
          </motion.button>
          <div className="hero-cta-sec">
            <button className="btn" type="button" onClick={() => setView({ k: 'inv' })}>
              {resumo ? resumo.sessoes.length : 0} investigações
            </button>
            <button className="btn" type="button" onClick={() => document.getElementById('ferramentas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              Ferramentas
            </button>
          </div>
        </div>
      </section>

      {/* ---------- 2. atalhos ---------- */}
      <section>
        <div className="regra"><span className="micro">Atalhos</span></div>
        <div className="atalho-linha">
          {atalhosVista.map((a) => (
            <button key={a.v.k} className="atalho-mini" type="button" onClick={() => setView(a.v)}>
              <a.icone />
              <span>{a.nome}</span>
            </button>
          ))}
        </div>
      </section>

      {erro && <Note kind="err">{erro}</Note>}

      {/* ---------- 3. ferramentas principais ---------- */}
      <section id="ferramentas">
        <div className="regra"><span className="micro">Ferramentas principais</span></div>
        <div className="grid grid-2">
          {principais.map((t) => <CardFerramenta key={t.id} t={t} setView={setView} />)}
        </div>
        <p className="t-sm muted" style={{ marginTop: 14, lineHeight: 1.6 }}>
          {tools.length} ferramentas registadas, todas testadas com alvos reais. As que dependem
          de um serviço externo continuam acessíveis na lateral.
        </p>
      </section>

      {/* ---------- 4. o trabalho a continuar ---------- */}
      <section>
        <div className="regra">
          <span className="micro">Investigações recentes</span>
          <span className="grow" />
          <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'inv' })}>ver todas</button>
        </div>
        {!resumo ? (
          <Skeleton lines={3} />
        ) : resumo.sessoes.length === 0 ? (
          <div className="card">
            <Empty icon={Icon.network} title="Ainda não investigaste nada"
              action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>começar a primeira</button>}>
              O resultado fica guardado com o grafo inteiro, e relê-lo não gasta cota.
            </Empty>
          </div>
        ) : (
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {resumo.sessoes.map((s) => (
              <button
                key={s.id}
                className="invest-card"
                type="button"
                onClick={() => setView({ k: 'inv', id: s.id })}
              >
                <span className="invest-ico"><Icon.network /></span>
                <span className="invest-txt">
                  <span className="invest-alvo">{s.seed || s.title}</span>
                  <span className="invest-meta">
                    {s.seed_type ?? 'alvo'} · {s.node_count ?? 0} nós · {s.edge_count ?? 0} ligações ·{' '}
                    {new Date(s.updated_at).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <Icon.chevronRight width={16} height={16} style={{ color: 'var(--t-4)' }} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 5. fontes e status ---------- */}
      <section>
        <div className="regra"><span className="micro">Fontes e status</span></div>
        <p className="t-sm muted" style={{ marginBottom: 12, lineHeight: 1.6 }}>
          As fontes que o ARGOS consulta lá fora agora. O estado é o que o servidor respondeu —
          nada aqui é assumido, e nada é uma conta tua.
        </p>
        <FontesStatus linhas={saude?.linhas ?? null} onVerTudo={() => setView({ k: 'health' })} />
      </section>

      {/* ---------- 6. estado real da conta ---------- */}
      <section>
        <div className="regra"><span className="micro">A tua conta</span></div>
        <div className="grid grid-4">
          <StatCard
            rotulo="Cota de hoje"
            valor={`${usage?.today ?? 0}/${usage?.daily ?? 0}`}
            nota={restantes === 0 ? 'esgotada — volta amanhã' : `${restantes ?? 0} execuções restantes`}
            estado={restantes === 0 ? 'warn' : 'ok'}
          />
          <StatCard rotulo="Plano" valor={NOME_PLANO[user.plan]} nota="plano actual" />
          <StatCard
            rotulo="Investigações"
            valor={resumo ? String(resumo.sessoes.length) : '—'}
            nota="guardadas com grafo"
          />
          <StatCard
            rotulo="Execuções"
            valor={resumo ? String(resumo.historico.length) : '—'}
            nota="no histórico"
          />
        </div>
      </section>

      {/* ---------- 7. o construtor de dorks ---------- */}
      {/* O OmniDork não é uma ferramenta do catálogo — não há servidor que o
          execute — por isso não entra na grelha nem na busca: aparece uma
          vez, como módulo próprio, e abre na mesma janela de sempre. */}
      <section className="od-entry" aria-label="OmniDork Builder">
        <div className="od-entry-txt">
          <span className="od-kicker">Construtor de consultas</span>
          <div className="od-entry-title">OmniDork Builder</div>
          <p className="od-entry-sub">
            Monta a dork com <code className="od-code">filetype:</code>,{' '}
            <code className="od-code">site:</code> e <code className="od-code">inurl:</code>{' '}
            e entrega-a ao motor de busca num separador novo. Corre no teu browser — sem custo
            de servidor e sem consulta a sair daqui.
          </p>
        </div>
        <motion.button
          className="od-btn od-btn-main"
          type="button"
          onClick={() => setView({ k: 'tool', id: 'omnidork' })}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 420, damping: 24 }}
        >
          <Icon.search /> abrir o construtor
        </motion.button>
      </section>

      {/* ---------- 8. catálogo completo, agrupado ---------- */}
      <section>
        <div className="regra"><span className="micro">Todas as ferramentas</span></div>
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Procurar ferramenta, alvo ou etiqueta… (ex.: username, domínio, telefone)"
          />
        </div>

        {q.trim() ? (
          encontrados.length === 0 ? (
            <div className="card">
              <Empty
                icon={Icon.search}
                title="Nada encontrado"
                action={<button className="btn btn-quiet btn-sm" type="button" onClick={() => setQ('')}>limpar pesquisa</button>}
              >
                Não há ferramenta que corresponda a “{q}”. Tenta o nome do alvo (domínio,
                IP, username…) ou o que procuras.
              </Empty>
            </div>
          ) : (
            <div className="grid grid-3">
              {encontrados.map((t) => <CardFerramenta key={t.id} t={t} setView={setView} />)}
            </div>
          )
        ) : (
          <div className="grid grid-2">
            {GRUPOS.map((g) => {
              const lista = porGrupo(tools, g.id);
              if (!lista.length) return null;
              const Ico = g.icon;
              return (
                <article className="card layer-card" key={g.id}>
                  <div className="layer-card-head">
                    <span className="layer-card-ico"><Ico /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="card-title">{g.nome}</div>
                      <div className="card-sub">{g.resumo}</div>
                    </div>
                    <span className="layer-card-n">{lista.length}</span>
                  </div>
                  <div className="layer-list">
                    {lista.map((t) => (
                      <button
                        key={t.id}
                        className="nav-item"
                        type="button"
                        aria-current={false}
                        onClick={() => setView({ k: 'tool', id: t.id })}
                      >
                        <span className="nav-label-txt">{t.name}</span>
                        {t.lock === 'locked'
                          ? <span className="tag tag-pro">PRO</span>
                          : <Icon.chevronRight width={14} height={14} style={{ color: 'var(--t-4)' }} />}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/*
        Sem rodapé aqui de propósito: o copyright e os canais já estão no pé da
        lateral e na barra de tarefas, e eram a terceira cópia da mesma linha
        sempre que alguém abria o painel.
      */}
    </div>
  );
}

/**
 * A rede do hero.
 *
 * É SVG desenhado à mão com os nós de um grafo real — não é uma imagem
 * descarregada, não pesa em nada e é a mesma linguagem do grafo que a
 * investigação produz. Nenhum valor é inventado: é só o motivo.
 */
function GloboRede() {
  const nos = [
    [50, 18], [78, 30], [24, 34], [62, 50], [34, 58], [82, 62], [50, 80], [16, 74], [86, 44],
  ];
  const arestas: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [2, 4], [3, 4], [3, 5], [4, 6], [5, 6],
    [2, 7], [1, 8], [3, 8], [4, 7], [5, 8],
  ];
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden focusable="false">
      <circle cx="50" cy="50" r="47" stroke="currentColor" strokeWidth="0.6" />
      <ellipse cx="50" cy="50" rx="20" ry="47" stroke="currentColor" strokeWidth="0.5" />
      <ellipse cx="50" cy="50" rx="35" ry="47" stroke="currentColor" strokeWidth="0.5" />
      <path d="M3 50h94M11 26h78M11 74h78" stroke="currentColor" strokeWidth="0.5" />
      {arestas.map(([a, b], i) => (
        <line key={i} x1={nos[a][0]} y1={nos[a][1]} x2={nos[b][0]} y2={nos[b][1]}
          stroke="currentColor" strokeWidth="0.7" />
      ))}
      {nos.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 3 ? 2.6 : 1.8} fill="currentColor" />
      ))}
    </svg>
  );
}

function CardFerramenta({ t, setView }: { t: ToolPublic; setView: (v: View) => void }) {
  /*
   * O selo PRO não é decoração: é o `lock` que o servidor devolveu. Só há
   * dois estados — aberta (ícone azul) ou trancada (selo PRO) — porque são
   * os únicos que os dados sustentam. Não há selo NOVO nem DEMO: nada no
   * catálogo diz o que é novo ou o que é demonstração, e um selo inventado
   * é uma promessa inventada.
   */
  return (
    <button
      className="tool-card"
      type="button"
      data-locked={t.lock === 'locked'}
      onClick={() => setView({ k: 'tool', id: t.id })}
    >
      {t.lock === 'locked' && <span className="tag tag-pro tool-badge">PRO</span>}
      <div className="tool-top">
        <span className="tool-glyph">
          <Icon.network />
        </span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="tool-name">{t.name}</span>
        </span>
      </div>
      <div className="tool-sum">{t.summary}</div>
      <span className="tool-chevron"><Icon.chevronRight /></span>
    </button>
  );
}

function StatCard({
  rotulo, valor, nota, estado,
}: {
  rotulo: string; valor: string; nota: string; estado?: 'ok' | 'warn';
}) {
  const numRef = useRef<HTMLSpanElement>(null);
  const valorNum = Number(valor.split('/')[0]) || 0;
  const cor = estado === 'warn' ? 'var(--aviso)' : estado === 'ok' ? 'var(--blue)' : 'var(--t-3)';
  const suave = useReducedMotion();

  /* O número começa a zero no DOM de propósito. Antes escrevia-se já o valor
     final e a animação punha-o a zero um instante depois: o número aparecia,
     era reposto a 0 e voltava a contar — via-se isso duas vezes.

     A contagem é feita à mão (requestAnimationFrame) em vez de com uma
     biblioteca de animação: eram ~25 KB comprimidos para animar quatro
     números. O mesmo efeito cabe em doze linhas. */
  useEffect(() => {
    const el = numRef.current;
    if (!el) return;
    if (suave) { el.textContent = String(valorNum); return; }
    const DURACAO = 1100;
    let quadro = 0;
    const inicio = performance.now();
    el.textContent = '0';
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / DURACAO);
      // power2.out — a mesma curva que a biblioteca usava, em quatro linhas.
      const eased = 1 - Math.pow(1 - t, 2);
      el.textContent = String(Math.round(eased * valorNum));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => { if (quadro) cancelAnimationFrame(quadro); };
  }, [valorNum, suave]);

  return (
    <div className="card" style={{ padding: '14px' }}>
      <span className="micro">{rotulo}</span>
      <div className="v" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.15, color: cor, marginTop: 8, fontFamily: 'var(--font-display)' }}>
        <span ref={numRef} className="num">0</span>{valor.includes('/') ? `/${valor.split('/')[1]}` : ''}
      </div>
      <div className="t-xs dim" style={{ marginTop: 3 }}>{nota}</div>
    </div>
  );
}
