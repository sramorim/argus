/**
 * Estrutura da aplicação.
 *
 * Um esqueleto, dois arranjos:
 *  - **desktop**: barra lateral fixa com catálogo por categoria + medidor de cota;
 *  - **telemóvel**: barra de topo enxuta + barra inferior de 4 destinos + gaveta
 *    para o catálogo completo. Sem barra lateral espremida, sem hamburguer que
 *    esconde metade do que existe.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { api, type ToolPublic, type Usage, type User } from '../api';
import { Icon, CATEGORY_ICON, CATEGORY_ORDER, CATEGORY_LABEL } from '../components/Icons';
import { Brand } from '../components/ui';
import Catalog from './Catalog';
import ToolPage from './ToolPage';
import Investigations from './Investigations';
import Plans from './Plans';
import Keys from './Keys';
import Account from './Account';
import Admin from './Admin';
import History from './History';

export type View =
  | { k: 'catalog' } | { k: 'tool'; id: string } | { k: 'inv' } | { k: 'inv'; id: string }
  | { k: 'plans' } | { k: 'keys' } | { k: 'account' } | { k: 'admin' } | { k: 'history' };

const TABS: { v: View; label: string; icon: (p: Record<string, unknown>) => ReactElement }[] = [
  { v: { k: 'catalog' }, label: 'Ferramentas', icon: Icon.grid },
  { v: { k: 'inv' }, label: 'Investigações', icon: Icon.network },
  { v: { k: 'plans' }, label: 'Planos', icon: Icon.crown },
  { v: { k: 'account' }, label: 'Conta', icon: Icon.user },
];

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

export default function AppShell({
  user, tools, usage, view, setView, onLogout, refreshUser,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null;
  view: View; setView: (v: View) => void; onLogout: () => void; refreshUser: () => void;
}) {
  const [drawer, setDrawer] = useState(false);

  // Fecha a gaveta ao voltar para desktop (senão fica aberta por cima do ecrã).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1001px)');
    const on = () => { if (mq.matches) setDrawer(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Com a gaveta aberta o fundo não deve rolar: no telemóvel, arrastar por cima
  // da lista faz o conteúdo de trás andar e é o que mais desconcerta.
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawer]);

  // Volta ao topo a cada navegação: numa página de resultado longa, trocar de
  // ecrã sem mexer na scrollbar é o erro que mais irrita no telemóvel.
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [view.k, (view as { id?: string }).id]);

  const go = (v: View) => { setView(v); setDrawer(false); };

  const byCat = useMemo(() => {
    const m = new Map<string, ToolPublic[]>();
    for (const t of tools) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return [...m.entries()].sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [tools]);

  const title = useMemo(() => {
    switch (view.k) {
      case 'catalog': return 'Ferramentas';
      case 'tool': return tools.find((t) => t.id === (view as { id: string }).id)?.name ?? 'Ferramenta';
      case 'inv': return ((view as { id?: string }).id ? 'Investigação' : 'Investigações');
      case 'plans': return 'Planos';
      case 'keys': return 'Chaves API';
      case 'account': return 'Conta';
      case 'admin': return 'Administração';
      case 'history': return 'Histórico';
      default: return 'ARGUS';
    }
  }, [view, tools]);

  const pct = usage?.daily ? Math.min(100, (usage.today / usage.daily) * 100) : 0;
  const exhausted = usage ? usage.today >= usage.daily : false;

  const drawerContent = (
    <>
      <div className="side-scroll">
        <div className="nav-group">
          <div className="nav-title">Aplicação</div>
          <NavItem v={{ k: 'catalog' }} view={view} onGo={go} icon={Icon.grid} label="Ferramentas" count={tools.length} />
          <NavItem v={{ k: 'inv' }} view={view} onGo={go} icon={Icon.network} label="Investigações" />
          <NavItem v={{ k: 'history' }} view={view} onGo={go} icon={Icon.history} label="Histórico" />
          <NavItem v={{ k: 'plans' }} view={view} onGo={go} icon={Icon.crown} label="Planos" />
          <NavItem v={{ k: 'keys' }} view={view} onGo={go} icon={Icon.key} label="Chaves API" />
          <NavItem v={{ k: 'account' }} view={view} onGo={go} icon={Icon.user} label="Conta" />
          {user.isAdmin && <NavItem v={{ k: 'admin' }} view={view} onGo={go} icon={Icon.shield} label="Administração" />}
        </div>
        {byCat.map(([cat, list]) => {
          const Ico = CATEGORY_ICON[cat] ?? Icon.grid;
          return (
            <div className="nav-group" key={cat}>
              <div className="nav-title">{CATEGORY_LABEL[cat] ?? cat}</div>
              {list.map((t) => (
                <button
                  key={t.id} className="nav-item" type="button"
                  aria-current={view.k === 'tool' && (view as { id: string }).id === t.id}
                  onClick={() => go({ k: 'tool', id: t.id })}
                >
                  <Ico className="nav-ico" />
                  <span className="nav-label-txt">{t.name}</span>
                  {t.lock === 'locked' && <Icon.lock width={12} height={12} style={{ color: 'var(--t-4)' }} />}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="side-foot">
        <div className="quota-card">
          <div className="quota-head">
            <span className="quota-plan">{user.plan === 'pro_max' ? 'PRO MAX' : user.plan.toUpperCase()}</span>
            <span className="quota-val">{usage?.today ?? 0}/{usage?.daily ?? 0}</span>
          </div>
          <div className="meter"><i style={{ width: `${pct}%` }} /></div>
          <div className="quota-mail" title={user.email}>{user.email}</div>
          {usage?.concurrent != null && (
            <div className="t-xs dim" style={{ marginTop: 4 }}>
              {usage.inflight ?? 0}/{usage.concurrent} em curso
            </div>
          )}
          <button className="btn btn-sm btn-quiet btn-block" style={{ marginTop: 10 }} onClick={onLogout} type="button">
            <Icon.logout width={14} height={14} /> Sair
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="app">
      <aside className="sidebar" data-open={drawer}>
        <Brand />
        {drawerContent}
      </aside>
      {drawer && <div className="scrim-side" onClick={() => setDrawer(false)} />}

      <main className="main">
        <header className="appbar">
          <button className="icon-btn only-narrow" onClick={() => setDrawer(true)} aria-label="Abrir menu" type="button">
            <Icon.menu />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="appbar-title">{title}</div>
            {view.k === 'tool' && <div className="appbar-crumb">resultados com proveniência</div>}
          </div>
          <span className="grow" />
          {exhausted && <span className="tag tag-pro">cota esgotada</span>}
          {!exhausted && usage && <span className="t-xs dim num only-wide">{usage.daily - usage.today} execuções hoje</span>}
          <button className="icon-btn only-narrow" onClick={() => go({ k: 'account' })} aria-label="Conta" type="button">
            <Icon.user />
          </button>
        </header>

        {view.k === 'catalog' && <Catalog tools={tools} setView={go} />}
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
          <button key={t.label} className="tab" type="button"
            aria-current={view.k === t.v.k}
            onClick={() => go(t.v)}>
            <t.icon />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavItem({ v, view, onGo, icon: Ico, label, count }: {
  v: View; view: View; onGo: (v: View) => void;
  icon: (p: Record<string, unknown>) => ReactElement; label: string; count?: number;
}) {
  return (
    <button className="nav-item" type="button" aria-current={sameView(v, view)} onClick={() => onGo(v)}>
      <Ico className="nav-ico" />
      <span className="nav-label-txt">{label}</span>
      {count != null && <span className="nav-count num">{count}</span>}
    </button>
  );
}
