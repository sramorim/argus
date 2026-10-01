/**
 * Arranque e roteamento.
 *
 * Não há biblioteca de rotas: são cinco estados e o botão do browser. O que há
 * é o que evita o ecrã ficar branco — fronteira de erro, deteção de rede e
 * estados de carga honestos.
 */
import { StrictMode, useCallback, useEffect, useState, Component } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
// Efeito lateral ao arranque: lê as preferências locais (densidade, zebra) e
// escreve-as no <html> antes de o primeiro ecrã desenhar. Sem este import, a
// preferência só passava a valer quando o ecrã de Definições fosse aberto.
import './prefs';
import { api, type ToolPublic, type User, type Usage } from './api';
import Auth from './pages/Auth';
import { Landing } from './pages/Landing';
import AppShell from './pages/AppShell';
import type { View } from './pages/AppShell';
import { Icon, ToastHost } from './components/ui';
import LoadingScreen from './components/LoadingScreen';

type View2 = View;

const viewToHash = (v: View2): string => {
  switch (v.k) {
    case 'dashboard': return '/';
    case 'nova': return '/investigar';
    case 'tool': return `/ferramenta/${(v as { id: string }).id}`;
    case 'inv': return '/investigacoes' + ((v as { id?: string }).id ? `/${(v as { id: string }).id}` : '');
    case 'plans': return '/planos';
    case 'keys': return '/chaves';
    case 'account': return '/conta';
    case 'admin': return '/admin';
    case 'history': return '/historico';
    case 'health': return '/saude';
    case 'radar': return '/radar';
    case 'perfil': return '/perfil';
    case 'definicoes': return '/definicoes';
    default: return '/';
  }
};

const hashToView = (h: string): View2 => {
  const p = h.replace(/^#/, '').replace(/^\/+/, '');
  const [head, arg] = p.split('/');
  switch (head) {
    case 'ferramenta': return arg ? { k: 'tool', id: arg } : { k: 'dashboard' };
    case 'investigacoes': return arg ? { k: 'inv', id: arg } : { k: 'inv' };
    case 'planos': return { k: 'plans' };
    case 'chaves': return { k: 'keys' };
    case 'conta': return { k: 'account' };
    case 'admin': return { k: 'admin' };
    case 'historico': return { k: 'history' };
    case 'saude': return { k: 'health' };
    case 'radar': return { k: 'radar' };
    case 'perfil': return { k: 'perfil' };
    case 'definicoes': return { k: 'definicoes' };
    case 'investigar': return { k: 'nova' };
    default: return { k: 'dashboard' };
  }
};

class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  constructor(p: { children: ReactNode }) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
          <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
            <div className="empty-ico" style={{ margin: '0 auto 12px' }}><Icon.alert /></div>
            <h1 className="t-h2" style={{ marginBottom: 8 }}>A aplicação tropeçou</h1>
            <p className="t-sm muted" style={{ marginBottom: 16 }}>
              Isto é um erro no navegador, não no teu registo. Recarrega para continuar.
            </p>
            <pre className="t-xs mono dim" style={{ textAlign: 'left', overflowWrap: 'anywhere', maxHeight: 140, overflow: 'auto', marginBottom: 16 }}>
              {String(this.state.err?.message ?? this.state.err)}
            </pre>
            <button className="btn btn-primary" type="button" onClick={() => location.reload()}>recarregar</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tools, setTools] = useState<ToolPublic[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [view, setViewState] = useState<View2>(hashToView(location.hash));
  const [loading, setLoading] = useState(true);
  const [appReady, setAppReady] = useState(false);
  const [down, setDown] = useState(false);
  const [publicTools, setPublicTools] = useState<ToolPublic[]>([]);

  const setView = useCallback((v: View2) => {
    setViewState(v);
    const h = `#${viewToHash(v)}`;
    if (location.hash !== h) history.pushState(null, '', h);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([api.tools(), api.me()]);
      setPublicTools(t.tools);
      setUser(m.user);
      if (m.user) { setTools(t.tools); setUsage(m.usage ?? null); }
      else { setTools([]); setUsage(null); }
    } catch { setDown(true); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loading) setAppReady(true);
  }, [loading]);

  useEffect(() => {
    const on = () => setViewState(hashToView(location.hash));
    addEventListener('hashchange', on);
    addEventListener('popstate', on);
    return () => { removeEventListener('hashchange', on); removeEventListener('popstate', on); };
  }, []);

  useEffect(() => {
    const on = () => setDown(!navigator.onLine);
    addEventListener('online', on); addEventListener('offline', on);
    return () => { removeEventListener('online', on); removeEventListener('offline', on); };
  }, []);

  const refreshUser = useCallback(() => { api.me().then((m) => setUsage(m.usage ?? null)).catch(() => {}); }, []);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: 14 }}>
        <span className="spin" />
        <span className="t-sm dim">a ligar ao ARGOS…</span>
      </div>
    );
  }

  if (!appReady) {
    return (
      <LoadingScreen onComplete={() => { /* appReady will be set by effect */ }} />
    );
  }

  if (down && !publicTools.length) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div className="card" style={{ maxWidth: 400, textAlign: 'center' }}>
          <div className="empty-ico" style={{ margin: '0 auto 12px' }}><Icon.alert /></div>
          <h1 className="t-h2" style={{ marginBottom: 8 }}>Sem ligação</h1>
          <p className="t-sm muted">Não consigo falar com o servidor. Vê a rede e tenta outra vez.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} type="button" onClick={() => location.reload()}>recarregar</button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 16px 64px' }}>
        {down && <div className="offline">Sem ligação — a mostrar o que está em cache.</div>}
        <Landing onStart={() => document.getElementById('argus-auth')?.scrollIntoView({ behavior: 'smooth' })} tools={publicTools} />
        <div id="argus-auth" style={{ marginTop: 40 }}><Auth onDone={loadAll} /></div>
      </div>
    );
  }

  return (
    <>
      {down && <div className="offline">Sem ligação. Os resultados já carregados continuam visíveis.</div>}
      <AppShell
        user={user} tools={tools} usage={usage} view={view} setView={setView}
        refreshUser={refreshUser}
        onLogout={() => { api.logout().catch(() => {}); setUser(null); setTools([]); setView({ k: 'dashboard' }); }}
      />
    </>
  );
}

// O `ToastHost` tem de envolver a aplicação: sem ele o `useToast()` devolve a
// função vazia do contexto e TODOS os avisos (ficheiro grande, plano alterado,
// investigação apagada, chave guardada) desaparecem sem rasto. O utilizador
// ficava a carregar no botão sem nunca saber se a ação happened.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastHost>
        <App />
      </ToastHost>
    </ErrorBoundary>
  </StrictMode>,
);
