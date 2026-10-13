/**
 * Painel — primeiro ecrã de quem entra (redesenho 2026-10, azul-marinho).
 *
 * Ordem: ação principal + verificação rápida → quatro indicadores reais →
 * mapa de conexões da última sessão e atividade recente lado a lado →
 * perfis analisados e fontes monitoradas → ferramentas por grupo.
 *
 * Regra que não se negoceia: **todos os números vêm do backend** (`usage`,
 * `/api/health`, `/api/investigations`, `/api/historico`). Não há tendências,
 * percentagens de crescimento nem gráficos de linha porque o servidor não
 * guarda séries — inventá-los seria mentir. Enquanto carrega mostra "—";
 * vazio mostra-se vazio.
 */
import { useEffect, useState } from 'react';
import {
  api, type ToolPublic, type Usage, type User, type LinhaSaude, type EstadoSaude,
  type Investigation, type InvestigationDetail,
} from '../api';
import { Icon, CATEGORY_ICON } from '../components/Icons';
import { Empty, SearchInput, Skeleton } from '../components/ui';
import MapaConexoes from '../components/MapaConexoes';
import { GRUPOS, porGrupo, buscar, ATALHOS, NOME_PLANO } from '../ia';
import type { View } from './AppShell';

interface Execucao { id: string; tool_id: string; input: string; created_at: string; bytes: number }

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

/** "há 5 min", "há 2 h", "ontem", ou a data — a partir do relógio do aparelho. */
function haQuanto(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  return new Date(t).toLocaleDateString('pt-BR');
}

