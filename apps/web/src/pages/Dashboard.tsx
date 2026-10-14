import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, type Graph, type Investigation, type LinhaSaude, type ToolPublic, type Usage, type User } from '../api';
import { Icon } from '../components/Icons';
import GraphView from '../components/GraphView';
import { Empty, Skeleton } from '../components/ui';
import { GRUPOS, porGrupo } from '../ia';
import type { View } from './AppShell';

type Snapshot = { sessions: Investigation[]; sources: LinhaSaude[]; health: string };
// Estados vindos de /api/health: ONLINE, LIMITADO, NÃO CONFIGURADO, ERRO.
const STATE: Record<string, { label: string; className: string }> = {
  READY: { label: 'Online', className: 'ready' }, RATE_LIMITED: { label: 'Limitado', className: 'limited' },
  NOT_CONFIGURED: { label: 'Não configurado', className: 'offline' }, MISSING_SECRET: { label: 'Não configurado', className: 'offline' },
  NOT_INSTALLED: { label: 'Não instalado', className: 'offline' }, DISABLED: { label: 'Desligado', className: 'offline' },
  ERROR: { label: 'Erro', className: 'error' }, INCOMPATIBLE: { label: 'Incompatível', className: 'offline' },
};
const sourceStatus = (status: string) => STATE[status] ?? { label: status, className: 'offline' };

