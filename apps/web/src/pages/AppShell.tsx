/**
 * Estrutura da aplicação.
 *
 * Duas decisões que definem a experiência:
 *
 * 1. **A navegação é por camadas, não uma lista.** A sidebar tem grupos
 *    ("Identidade", "Domínio e Infraestrutura", …) que abrem e fecham. Só o grupo
 *    que contém a ferramenta aberta fica marcado, para se saber sempre onde
 *    está. Uma lista de 26 botões não diz nada; sete grupos dizem.
 *
 * 2. **O primeiro ecrã é um painel, não o catálogo.** Quem entra quer
 *    investigar alguma coisa, não ler um índice. O painel tem a ação principal em
 *    grande e atalhos para o que mais se usa.
 *
 * Telemóvel: barra inferior de 4 destinos e a mesma sidebar em gaveta. O
 * comportamento dos grupos é o mesmo nos dois.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { api, type ToolPublic, type Usage, type User, useContacto } from '../api';
import { Icon, CATEGORY_ICON, CATEGORY_LABEL } from '../components/Icons';
import { Brand } from '../components/ui';
import { GRUPOS, VISTAS, ATALHOS, NOME_PLANO, porGrupo } from '../ia';
import Dashboard from './Dashboard';
import ToolPage from './ToolPage';
import Investigations from './Investigations';
import Plans from './Plans';
import Keys from './Keys';
import Account from './Account';
import Admin from './Admin';
import History from './History';

export type View =
  | { k: 'dashboard' } | { k: 'nova' }
  | { k: 'tool'; id: string } | { k: 'inv' } | { k: 'inv'; id: string }
  | { k: 'plans' } | { k: 'keys' } | { k: 'account' } | { k: 'admin' } | { k: 'history' };

/** Os 4 destinos da barra inferior. Escolha: o que se usa a toda a hora. */
const TABS: { v: View; id: string; label: string; icon: (p: Record<string, unknown>) => ReactElement }[] = [
  { v: { k: 'dashboard' }, id: 'dashboard', label: 'Painel', icon: Icon.grid },
  { v: { k: 'nova' }, id: 'nova', label: 'Investigar', icon: Icon.target },
  { v: { k: 'inv' }, id: 'inv', label: 'Sessões', icon: Icon.network },
  { v: { k: 'account' }, id: 'account', label: 'Conta', icon: Icon.user },
];

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