/** O alvo de uma execução: o primeiro valor de texto do input guardado. */
function alvoDe(input: string): string {
  try {
    const o = JSON.parse(input) as Record<string, unknown>;
    const v = Object.values(o).find((x) => typeof x === 'string' && x.trim());
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

interface Evento { chave: string; quando: string; titulo: string; alvo: string; tipo: 'exec' | 'sessao'; abrir: View }

export default function Dashboard({
  user, tools, usage, setView, onBusca,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null; setView: (v: View) => void;
  /** Abre a busca global (Ctrl/⌘+K) do shell. */
  onBusca?: () => void;
}) {
  const [q, setQ] = useState('');
  const [alvo, setAlvo] = useState('');
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
      // O mapa é o da sessão mais recente — a lista já vem ordenada pelo servidor.
      const ultima = [...lista].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
      if (!ultima) { setDetalhe('vazio'); return; }
      api.investigation(ultima.id)
        .then((d) => { if (vivo) setDetalhe(d && Array.isArray(d.nodes) && d.nodes.length ? d : 'vazio'); })
        .catch(() => { if (vivo) setDetalhe('vazio'); });
    });
    return () => { vivo = false; };
  }, []);

  const restantes = usage ? Math.max(0, usage.daily - usage.today) : null;
  const encontrados = q.trim() ? buscar(tools, q) : tools;
  const geral = saude ? estadoDe(saude.geral) : null;
  const prontas = saude?.linhas.filter((l) => l.status === 'READY').length ?? 0;
  const entidades = sessoes?.reduce((s, x) => s + (x.node_count ?? 0), 0) ?? null;
  const nomeDe = (id: string) => tools.find((t) => t.id === id)?.name ?? id;

  const acoes = ATALHOS
    .map((a) => ({ a, t: tools.find((t) => t.id === a.id) }))
    .filter((x) => !!x.t && x.t.lock !== 'locked')
    .slice(0, 4);

  const eventos: Evento[] | null = sessoes && execucoes
    ? [
      ...execucoes.map((r): Evento => ({
        chave: `r:${r.id}`, quando: r.created_at, titulo: nomeDe(r.tool_id),
        alvo: alvoDe(r.input), tipo: 'exec', abrir: { k: 'history' },
      })),
      ...sessoes.map((s): Evento => ({
        chave: `s:${s.id}`, quando: s.updated_at, titulo: 'Investigação atualizada',
        alvo: `${s.seed || s.title} · ${s.node_count ?? 0} nós`, tipo: 'sessao', abrir: { k: 'inv', id: s.id },
      })),
    ].sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando)).slice(0, 6)
    : null;

  const ultimaSessao = detalhe && detalhe !== 'vazio' ? detalhe.investigation : null;

  return (
    <div className="page dash">
      {/* ---------- Ação principal + verificação rápida ---------- */}
      <section className="dash-hero">
        <div className="dash-hero-txt">
          <p className="dash-kicker">Painel · {NOME_PLANO[user.plan]}</p>
          <h1 className="dash-titulo">Informação pública, <span>organizada</span>.</h1>
          <p className="dash-estado">
            {geral ? (
              <><span className="ponto" data-e={geral.chave} /> {geral.texto} · {prontas}/{saude!.linhas.length} fontes prontas</>
            ) : (
              'A ler o estado do sistema…'
            )}
            {restantes !== null && (
              <> · <strong>{restantes}</strong> de {usage!.daily} execuções hoje</>
            )}
          </p>
          <form
            className="dash-quick-form"
            aria-label="Verificação rápida de username"
            onSubmit={(e) => {
              e.preventDefault();
              const v = alvo.trim().replace(/^@/, '');
              if (!v) return;
              const t = tools.find((t) => t.id === 'username-intel' && t.lock !== 'locked')
                ?? tools.find((t) => t.id === 'username-finder' && t.lock !== 'locked');
              setView(t ? { k: 'tool', id: t.id } : { k: 'nova' });
            }}
          >
            <label className="micro" htmlFor="dash-username">Verificação rápida — username</label>
            <div className="dash-quick-row">
              <input
                id="dash-username"
                className="input"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="@username"
                value={alvo}
                onChange={(e) => setAlvo(e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={!alvo.trim()}>
                Verificar
              </button>
            </div>
          </form>
        </div>
        <div className="dash-cta">
          <button className="btn btn-primary btn-lg" type="button" onClick={() => setView({ k: 'nova' })}>
            <Icon.target /> Nova investigação
          </button>
          {onBusca && (
            <button className="btn" type="button" onClick={onBusca}>
              <Icon.search /> Busca global <kbd className="kbd">Ctrl K</kbd>
            </button>
          )}
        </div>
      </section>

      {/* ---------- Atalhos de um toque ---------- */}
      {acoes.length > 0 && (
        <nav className="dash-acoes" aria-label="Atalhos">
          {acoes.map(({ a }) => {
            const Ico = a.icon;
            return (
              <button key={a.id} className="dash-acao" type="button" onClick={() => setView({ k: 'tool', id: a.id })}>
                <span className="dash-acao-ico"><Ico /></span>
                <span className="dash-acao-txt">{a.nome}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* ---------- Indicadores reais ---------- */}
      <section className="dash-stats" aria-label="Resumo">
        <div className="stat-card">
          <span className="stat-ico"><Icon.activity /></span>
          <span className="stat-v num">{usage ? `${usage.today}/${usage.daily}` : '—'}</span>
          <span className="stat-l">Execuções hoje</span>
        </div>
        <button className="stat-card" type="button" onClick={() => setView({ k: 'health' })}>
          <span className="stat-ico"><Icon.server /></span>
          <span className="stat-v num">{saude ? `${prontas}/${saude.linhas.length}` : '—'}</span>
          <span className="stat-l">Fontes prontas</span>
        </button>
        <button className="stat-card" type="button" onClick={() => setView({ k: 'inv' })}>
          <span className="stat-ico"><Icon.network /></span>
          <span className="stat-v num">{sessoes ? sessoes.length : '—'}</span>
          <span className="stat-l">Sessões guardadas</span>
        </button>
        <div className="stat-card">
          <span className="stat-ico"><Icon.layers /></span>
          <span className="stat-v num">{entidades ?? '—'}</span>
          <span className="stat-l">Entidades mapeadas</span>
        </div>
      </section>

      <div className="dash-grid">
        {/* ---------- Mapa de conexões ---------- */}
        <section className="card dash-card dash-mapa" aria-label="Mapa de conexões">
          <header className="dash-card-head">
            <span className="dash-card-ico"><Icon.network /></span>
            <div className="grow">
              <h2 className="card-title">Mapa de Conexões</h2>
              <p className="card-sub">
                {ultimaSessao
                  ? <>Última sessão: <strong>{ultimaSessao.seed || ultimaSessao.title}</strong> · {haQuanto(ultimaSessao.updated_at)}</>
                  : 'Relações entre o alvo e o que as fontes públicas devolveram.'}
              </p>
            </div>
            {ultimaSessao && (
              <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'inv', id: ultimaSessao.id })}>
                Abrir grafo <Icon.chevronRight width={14} height={14} />
              </button>
            )}
          </header>
          {detalhe === null ? (
            <Skeleton lines={4} />
          ) : detalhe === 'vazio' ? (
            <Empty icon={Icon.network} title="Sem grafo para mostrar"
              action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>começar uma investigação</button>}>
              O mapa aparece aqui depois da primeira investigação guardada.
            </Empty>
          ) : (
            <MapaConexoes detalhe={detalhe} />
          )}
        </section>

        {/* ---------- Atividade recente ---------- */}
        <section className="card dash-card dash-atividade" aria-label="Atividade recente">
          <header className="dash-card-head">
            <span className="dash-card-ico"><Icon.history /></span>
            <h2 className="card-title grow">Atividade Recente</h2>
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'history' })}>ver todas</button>
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
                  <button className="feed-item" type="button" data-tipo={e.tipo} onClick={() => setView(e.abrir)}>
                    <span className="feed-ico">{e.tipo === 'sessao' ? <Icon.network /> : <Icon.activity />}</span>
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

        {/* ---------- Perfis analisados ---------- */}
        <section className="card dash-card dash-perfis" aria-label="Perfis analisados">
          <header className="dash-card-head">
            <span className="dash-card-ico"><Icon.user /></span>
            <h2 className="card-title grow">Perfis Analisados</h2>
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'inv' })}>ver todas</button>
          </header>
          {!sessoes ? (
            <Skeleton lines={3} />
          ) : sessoes.length === 0 ? (
            <Empty icon={Icon.user} title="Ainda não investigaste nada"
              action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>começar a primeira</button>}>
              O resultado fica guardado com o grafo inteiro, e relê-lo não gasta cota.
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              {sessoes.slice(0, 5).map((s) => (
                <button key={s.id} className="invest-card" type="button" onClick={() => setView({ k: 'inv', id: s.id })}>
                  <span className="invest-ico">{(s.seed || s.title || '?').replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
                  <span className="invest-txt">
                    <span className="invest-alvo">{s.seed || s.title}</span>
                    <span className="invest-meta">
                      <span className="tag">{s.seed_type ?? 'alvo'}</span> {s.node_count ?? 0} nós · {s.edge_count ?? 0} ligações · {haQuanto(s.updated_at)}
                    </span>
                  </span>
                  <Icon.chevronRight width={16} height={16} style={{ color: 'var(--t-4)' }} />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ---------- Fontes monitoradas ---------- */}
        <section className="card dash-card dash-fontes" aria-label="Fontes monitoradas">
          <header className="dash-card-head">
            <span className="dash-card-ico"><Icon.server /></span>
            <h2 className="card-title grow">Fontes Monitoradas</h2>
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'health' })}>ver todas</button>
          </header>
          {!saude ? (
            <Skeleton lines={4} />
          ) : saude.linhas.length === 0 ? (
            <p className="t-sm dim">O servidor não declarou fontes externas.</p>
          ) : (
            <ul className="fontes">
              {saude.linhas.slice(0, 6).map((l) => {
                const e = estadoDe(l.status);
                return (
                  <li key={l.nome + l.modulo} className="fonte">
                    <span className="fonte-nome">{l.nome}</span>
                    <span className="fonte-estado" data-e={e.chave}><span className="ponto" data-e={e.chave} /> {e.texto}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ---------- Ferramentas ---------- */}
      <section aria-label="Ferramentas">
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
                const Cat = CATEGORY_ICON[t.category] ?? Icon.grid;
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
