/**
 * Painel — primeiro ecrã de quem entra (reconstrução 2026-10).
 *
 * Ordem curta: ação principal → estado real (cota + fontes numa linha) →
 * continuar o trabalho → ferramentas com busca. Sem secções repetidas, sem
 * cartões a competir. Todos os dados vêm do backend; vazio mostra-se vazio.
 */
import { useEffect, useState } from 'react';
import { api, type ToolPublic, type Usage, type User, type LinhaSaude, type EstadoSaude } from '../api';
import { Icon } from '../components/Icons';
import { Empty, SearchInput, Skeleton } from '../components/ui';
import { GRUPOS, porGrupo, buscar, ATALHOS, NOME_PLANO } from '../ia';
import type { View } from './AppShell';

interface Resumo {
  sessoes: { id: string; title: string; seed: string; updated_at: string; seed_type?: string; node_count?: number; edge_count?: number }[];
  historico: { id: string; tool_id: string; created_at: string; bytes: number }[];
}

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

export default function Dashboard({
  user, tools, usage, setView,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null; setView: (v: View) => void;
}) {
  const [q, setQ] = useState('');
  const [alvo, setAlvo] = useState('');
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [saude, setSaude] = useState<{ linhas: LinhaSaude[]; geral: EstadoSaude } | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.investigations().then((r) => r.investigations).catch(() => []),
      api.history().then((r) => r.runs).catch(() => []),
      api.saude(false).then((r) => r.relatorio).catch(() => null),
    ]).then(([sessoes, hist, rel]) => {
      if (!vivo) return;
      setResumo({ sessoes: sessoes.slice(0, 4) as Resumo['sessoes'], historico: hist.slice(0, 5) });
      if (rel && Array.isArray(rel.providers)) {
        setSaude({
          geral: rel.estadoGeral,
          linhas: rel.providers.filter((l) => l.tipo === 'api' || l.tipo === 'endpoint'),
        });
      }
    });
    return () => { vivo = false; };
  }, []);

  const restantes = usage ? Math.max(0, usage.daily - usage.today) : null;
  const encontrados = q.trim() ? buscar(tools, q) : tools;
  const geral = saude ? estadoDe(saude.geral) : null;
  const prontas = saude?.linhas.filter((l) => l.status === 'READY').length ?? 0;

  const principais = ATALHOS
    .map((a) => tools.find((t) => t.id === a.id))
    .filter((t): t is ToolPublic => !!t && t.lock !== 'locked')
    .slice(0, 4);

  return (
    <div className="page dash">
      {/* ---------- Ação principal + estado real ---------- */}
      <section className="dash-hero">
        <div>
          <p className="dash-kicker">Painel · {NOME_PLANO[user.plan]}</p>
          <h1 className="dash-titulo">O que vamos investigar?</h1>
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
        </div>
        <div className="dash-cta">
          <button className="btn btn-primary btn-lg" type="button" onClick={() => setView({ k: 'nova' })}>
            <Icon.target /> Nova investigação
          </button>
          <button className="btn" type="button" onClick={() => setView({ k: 'health' })}>
            Estado do sistema
          </button>
        </div>
      </section>

      {/* ---------- Verificação rápida estilo Maigret: username primeiro ---------- */}
      <section className="dash-quick" aria-label="Verificação rápida de username">
        <form
          className="dash-quick-form"
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
          <p className="t-xs dim">Presença pública em centenas de sites (Maigret + registos abertos). Só fontes públicas.</p>
        </form>
      </section>

      {/* ---------- Continuar ---------- */}
      <section aria-label="Investigações recentes">
        <div className="regra">
          <span className="micro">Continuar</span>
          <span className="grow" />
          <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'inv' })}>ver todas</button>
        </div>
        {!resumo ? (
          <Skeleton lines={2} />
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
              <button key={s.id} className="invest-card" type="button" onClick={() => setView({ k: 'inv', id: s.id })}>
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

      {/* ---------- Ferramentas ---------- */}
      <section aria-label="Ferramentas">
        <div className="regra"><span className="micro">Ferramentas</span></div>
        <div className="grid grid-2" style={{ marginBottom: 'var(--s-4)' }}>
          {principais.map((t) => (
            <button key={t.id} className="tool-card" type="button" onClick={() => setView({ k: 'tool', id: t.id })}>
              <div className="tool-top">
                <span className="tool-glyph"><Icon.network /></span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="tool-name">{t.name}</span>
                </span>
              </div>
              <div className="tool-sum">{t.summary}</div>
              <span className="tool-chevron"><Icon.chevronRight /></span>
            </button>
          ))}
        </div>
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
              {encontrados.map((t) => (
                <button key={t.id} className="tool-card" type="button"
                  data-locked={t.lock === 'locked'}
                  onClick={() => setView({ k: 'tool', id: t.id })}>
                  {t.lock === 'locked' && <span className="tag tag-pro tool-badge">PRO</span>}
                  <div className="tool-top">
                    <span className="tool-glyph"><Icon.network /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="tool-name">{t.name}</span>
                    </span>
                  </div>
                  <div className="tool-sum">{t.summary}</div>
                  <span className="tool-chevron"><Icon.chevronRight /></span>
                </button>
              ))}
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