export default function Dashboard({ user, tools, usage, setView }: {
  user: User; tools: ToolPublic[]; usage: Usage | null; setView: (view: View) => void;
}) {
  const [target, setTarget] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.investigations().then((r) => r.investigations).catch(() => []),
      api.saude(false).then((r) => r.relatorio).catch(() => null),
    ]).then(([sessions, health]) => {
      if (!active) return;
      setSnapshot({
        sessions: sessions.slice(0, 4),
        sources: health?.providers ?? [],
        health: health?.estadoGeral ?? 'NOT_CONFIGURED',
      });
      if (sessions[0]) {
        api.investigation(sessions[0].id).then((detail) => {
          if (active) setGraph({ nodes: detail.nodes, edges: detail.edges, runs: [], seedType: detail.investigation.seed_type });
        }).catch(() => { if (active) setGraph(null); });
      }
    });
    return () => { active = false; };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = target.trim().replace(/^@/, '');
    if (!value) return;
    sessionStorage.setItem('argos:initial-target', value);
    setView({ k: 'nova' });
  };
  const status = sourceStatus(snapshot?.health ?? 'NOT_CONFIGURED');
  const online = snapshot?.sources.filter((source) => source.status === 'READY').length ?? 0;
  const used = usage?.today ?? 0;
  const daily = usage?.daily ?? 0;

  return (
    <div className="dashboard-layout">
      <div className="dashboard-main">
        <section className="dashboard-hero dash-hero">
          <div className="dashboard-hero-copy">
            <p className="dashboard-eyebrow">ARGOS <span>POR SR. AMORIM</span></p>
            <h1>Investigue <em>qualquer alvo.</em><br className="hero-break" /> Em segundos.</h1>
            <p className="dashboard-lede">Módulos de investigação OSINT com relatório, fontes e proveniência — no seu telemóvel.</p>
          </div>
        </section>

        <section className="dashboard-search-panel" aria-labelledby="new-investigation-title">
          <div className="section-heading">
            <span className="section-heading-icon"><Icon.search /></span>
            <div><h2 id="new-investigation-title">Nova investigação</h2><p>Digite um alvo para começar. O ARGOS seleciona as ferramentas mais relevantes.</p></div>
          </div>
          <form className="dashboard-target-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="busca-global">Usuário, e-mail, domínio, telefone, IP ou URL</label>
            <Icon.search />
            <input id="busca-global" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Usuário, e-mail, domínio, telefone, IP ou URL..." autoCapitalize="none" autoComplete="off" />
            <button className="btn btn-primary" type="submit" disabled={!target.trim()}>Iniciar análise <span aria-hidden>→</span></button>
          </form>
          <div className="target-examples"><span>Exemplos:</span>{['usuario123', 'exemplo.com', 'teste@email.com', '+55 11 99999-9999', '192.168.1.1'].map((example) => <button type="button" key={example} onClick={() => setTarget(example)}>{example}</button>)}</div>
        </section>

        <section className="dashboard-modules" aria-labelledby="modules-title">
          <div className="dashboard-section-title"><span><Icon.grid /><h2 id="modules-title">Módulos de investigação</h2></span><button type="button" onClick={() => setView({ k: 'nova' })}>Ver todas as ferramentas <span>→</span></button></div>
          <div className="mod-list">
            {GRUPOS.map((group) => {
              const entries = porGrupo(tools, group.id);
              if (!entries.length) return null;
              const GroupIcon = group.icon;
              const locked = entries.every((tool) => tool.lock === 'locked');
              return <button className="mod-card" type="button" key={group.id} onClick={() => setView({ k: 'tool', id: entries[0].id })}>
                <span className="mod-ico"><GroupIcon /></span>
                <span className="mod-copy"><strong>{group.nome}</strong><small>{group.resumo}</small><span className="mod-tools">{entries.map((tool) => tool.name).join(' · ')}{locked && ' · PRO'}</span></span>
                <Icon.chevronRight />
              </button>;
            })}
          </div>
        </section>

        <section className="dashboard-graph-card">
          <div className="dashboard-section-title"><span><Icon.network /><h2>Grafo de conexões</h2></span><div><button type="button" onClick={() => setView({ k: 'inv' })}>Ver investigações <span>→</span></button></div></div>
          {graph?.nodes.length ? <div className="dashboard-graph"><GraphView graph={graph} /></div> : snapshot?.sessions.length === 0 ? <div className="dashboard-graph-empty"><Empty icon={Icon.network} title="Seu primeiro grafo começa com uma investigação" action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>Iniciar investigação</button>}>As conexões aparecem aqui quando houver resultados salvos.</Empty></div> : <Skeleton lines={3} />}
        </section>
      </div>

      <aside className="dashboard-rail" aria-label="Resumo do sistema e atividade">
        <section className="rail-card">
          <div className="rail-title"><Icon.activity /><h2>Status do sistema</h2><button type="button" onClick={() => setView({ k: 'health' })}>Detalhes <span>→</span></button></div>
          <div className="system-overview"><span className={`status-pip ${status.className}`} /><div><strong>{status.label}</strong><small>{snapshot ? `${online} de ${snapshot.sources.length} fontes prontas` : 'Consultando fontes reais'}</small></div><span className="system-count">{snapshot ? `${online}/${snapshot.sources.length}` : '—'}</span></div>
          <div className="source-status-list">{!snapshot ? <Skeleton lines={4} /> : snapshot.sources.slice(0, 8).map((source) => {
            const itemStatus = sourceStatus(source.status);
            return <div className="source-status-row" key={`${source.nome}-${source.modulo}`}><span className={`status-pip ${itemStatus.className}`} /><span>{source.nome}</span><small>{itemStatus.label}</small></div>;
          })}</div>
          <button className="rail-footer-link" type="button" onClick={() => setView({ k: 'health' })}>Abrir relatório de saúde <span>→</span></button>
        </section>

        <section className="rail-card">
          <div className="rail-title"><Icon.clock /><h2>Investigações recentes</h2><button type="button" onClick={() => setView({ k: 'inv' })}>Ver todas <span>→</span></button></div>
          {!snapshot ? <Skeleton lines={3} /> : snapshot.sessions.length ? <div className="recent-list">{snapshot.sessions.slice(0, 4).map((session) => <button type="button" className="recent-item" key={session.id} onClick={() => setView({ k: 'inv', id: session.id })}><span className="recent-icon"><Icon.globe /></span><span className="recent-copy"><strong>{session.seed || session.title}</strong><small>{session.seed_type || 'Alvo'} · {session.node_count ?? 0} fontes/entidades</small></span><span className="recent-meta">{relativeTime(session.updated_at)}<Icon.chevronRight /></span></button>)}</div> : <p className="rail-empty">Nenhuma investigação salva ainda.</p>}
        </section>

        <section className="rail-card">
          <div className="rail-title"><Icon.server /><h2>Fontes disponíveis</h2><button type="button" onClick={() => setView({ k: 'health' })}>Ver todas <span>→</span></button></div>
          {!snapshot ? <Skeleton lines={3} /> : <div className="provider-list">{snapshot.sources.slice(0, 6).map((source) => {
            const itemStatus = sourceStatus(source.status);
            return <div className="provider-item" key={`${source.nome}-${source.modulo}`}><span className="provider-mark"><Icon.globe /></span><span className="provider-copy"><strong>{source.nome}</strong><small>{source.servicoExterno || source.tipo}</small></span><span className={`provider-state ${itemStatus.className}`}>{itemStatus.label}</span></div>;
          })}</div>}
        </section>

        <section className="rail-plan-card"><div><span className="rail-plan-kicker">SEU PLANO</span><strong>{user.plan.toUpperCase()}</strong><small>{usage ? `${used} de ${daily} análises usadas hoje` : 'Entre para consultar seus limites'}</small></div><div className="plan-meter"><i style={{ width: `${daily ? Math.min(100, used / daily * 100) : 0}%` }} /></div><button type="button" onClick={() => setView({ k: 'plans' })}>Ver planos <span>→</span></button></section>
      </aside>
    </div>
  );
}

function relativeTime(value: string) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const hours = Math.max(0, Math.floor((Date.now() - then) / 3_600_000));
  if (hours < 1) return 'agora';
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}