export default function AppShell({
  user, tools, usage, view, setView, onLogout, refreshUser,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null;
  view: View; setView: (v: View) => void; onLogout: () => void; refreshUser: () => void;
}) {
  const [drawer, setDrawer] = useState(false);
  const wa = useContacto();

  /**
   * Quais grupos estão abertos. Por omissão, só o grupo da ferramenta aberta —
   * é o que impede a sidebar de ser uma parede de texto. O utilizador pode abrir
   * outros e a escolha fica.
   */
  const grupoDaFerramenta = useMemo(() => {
    if (view.k !== 'tool') return null;
    return GRUPOS.find((g) => g.ferramentas.includes((view as { id: string }).id))?.id ?? null;
  }, [view]);

  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(grupoDaFerramenta ? [grupoDaFerramenta] : ['investigar']));

  // Ao navegar, o grupo da ferramenta abre-se só. Sem isto, abrir uma ferramenta
  // de dentro de um grupo fechado deixava a sidebar sem nada marcado.
  useEffect(() => {
    if (!grupoDaFerramenta) return;
    setAbertos((s) => (s.has(grupoDaFerramenta) ? s : new Set([...s, grupoDaFerramenta])));
  }, [grupoDaFerramenta]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1001px)');
    const on = () => { if (mq.matches) setDrawer(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawer]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [view.k, (view as { id?: string }).id]);

  const go = (v: View) => { setView(v); setDrawer(false); };
  const alternar = (id: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const pct = usage?.daily ? Math.min(100, (usage.today / usage.daily) * 100) : 0;
  const esgotada = usage ? usage.today >= usage.daily : false;

  const visivel = (id: string) => (user.isAdmin ? true : id !== 'admin');

  const conteudoLateral = (
    <>
      <div className="side-scroll">
        <div className="nav-group">
          <button
            className="btn btn-primary btn-block"
            type="button"
            onClick={() => go({ k: 'nova' })}
            style={{ marginBottom: 'var(--s-4)' }}
          >
            <Icon.target /> Nova investigação
          </button>
          {VISTAS.filter((v) => v.id !== 'admin' || user.isAdmin).map((v) => (
            <NavItem
              key={v.id}
              v={{ k: v.id } as View}
              view={view}
              onGo={go}
              icon={v.icon}
              label={v.nome}
            />
          ))}
        </div>

        <div className="nav-title">Ferramentas por objetivo</div>
        {GRUPOS.map((g) => {
          const lista = porGrupo(tools, g.id);
          if (!lista.length) return null;
          const aberto = abertos.has(g.id);
          const atual = grupoDaFerramenta === g.id;
          const Ico = g.icon;
          return (
            <div className="layer" key={g.id} data-open={aberto} data-current={atual}>
              <button
                className="layer-head"
                type="button"
                aria-expanded={aberto}
                title={g.resumo}
                onClick={() => alternar(g.id)}
              >
                <Ico />
                <span className="layer-label">{g.nome}</span>
                <span className="layer-count">{lista.length}</span>
                <Icon.chevronRight className="layer-caret" />
              </button>
              <div className="layer-body">
                <div>
                  <div className="layer-inner">
                    {lista.map((t) => {
                      const Cat = CATEGORY_ICON[t.category] ?? Icon.grid;
                      return (
                        <button
                          key={t.id}
                          className="nav-item"
                          type="button"
                          aria-current={view.k === 'tool' && (view as { id: string }).id === t.id}
                          onClick={() => go({ k: 'tool', id: t.id })}
                          title={t.summary}
                        >
                          <Cat className="nav-ico" />
                          <span className="nav-label-txt">{t.name}</span>
                          {t.lock === 'locked' && <Icon.lock width={12} height={12} style={{ color: 'var(--t-4)' }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="side-foot">
        <div className="quota-card">
          <div className="quota-head">
            <span className="quota-plan">{NOME_PLANO[user.plan]}</span>
            <span className="quota-val">{usage?.today ?? 0}/{usage?.daily ?? 0}</span>
          </div>
          <div className="meter"><i style={{ width: `${pct}%` }} /></div>
          <div className="quota-mail" title={user.email}>{user.email}</div>
          {usage?.concurrent != null && (
            <div className="t-xs dim" style={{ marginTop: 5 }}>
              {usage.inflight ?? 0}/{usage.concurrent} em curso
            </div>
          )}
          <button className="btn btn-sm btn-quiet btn-block" style={{ marginTop: 11 }} onClick={onLogout} type="button">
            <Icon.logout width={14} height={14} /> Sair
          </button>
        </div>
        <div className="side-legal">
          <div>{wa?.copyright ?? '© 2026 SR. Amorim'}</div>
          {wa && <a href={wa.link} target="_blank" rel="noopener noreferrer">{wa.label}</a>}
        </div>
      </div>
    </>
  );

  const titulo = useMemo(() => {
    switch (view.k) {
      case 'dashboard': return 'Painel';
      case 'nova': return 'Nova investigação';
      case 'tool': return tools.find((t) => t.id === (view as { id: string }).id)?.name ?? 'Ferramenta';
      case 'inv': return ((view as { id?: string }).id ? 'Sessão' : 'Sessões');
      case 'plans': return 'Planos';
      case 'keys': return 'Chaves API';
      case 'account': return 'Conta';
      case 'admin': return 'Administração';
      case 'history': return 'Histórico';
      default: return 'ARGUS';
    }
  }, [view, tools]);

  const crumb = view.k === 'tool'
    ? GRUPOS.find((g) => g.ferramentas.includes((view as { id: string }).id))?.nome
    : undefined;

  return (
    <div className="app">
      <aside className="sidebar" data-open={drawer}>
        <Brand />
        {conteudoLateral}
      </aside>
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} />}

      <main className="main">
        <header className="appbar">
          <button className="icon-btn only-narrow" onClick={() => setDrawer(true)} aria-label="Abrir menu" type="button">
            <Icon.menu />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="appbar-title">{titulo}</div>
            {crumb && <div className="appbar-crumb">{crumb}</div>}
          </div>
          <span className="grow" />
          {esgotada && <span className="tag tag-warn">cota esgotada</span>}
          {!esgotada && usage && (
            <span className="t-xs dim num only-wide">{usage.daily - usage.today} execuções hoje</span>
          )}
          <button className="icon-btn only-narrow" onClick={() => go({ k: 'account' })} aria-label="Conta" type="button">
            <Icon.user />
          </button>
        </header>

        {view.k === 'dashboard' && <Dashboard user={user} tools={tools} usage={usage} setView={go} />}
        {view.k === 'nova' && <ToolPage id="graph-investigation" tools={tools} onUsage={refreshUser} comoAlvo />}
        {view.k === 'tool' && (
          <ToolPage id={(view as { id: string }).id} tools={tools} onUsage={refreshUser} />
        )}
        {view.k === 'inv' && <Investigations view={view as { id?: string }} setView={go} />}
        {view.k === 'plans' && <Plans user={user} />}
        {view.k === 'keys' && <Keys />}
        {view.k === 'account' && <Account user={user} onLogout={onLogout} />}
        {view.k === 'admin' && <Admin />}
        {view.k === 'history' && <History setView={go} />}
      </main>

      <nav className="tabbar" aria-label="Navegação principal">
        {TABS.map((t) => (
          <button key={t.id} className="tab" type="button" aria-current={view.k === t.v.k} onClick={() => go(t.v)}>
            <t.icon />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavItem({ v, view, onGo, icon: Ico, label }: {
  v: View; view: View; onGo: (v: View) => void;
  icon: (p: Record<string, unknown>) => ReactElement; label: string;
}) {
  return (
    <button className="nav-item" type="button" aria-current={sameView(v, view)} onClick={() => onGo(v)}>
      <Ico className="nav-ico" />
      <span className="nav-label-txt">{label}</span>
    </button>
  );
}

export { ATALHOS, CATEGORY_LABEL };
