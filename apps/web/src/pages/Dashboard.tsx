/**
 * Painel — primeiro ecrã de quem entra (redesenho 2026-10, azul-marinho).
 *
 * Duas colunas no ecrã largo: à esquerda o banner, os quatro indicadores, o
 * mapa de conexões e os perfis analisados; à direita a atividade recente e as
 * fontes monitoradas. No telemóvel a ordem é a de quem tem o polegar: busca,
 * atalhos, resumo de hoje, mapa, atividade.
 *
 * Regra que não se negoceia: **todos os números vêm do backend** (`usage`,
 * `/api/health`, `/api/investigations`, `/api/historico`). Os minigráficos são
 * contagens por dia dos últimos 7 dias, feitas sobre esses mesmos registos;
 * não há percentagens de crescimento porque o servidor não guarda séries que
 * as sustentem. Enquanto carrega mostra "—"; vazio mostra-se vazio.
 */
import { useEffect, useState } from 'react';
import type { FormEvent, ReactElement, SVGProps } from 'react';
import {
  api, type ToolPublic, type Usage, type User, type LinhaSaude, type EstadoSaude,
  type Investigation, type InvestigationDetail,
} from '../api';
import { Icon, CATEGORY_ICON } from '../components/Icons';
import { Empty, SearchInput, Skeleton } from '../components/ui';
import MapaConexoes from '../components/MapaConexoes';
import Globo from '../components/Globo';
import { GRUPOS, porGrupo, buscar, NOME_PLANO, ICONE_FERRAMENTA } from '../ia';
import type { View } from './AppShell';

interface Execucao { id: string; tool_id: string; input: string; created_at: string; bytes: number }
type Ico = (p: SVGProps<SVGSVGElement>) => ReactElement;

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

/** "há 5 minutos", "há 2 horas", "ontem", ou a data — pelo relógio do aparelho. */
function haQuanto(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'agora mesmo';
  if (s < 3600) { const m = Math.floor(s / 60); return `há ${m} ${m === 1 ? 'minuto' : 'minutos'}`; }
  if (s < 86400) { const h = Math.floor(s / 3600); return `há ${h} ${h === 1 ? 'hora' : 'horas'}`; }
  if (s < 172800) return 'ontem';
  return new Date(t).toLocaleDateString('pt-BR');
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O alvo de uma execução: o primeiro valor de texto do input guardado. */
function alvoDe(input: string): string {
  try {
    const o = JSON.parse(input) as Record<string, unknown>;
    const v = Object.values(o).find((x) => typeof x === 'string' && x.trim());
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

/** Soma por dia dos últimos `dias` dias (o último é hoje), a partir de registos reais. */
function porDia(itens: { quando: string; peso?: number }[], dias = 7): number[] {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const out = Array<number>(dias).fill(0);
  for (const it of itens) {
    const t = Date.parse(it.quando);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const i = dias - 1 - Math.round((hoje.getTime() - d.getTime()) / 86400000);
    if (i >= 0 && i < dias) out[i] += it.peso ?? 1;
  }
  return out;
}

/** Minigráfico de linha. Sem dados (tudo zero) não desenha nada. */
function Linha({ valores }: { valores: number[] }) {
  const max = Math.max(...valores);
  if (!(max > 0)) return null;
  const w = 84, h = 30;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h} Z`} className="spark-area" />
      <path d={d} className="spark-linha" />
    </svg>
  );
}

interface Evento { chave: string; quando: string; titulo: string; alvo: string; tom: string; icone: Ico; abrir: View }

/** Tom (cor) do ícone da atividade, pela categoria real da ferramenta. */
const TOM_CATEGORIA: Record<string, string> = {
  pessoa: 'azul', web: 'roxo', infra: 'ciano', ameaca: 'vermelho', arquivo: 'verde', dev: 'roxo', financeiro: 'ambar',
};
const ICONE_CATEGORIA: Record<string, Ico> = {
  pessoa: Icon.user, web: Icon.globe, infra: Icon.server, ameaca: Icon.shield, arquivo: Icon.file, financeiro: Icon.coins,
};

export default function Dashboard({
  user, tools, usage, setView, onBusca,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null; setView: (v: View) => void;
  /** Abre a busca global (Ctrl/⌘+K) do shell. */
  onBusca?: () => void;
}) {
  const [q, setQ] = useState('');
  const [sessoes, setSessoes] = useState<Investigation[] | null>(null);
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null);
  const [detalhe, setDetalhe] = useState<InvestigationDetail | null | 'vazio'>(null);
  const [saude, setSaude] = useState<{ linhas: LinhaSaude[]; geral: EstadoSaude } | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.investigations().then((r) => r.investigations).catch(() => [] as Investigation[]),
      api.history().then((r) => r.runs).catch(() => [] as Execucao[]),
      api.saude(false).then((r) => r.relatorio).catch(() => null),
    ]).then(([inv, hist, rel]) => {
      if (!vivo) return;
      const lista = Array.isArray(inv) ? inv : [];
      setSessoes(lista);
      setExecucoes(Array.isArray(hist) ? hist : []);
      if (rel && Array.isArray(rel.providers)) {
        setSaude({
          geral: rel.estadoGeral,
          linhas: rel.providers.filter((l) => l.tipo === 'api' || l.tipo === 'endpoint'),
        });
      }
      // O mapa é o da sessão mais recente.
      const ultima = [...lista].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
      if (!ultima) { setDetalhe('vazio'); return; }
      api.investigation(ultima.id)
        .then((d) => { if (vivo) setDetalhe(d && Array.isArray(d.nodes) && d.nodes.length ? d : 'vazio'); })
        .catch(() => { if (vivo) setDetalhe('vazio'); });
    });
    return () => { vivo = false; };
  }, []);

  const encontrados = q.trim() ? buscar(tools, q) : tools;
  const geral = saude ? estadoDe(saude.geral) : null;
  const prontas = saude?.linhas.filter((l) => l.status === 'READY').length ?? 0;
  const entidades = sessoes?.reduce((s, x) => s + (x.node_count ?? 0), 0) ?? null;
  const ferramenta = (id: string) => tools.find((t) => t.id === id);
  const ultimaSessao = detalhe && detalhe !== 'vazio' ? detalhe.investigation : null;

  const serieExec = porDia((execucoes ?? []).map((r) => ({ quando: r.created_at })));
  const serieSess = porDia((sessoes ?? []).map((s) => ({ quando: s.created_at })));
  const serieEnt = porDia((sessoes ?? []).map((s) => ({ quando: s.created_at, peso: s.node_count ?? 0 })));

  const eventos: Evento[] | null = sessoes && execucoes
    ? [
      ...execucoes.map((r): Evento => {
        const t = ferramenta(r.tool_id);
        const cat = t?.category ?? '';
        return {
          chave: `r:${r.id}`, quando: r.created_at, titulo: t?.name ?? r.tool_id,
          alvo: alvoDe(r.input), tom: TOM_CATEGORIA[cat] ?? 'azul',
          icone: ICONE_CATEGORIA[cat] ?? Icon.activity, abrir: { k: 'history' },
        };
      }),
      ...sessoes.map((s): Evento => ({
        chave: `s:${s.id}`, quando: s.updated_at, titulo: 'Sessão de investigação guardada',
        alvo: `${s.seed || s.title} · ${plural(s.node_count ?? 0, 'nó', 'nós')} · ${plural(s.edge_count ?? 0, 'ligação', 'ligações')}`,
        tom: 'azul', icone: Icon.network, abrir: { k: 'inv', id: s.id },
      })),
    ].sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando)).slice(0, 5)
    : null;

  /* Os quatro caminhos do banner e dos atalhos do telemóvel — todos destinos reais. */
  const caminhos: { id: string; titulo: string; sub: string; curto: string; icone: Ico; v: View }[] = [
    { id: 'coleta', titulo: 'Coleta', sub: 'Fontes abertas', curto: 'Nova investigação', icone: Icon.investigar, v: { k: 'nova' } },
    { id: 'analise', titulo: 'Análise', sub: 'Cruzamento de fontes', curto: 'Perfil unificado', icone: Icon.perfilCartao, v: { k: 'perfil' } },
    { id: 'conexoes', titulo: 'Conexões', sub: 'Mapeamento visual', curto: 'Ver conexões', icone: Icon.conexoes, v: { k: 'inv' } },
    { id: 'relatorios', titulo: 'Relatórios', sub: 'Resultados claros', curto: 'Histórico', icone: Icon.history, v: { k: 'history' } },
  ];

  const indicadores = [
    {
      id: 'exec', v: usage ? String(usage.today) : '—', l: 'Execuções hoje', icone: Icon.activity,
      sub: usage ? <>{`${usage.today}/${usage.daily}`} da cota</> : null, serie: serieExec, abrir: { k: 'history' } as View,
    },
    {
      id: 'fontes', v: saude ? String(prontas) : '—', l: 'Fontes ativas', icone: Icon.server,
      sub: saude ? <><span className="ponto" data-e={prontas ? 'ok' : 'nc'} /> de {saude.linhas.length} online</> : null,
      serie: null, abrir: { k: 'health' } as View,
    },
    {
      id: 'ent', v: entidades === null ? '—' : String(entidades), l: 'Entidades mapeadas', icone: Icon.layers,
      sub: sessoes ? <>em {sessoes.length} {sessoes.length === 1 ? 'sessão' : 'sessões'}</> : null, serie: serieEnt, abrir: { k: 'perfil' } as View,
    },
    {
      id: 'sess', v: sessoes ? String(sessoes.length) : '—', l: 'Sessões guardadas', icone: Icon.network,
      sub: <>últimos 7 dias</>, serie: serieSess, abrir: { k: 'inv' } as View,
    },
  ];

  /* A busca do topo procura um ALVO: abre a Nova investigação já com ele escrito. */
  const [alvo, setAlvo] = useState('');
  const buscarAlvo = (e: FormEvent) => {
    e.preventDefault();
    const v = alvo.trim();
    if (!v) return;
    try { sessionStorage.setItem('argos:initial-target', v); } catch { /* sem storage: abre vazio */ }
    setAlvo('');
    setView({ k: 'nova' });
  };

  return (
    <div className="page dash">
      {/* ---------- Telemóvel: busca no topo ---------- */}
      {onBusca && (
        <form className="dash-busca" role="search" onSubmit={buscarAlvo}>
          <label htmlFor="dash-alvo" className="sr-only">Buscar alvo: pessoa, e-mail, telefone ou username</label>
          <Icon.search />
          <input id="dash-alvo" type="search" value={alvo} onChange={(e) => setAlvo(e.target.value)}
            placeholder="Nome, e-mail, telefone, @user" autoComplete="off" enterKeyHint="search" />
          <button type="submit" className="dash-busca-ir" aria-label="Investigar este alvo"><Icon.arrowRight /></button>
        </form>
      )}

      <div className="dash-layout">
        <div className="dash-main">
          {/* ---------- Banner ---------- */}
          <section className="dash-hero" aria-label="ARGOS">
            <Globo />
            <div className="dash-hero-txt">
              <p className="dash-kicker">ARGOS · Plano {NOME_PLANO[user.plan]}</p>
              <h1 className="dash-titulo">Informação<br />Revela <span>Poder</span></h1>
              <p className="dash-lead">Transforme dados públicos em inteligência real.</p>
              <p className="dash-estado">
                {geral ? (
                  <><span className="ponto" data-e={geral.chave} /> {geral.texto} · {prontas}/{saude!.linhas.length} fontes prontas</>
                ) : 'A ler o estado do sistema…'}
              </p>
            </div>
            <nav className="dash-pilares" aria-label="Caminhos">
              {caminhos.map((c) => (
                <button key={c.id} className="dash-pilar" type="button" onClick={() => setView(c.v)}>
                  <span className="dash-pilar-ico"><c.icone /></span>
                  <span className="dash-pilar-txt">
                    <span className="dash-pilar-t">{c.titulo}</span>
                    <span className="dash-pilar-s">{c.sub}</span>
                  </span>
                </button>
              ))}
            </nav>
          </section>

          {/* ---------- Telemóvel: atalhos ---------- */}
          <nav className="dash-acoes" aria-label="Atalhos">
            {caminhos.map((c) => (
              <button key={c.id} className="dash-acao" type="button" onClick={() => setView(c.v)}>
                <c.icone />
                <span>{c.curto}</span>
              </button>
            ))}
          </nav>

          {/* ---------- Indicadores reais ---------- */}
          <section className="dash-resumo" aria-label="Resumo de hoje">
            <h2 className="dash-resumo-t">Resumo de Hoje</h2>
            <div className="dash-stats">
              {indicadores.map((s) => (
                <button key={s.id} className="stat-card" type="button" onClick={() => setView(s.abrir)}>
                  <span className="stat-v num">{s.v}</span>
                  <span className="stat-l">{s.l}</span>
                  {s.sub && <span className="stat-sub">{s.sub}</span>}
                  {s.serie ? <Linha valores={s.serie} /> : <span className="stat-ico"><s.icone /></span>}
                </button>
              ))}
            </div>
          </section>

          {/* ---------- Mapa de conexões ---------- */}
          <section className="card dash-card dash-mapa" aria-label="Mapa de conexões">
            <header className="dash-card-head">
              <span className="dash-card-ico"><Icon.network /></span>
              <div className="grow">
                <h2 className="card-title">Mapa de Conexões</h2>
                <p className="card-sub">
                  {ultimaSessao
                    ? <>Última sessão: <strong>{ultimaSessao.seed || ultimaSessao.title}</strong> · {haQuanto(ultimaSessao.updated_at)}</>
                    : 'Visualize relações entre o alvo e o que as fontes públicas devolveram.'}
                </p>
              </div>
              {ultimaSessao && (
                <button className="icon-btn dash-card-acao" type="button" aria-label="Abrir o grafo completo"
                  title="Abrir o grafo completo" onClick={() => setView({ k: 'inv', id: ultimaSessao.id })}>
                  <Icon.expand />
                </button>
              )}
            </header>
            {detalhe === null ? (
              <Skeleton lines={4} />
            ) : detalhe === 'vazio' ? (
              <Empty icon={Icon.network} title="Sem grafo para mostrar"
                action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>Nova investigação</button>}>
                O mapa aparece aqui depois da primeira investigação guardada.
              </Empty>
            ) : (
              <MapaConexoes detalhe={detalhe} />
            )}
          </section>

          {/* ---------- Perfis analisados ---------- */}
          <section className="card dash-card dash-perfis" aria-label="Perfis analisados">
            <header className="dash-card-head">
              <h2 className="card-title grow">Perfis Analisados</h2>
              <button className="dash-ver" type="button" onClick={() => setView({ k: 'inv' })}>Ver todos <Icon.arrowRight /></button>
            </header>
            {!sessoes ? (
              <Skeleton lines={3} />
            ) : sessoes.length === 0 ? (
              <Empty icon={Icon.user} title="Ainda não investigaste nada"
                action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>começar a primeira</button>}>
                O resultado fica guardado com o grafo inteiro, e relê-lo não gasta cota.
              </Empty>
            ) : (
              <div className="perfis">
                {sessoes.slice(0, 6).map((s) => (
                  <button key={s.id} className="invest-card" type="button" onClick={() => setView({ k: 'inv', id: s.id })}>
                    <span className="invest-ico">{(s.seed || s.title || '?').replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
                    <span className="invest-txt">
                      <span className="invest-alvo">{s.seed || s.title}</span>
                      <span className="invest-meta">
                        <span className="tag">{s.seed_type ?? 'alvo'}</span> {plural(s.node_count ?? 0, 'nó', 'nós')} · {haQuanto(s.updated_at)}
                      </span>
                    </span>
                    <Icon.chevronRight width={16} height={16} style={{ color: 'var(--t-4)' }} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="dash-side">
          {/* ---------- Atividade recente ---------- */}
          <section className="card dash-card dash-atividade" aria-label="Atividade recente">
            <header className="dash-card-head">
              <h2 className="card-title grow">Atividade Recente</h2>
              <button className="dash-ver" type="button" onClick={() => setView({ k: 'history' })}>Ver todas <Icon.arrowRight /></button>
            </header>
            {!eventos ? (
              <Skeleton lines={4} />
            ) : eventos.length === 0 ? (
              <Empty icon={Icon.history} title="Nada ainda">
                Cada execução e cada investigação fica aqui, com data e alvo.
              </Empty>
            ) : (
              <ul className="feed">
                {eventos.map((e) => (
                  <li key={e.chave}>
                    <button className="feed-item" type="button" data-tom={e.tom} onClick={() => setView(e.abrir)}>
                      <span className="feed-ico"><e.icone /></span>
                      <span className="feed-txt">
                        <span className="feed-titulo">{e.titulo}</span>
                        {e.alvo && <span className="feed-alvo">{e.alvo}</span>}
                        <span className="feed-quando">{haQuanto(e.quando)}</span>
                      </span>
                      <Icon.chevronRight className="feed-seta" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- Fontes monitoradas ---------- */}
          <section className="card dash-card dash-fontes" aria-label="Fontes monitoradas">
            <header className="dash-card-head">
              <h2 className="card-title grow">Fontes Monitoradas</h2>
              <button className="dash-ver" type="button" onClick={() => setView({ k: 'health' })}>Ver todas <Icon.arrowRight /></button>
            </header>
            {!saude ? (
              <Skeleton lines={4} />
            ) : saude.linhas.length === 0 ? (
              <p className="t-sm dim">O servidor não declarou fontes externas.</p>
            ) : (
              <ul className="fontes">
                {saude.linhas.slice(0, 6).map((l) => {
                  const e = estadoDe(l.status);
                  const I = l.tipo === 'api' ? Icon.database : Icon.globe;
                  return (
                    <li key={l.nome + l.modulo} className="fonte">
                      <span className="fonte-ico"><I /></span>
                      <span className="fonte-nome">{l.nome}</span>
                      <span className="fonte-estado" data-e={e.chave}><span className="ponto" data-e={e.chave} /> {e.texto}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* ---------- Ferramentas ---------- */}
      <section aria-label="Ferramentas" className="dash-ferramentas">
        <div className="regra"><span className="micro">Ferramentas</span></div>
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Procurar ferramenta… (ex.: username, domínio, telefone)"
          />
        </div>
        {q.trim() ? (
          encontrados.length === 0 ? (
            <div className="card">
              <Empty icon={Icon.search} title="Nada encontrado"
                action={<button className="btn btn-quiet btn-sm" type="button" onClick={() => setQ('')}>limpar pesquisa</button>}>
                Não há ferramenta para “{q}”.
              </Empty>
            </div>
          ) : (
            <div className="grid grid-3">
              {encontrados.map((t) => {
                const Cat = ICONE_FERRAMENTA[t.id] ?? CATEGORY_ICON[t.category] ?? Icon.grid;
                return (
                <button key={t.id} className="tool-card" type="button"
                  data-locked={t.lock === 'locked'}
                  onClick={() => setView({ k: 'tool', id: t.id })}>
                  {t.lock === 'locked' && <span className="tag tag-pro tool-badge">PRO</span>}
                  <div className="tool-top">
                    <span className="tool-glyph"><Cat /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="tool-name">{t.name}</span>
                    </span>
                  </div>
                  <div className="tool-sum">{t.summary}</div>
                  <span className="tool-chevron"><Icon.chevronRight /></span>
                </button>
                );
              })}
            </div>
          )
        ) : (
          <div className="grid grid-3">
            {GRUPOS.map((g) => {
              const lista = porGrupo(tools, g.id);
              if (!lista.length) return null;
              const G = g.icon;
              return (
                <article className="card layer-card" key={g.id}>
                  <div className="layer-card-head">
                    <span className="layer-card-ico"><G /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="card-title">{g.nome}</div>
                      <div className="card-sub">{g.resumo}</div>
                    </div>
                    <span className="layer-card-n">{lista.length}</span>
                  </div>
                  <div className="layer-list">
                    {lista.map((t) => (
                      <button key={t.id} className="nav-item" type="button"
                        aria-current={false}
                        onClick={() => setView({ k: 'tool', id: t.id })}>
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
    </div>
  );
}
