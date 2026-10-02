/**
 * Espaço de trabalho do ARGOS.
 *
 * A aplicação é uma **área de trabalho**, não uma pilha de páginas: barra no
 * topo, ícones agrupados pelo que se quer fazer, e ferramentas que abrem em
 * **janelas** que se arrastam, redimensionam, minimizam e fecham. Ter o
 * domínio e o IP abertos ao mesmo tempo é metade do que uma investigação
 * precisa — em páginas que se substituem, comparar dois alvos obriga a andar
 * para trás a perder o que se tinha escrito.
 *
 * Três decisões que ficam da versão anterior e continuam a valer:
 *
 * 1. **A organização continua a vir do `ia.ts`.** Os ícones agrupam-se pelos
 *    mesmos grupos que a sidebar usava; nada aqui inventa ordem nem categoria.
 * 2. **O primeiro ecrã continua a ser o painel.** Quem entra quer investigar,
 *    não ler um índice: a janela do painel abre sozinha.
 * 3. **Telemóvel não é um desktop ao pequenino.** Abaixo de 1001px as janelas
 *    ocupam a área toda, a navegação é a gaveta com as camadas e a barra
 *    inferior de quatro destinos — a visibilidade disto é do CSS, nunca de uma
 *    medida do browser lida durante o render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SVGProps } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { type ToolPublic, type Usage, type User, useContacto } from '../api';
import { Icon, CATEGORY_ICON, CATEGORY_LABEL } from '../components/Icons';
import Janela, { type Geom } from '../components/Janela';
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
import Health from './Health';
import Radar from './Radar';
import Perfil from './Perfil';
import Definicoes from './Definicoes';

export type View =
  | { k: 'dashboard' } | { k: 'nova' }
  | { k: 'tool'; id: string } | { k: 'inv' } | { k: 'inv'; id: string }
  | { k: 'plans' } | { k: 'keys' } | { k: 'account' } | { k: 'admin' } | { k: 'history' }
  | { k: 'health' } | { k: 'radar' } | { k: 'perfil' } | { k: 'definicoes' };

/** Os 4 destinos da barra inferior. Escolha: o que se usa a toda a hora. */
const TABS: { v: View; id: string; label: string; icon: (p: Record<string, unknown>) => ReactElement }[] = [
  { v: { k: 'dashboard' }, id: 'dashboard', label: 'Painel', icon: Icon.grid },
  { v: { k: 'nova' }, id: 'nova', label: 'Investigar', icon: Icon.target },
  { v: { k: 'inv' }, id: 'inv', label: 'Sessões', icon: Icon.network },
  { v: { k: 'account' }, id: 'account', label: 'Conta', icon: Icon.user },
];

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

/** Identidade de uma vista: é o que liga a rota, a janela e a barra de tarefas. */
function chave(v: View): string {
  switch (v.k) {
    case 'tool': return `tool:${(v as { id: string }).id}`;
    case 'inv': return `inv:${(v as { id?: string }).id ?? ''}`;
    default: return v.k;
  }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface Aberta {
  vista: View;
  geom: Geom;
  max: boolean;
  min: boolean;
}

export default function AppShell({
  user, tools, usage, view, setView, onLogout, refreshUser,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null;
  view: View; setView: (v: View) => void; onLogout: () => void; refreshUser: () => void;
}) {
  const [drawer, setDrawer] = useState(false);
  const [fabAberto, setFabAberto] = useState(false);
  const wa = useContacto();
  /* Uma só decisão para todo o ecrã: se o sistema pede menos movimento, as
     molas daqui abaixo desaparecem todas. */
  const suave = useReducedMotion();
  const areaRef = useRef<HTMLElement | null>(null);
  const espacoRef = useRef({ w: 1200, h: 760 });
  const [espaco, setEspaco] = useState({ w: 1200, h: 760 });

  /** Janelas abertas e a ordem em que estão (o fim é o topo). */
  const [abertas, setAbertas] = useState<Record<string, Aberta>>({});
  const [ordem, setOrdem] = useState<string[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);

  /** Relógio da barra superior — só muda de estado de 30 em 30 segundos. */
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * A área de trabalho encolhe com o ecrã e é ela que define até onde uma
   * janela pode andar. Mede-se o próprio elemento, não a janela do browser.
   */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const medir = () => {
      const w = el.clientWidth || espacoRef.current.w;
      const h = el.clientHeight || espacoRef.current.h;
      espacoRef.current = { w, h };
      setEspaco((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const abrir = useCallback((v: View) => {
    const k = chave(v);
    setAbertas((prev) => {
      if (prev[k]) return prev[k]?.min ? { ...prev, [k]: { ...prev[k], min: false } } : prev;
      const { w: aw, h: ah } = espacoRef.current;
      const n = Object.keys(prev).length;
      const w = clamp(Math.min(1060, aw - 90), 520, Math.max(520, aw));
      const h = clamp(Math.min(740, ah - 70), 360, Math.max(360, ah));
      const geom: Geom = {
        x: clamp(24 + n * 28, 0, Math.max(0, aw - w)),
        y: clamp(16 + n * 24, 0, Math.max(0, ah - h)),
        w, h,
      };
      // A investigação é a vista que pede ecrã inteiro: é um grafo, não um formulário.
      return { ...prev, [k]: { vista: v, geom, max: v.k === 'nova', min: false } };
    });
    setOrdem((o) => [...o.filter((x) => x !== k), k]);
    setAtiva(k);
  }, []);

  const focar = useCallback((k: string, sincronizar = true) => {
    setOrdem((o) => (o[o.length - 1] === k ? o : [...o.filter((x) => x !== k), k]));
    setAtiva(k);
    setAbertas((prev) => (prev[k]?.min ? { ...prev, [k]: { ...prev[k], min: false } } : prev));
    if (sincronizar) {
      const v = abertas[k]?.vista;
      if (v) setView(v);
    }
  }, [abertas, setView]);

  /** Fecha: a janela sai de cima, o foco desce para a que estava por baixo. */
  const fechar = useCallback((k: string) => {
    const resto = ordem.filter((x) => x !== k);
    const proximo = resto[resto.length - 1] ?? null;
    setAbertas((prev) => {
      const { [k]: _sai, ...r } = prev;
      return r;
    });
    setOrdem(resto);
    setAtiva((a) => (a === k ? proximo : a));
    const v = proximo ? abertas[proximo]?.vista : undefined;
    if (v) setView(v);
  }, [ordem, abertas, setView]);

  const alternarMin = useCallback((k: string) => {
    setAbertas((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], min: !prev[k].min } } : prev));
    // Minimizar entrega o foco à janela que estava por baixo — deixa de haver
    // nenhuma ativa só quando não sobra nenhuma por restaurar.
    setAtiva((a) => {
      if (a !== k) return a;
      const i = ordem.indexOf(k);
      return ordem.slice(0, i).pop() ?? null;
    });
  }, [ordem]);

  const alternarMax = useCallback((k: string) => {
    setAbertas((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], max: !prev[k].max } } : prev));
    focar(k, false);
  }, [focar]);

  const porGeom = useCallback((k: string, geom: Geom) => {
    setAbertas((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], geom } } : prev));
  }, []);

  /** A rota também muda por fora (botão do browser, link direto). */
  const ultima = useRef<string | null>(null);

  /** Navegar = mudar a rota **e** abrir a janela que lhe corresponde. */
  const go = useCallback((v: View) => {
    ultima.current = chave(v);
    setView(v);
    abrir(v);
    setDrawer(false);
  }, [abrir, setView]);
  useEffect(() => {
    const k = chave(view);
    if (ultima.current === k) return;
    ultima.current = k;
    abrir(view);
  }, [view, abrir]);

  /**
   * Quais grupos estão abertos na gaveta. Por omissão, só o grupo da ferramenta
   * aberta — é o que impede a gaveta de ser uma parede de texto.
   */
  const grupoDaFerramenta = useMemo(() => {
    if (view.k !== 'tool') return null;
    return GRUPOS.find((g) => g.ferramentas.includes((view as { id: string }).id))?.id ?? null;
  }, [view]);

  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(grupoDaFerramenta ? [grupoDaFerramenta] : ['investigar']));

  useEffect(() => {
    if (!grupoDaFerramenta) return;
    setAbertos((s) => (s.has(grupoDaFerramenta) ? s : new Set([...s, grupoDaFerramenta])));
  }, [grupoDaFerramenta]);

  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawer]);

  /* O menu do botão flutuante é um menu: Escape fecha, e voltar a abrir a
     gaveta fecha-o, para os dois nunca ficarem abertos um por cima do outro. */
  useEffect(() => {
    if (!fabAberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFabAberto(false); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [fabAberto]);

  useEffect(() => { if (drawer) setFabAberto(false); }, [drawer]);

  const alternar = (id: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const pct = usage?.daily ? Math.min(100, (usage.today / usage.daily) * 100) : 0;
  const esgotada = usage ? usage.today >= usage.daily : false;
  const visivel = (id: string) => (user.isAdmin ? true : id !== 'admin');
  const apps = VISTAS.filter((v) => visivel(v.id));

  const iconeDe = (v: View): ((p: SVGProps<SVGSVGElement>) => ReactElement) => {
    if (v.k === 'tool') {
      const t = tools.find((x) => x.id === (v as { id: string }).id);
      return CATEGORY_ICON[t?.category ?? ''] ?? Icon.grid;
    }
    return VISTAS.find((x) => x.id === v.k)?.icon ?? Icon.grid;
  };

  const tituloDe = (v: View): string => {
    switch (v.k) {
      case 'dashboard': return 'Painel';
      case 'nova': return 'Nova investigação';
      case 'tool': return tools.find((t) => t.id === (v as { id: string }).id)?.name ?? 'Ferramenta';
      case 'inv': return (v as { id?: string }).id ? 'Sessão' : 'Sessões';
      case 'plans': return 'Planos';
      case 'keys': return 'Chaves API';
      case 'account': return 'Conta';
      case 'admin': return 'Administração';
      case 'history': return 'Histórico';
      case 'health': return 'System Health';
      case 'radar': return 'Presence Radar';
      case 'perfil': return 'Unified Profile';
      case 'definicoes': return 'Definições';
      default: return 'ARGOS';
    }
  };

  const conteudo = (v: View): React.ReactNode => {
    switch (v.k) {
      case 'dashboard': return <Dashboard user={user} tools={tools} usage={usage} setView={go} />;
      case 'nova': return <ToolPage id="graph-investigation" tools={tools} onUsage={refreshUser} comoAlvo />;
      case 'tool': return <ToolPage id={(v as { id: string }).id} tools={tools} onUsage={refreshUser} />;
      case 'inv': return <Investigations view={v as { id?: string }} setView={go} />;
      case 'plans': return <Plans user={user} />;
      case 'keys': return <Keys />;
      case 'account': return <Account user={user} onLogout={onLogout} />;
      case 'admin': return <Admin />;
      case 'history': return <History setView={go} />;
      case 'health': return <Health />;
      case 'radar': return <Radar setView={go} />;
      case 'perfil': return <Perfil setView={go} />;
      case 'definicoes': return <Definicoes user={user} usage={usage} setView={go} />;
      default: return null;
    }
  };

  const data = agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const inicial = (user.name || user.email || '?').trim().slice(0, 1).toUpperCase();

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
          {apps.map((v) => (
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
              {/* O corpo da camada é medido pelo próprio framer: sem isto o
                  conteúdo salta de 0 para a altura final. */}
              <AnimatePresence initial={false}>
                {aberto && (
                  <motion.div
                    key="corpo"
                    className="layer-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={suave
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 260, damping: 26, mass: 0.6 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div>
                      <div className="layer-inner">
                        {lista.map((t) => {
                          const Cat = CATEGORY_ICON[t.category] ?? Icon.grid;
                          return (
                            <motion.button
                              key={t.id}
                              className="nav-item"
                              type="button"
                              aria-current={view.k === 'tool' && (view as { id: string }).id === t.id}
                              onClick={() => go({ k: 'tool', id: t.id })}
                              title={t.summary}
                              whileHover={{ x: 4 }}
                              whileTap={{ scale: 0.97 }}
                              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            >
                              <Cat className="nav-ico" />
                              <span className="nav-label-txt">{t.name}</span>
                              {t.lock === 'locked' && <Icon.lock width={12} height={12} style={{ color: 'var(--t-4)' }} />}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
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

  return (
    <div className="shell">
      {/* ---------------------------------------------------------- barra superior */}
      <header className="topbar">
        <button className="icon-btn only-narrow" onClick={() => setDrawer(true)} aria-label="Abrir menu" type="button">
          <Icon.menu />
        </button>
        <motion.button
          className="topbar-brand"
          type="button"
          onClick={() => go({ k: 'dashboard' })}
          title="Painel"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <Brand />
        </motion.button>
        <div className="topbar-clock only-desk">
          <Icon.clock />
          <span className="topbar-data">{data}</span>
          <span className="topbar-sep">·</span>
          <span className="topbar-hora">{hora}</span>
        </div>
        <span className="grow" />
        {esgotada && <span className="tag tag-warn only-desk">cota esgotada</span>}
        {!esgotada && usage && (
          <span className="topbar-quota only-desk">{usage.daily - usage.today} execuções hoje</span>
        )}
        <nav className="topbar-links only-desk" aria-label="Atalhos">
          <motion.button
            className="topbar-link"
            type="button"
            onClick={() => go({ k: 'inv' })}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          >Sessões</motion.button>
          <motion.button
            className="topbar-link"
            type="button"
            onClick={() => go({ k: 'history' })}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          >Histórico</motion.button>
          <motion.button
            className="topbar-link"
            type="button"
            onClick={() => go({ k: 'plans' })}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          >Planos</motion.button>
        </nav>
        <details className="user-menu">
          <summary className="avatar" title={user.email}>{inicial}</summary>
          <div className="user-pop">
            <div className="user-pop-head">
              <div className="user-pop-name">{user.name || user.email}</div>
              <div className="user-pop-mail">{user.email}</div>
            </div>
            {apps.map((v) => (
              <motion.button
                key={v.id}
                className="user-pop-item"
                type="button"
                onClick={() => go({ k: v.id } as View)}
                whileHover={{ x: 4 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <v.icon /> {v.nome}
              </motion.button>
            ))}
            <motion.button
              className="user-pop-item"
              type="button"
              onClick={onLogout}
              whileHover={{ x: 4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <Icon.logout /> Sair
            </motion.button>
          </div>
        </details>
      </header>

      {/* ------------------------------------------------------- área de trabalho */}
      <main className="desktop" ref={areaRef}>
        <div className="desk-icons">
          <section className="desk-group">
            <h2 className="desk-title">Aplicação</h2>
            <div className="desk-row">
              {apps.map((v, i) => (
                <motion.button
                  key={v.id}
                  className="desk-icon"
                  type="button"
                  onClick={() => go({ k: v.id } as View)}
                  data-aberta={ordem.includes(chave({ k: v.id } as View))}
                  initial={{ opacity: 0, y: 14, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    type: 'spring', stiffness: 260, damping: 22, mass: 0.5,
                    delay: 0.05 + i * 0.022,
                  }}
                  whileHover={{ scale: 1.06, y: -5 }}
                  whileTap={{ scale: 0.94 }}
                >
                  <span className="desk-ico"><v.icon /></span>
                  <span className="desk-label">{v.nome}</span>
                </motion.button>
              ))}
            </div>
          </section>

          {GRUPOS.map((g) => {
            const lista = porGrupo(tools, g.id);
            if (!lista.length) return null;
            const Ico = g.icon;
            return (
              <section className="desk-group" key={g.id}>
                <h2 className="desk-title"><Ico /> {g.nome}</h2>
                <div className="desk-row">
                  {lista.map((t, i) => {
                    const Cat = CATEGORY_ICON[t.category] ?? Icon.grid;
                    const k = chave({ k: 'tool', id: t.id });
                    return (
                      <motion.button
                        key={t.id}
                        className="desk-icon"
                        type="button"
                        title={t.summary}
                        data-tool={t.id}
                        data-aberta={ordem.includes(k)}
                        onClick={() => go({ k: 'tool', id: t.id })}
                        initial={{ opacity: 0, y: 14, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                          type: 'spring', stiffness: 260, damping: 22, mass: 0.5,
                          delay: 0.05 + i * 0.018,
                        }}
                        whileHover={{ scale: 1.06, y: -5 }}
                        whileTap={{ scale: 0.94 }}
                      >
                        <span className="desk-ico"><Cat /></span>
                        <span className="desk-label">{t.name}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <AnimatePresence>
          {ordem.length === 0 && (
            <motion.div
              className="desk-hint"
              key="dica"
              initial={{ opacity: 0, y: 22, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 140, damping: 18, delay: 0.35 }}
            >
              <Icon.target />
              <p className="t-sm">Escolhe um ícone para abrir uma ferramenta. Várias podem ficar abertas ao mesmo tempo.</p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {ordem.map((k, i) => {
            const j = abertas[k];
            if (!j) return null;
            return (
              <Janela
                key={k}
                titulo={tituloDe(j.vista)}
                icone={iconeDe(j.vista)}
                geom={j.geom}
                espaco={espaco}
                z={20 + i}
                ativa={ativa === k}
                max={j.max}
                min={j.min}
                onFocar={() => focar(k)}
                onFechar={() => fechar(k)}
                onMin={() => alternarMin(k)}
                onMax={() => alternarMax(k)}
                onGeom={(g) => porGeom(k, g)}
              >
                {conteudo(j.vista)}
              </Janela>
            );
          })}
        </AnimatePresence>
      </main>

      {/* ------------------------------------------------------------- barra de tarefas */}
      <footer className="taskbar only-desk">
        <div className="task-list">
          <AnimatePresence initial={false} mode="popLayout">
            {ordem.map((k) => {
              const j = abertas[k];
              if (!j) return null;
              const Ico = iconeDe(j.vista);
              return (
                <motion.button
                  key={k}
                  className="task-item"
                  type="button"
                  layout
                  data-ativa={ativa === k && !j.min ? 'true' : 'false'}
                  onClick={() => focar(k)}
                  title={tituloDe(j.vista)}
                  initial={{ opacity: 0, scale: 0.7, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.7, y: 14 }}
                  whileHover={{ scale: 1.06, y: -3 }}
                  whileTap={{ scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                >
                  <Ico /> <span className="task-name">{tituloDe(j.vista)}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
        <span className="grow" />
        {usage && <span className="task-quota">{usage.today}/{usage.daily}</span>}
        <span className="task-copy">{wa?.copyright ?? '© 2026 SR. Amorim'} · Todos os direitos reservados.</span>
      </footer>

      {/* ------------------------------------------------------------ canal de contacto */}
      <div className="dock only-desk" aria-label="Contacto">
        {wa && (
          <motion.a
            className="dock-btn"
            href={wa.link}
            target="_blank"
            rel="noopener noreferrer"
            title={wa.label}
            aria-label={wa.label}
            whileHover={{ scale: 1.16, y: -6 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <Icon.phone />
          </motion.a>
        )}
        <motion.a
          className="dock-btn"
          href="https://github.com/sramorim/argus"
          target="_blank"
          rel="noopener noreferrer"
          title="Código-fonte"
          aria-label="Código-fonte"
          whileHover={{ scale: 1.16, y: -6 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
        >
          <Icon.code />
        </motion.a>
      </div>

      {/* -------------------------------------------------------------- gaveta (estreito) */}
      {/* A gaveta nascia instantânea. Sem `AnimatePresence` o `data-open`
          desligava a transform do CSS no mesmo frame e o slide nunca via-se. */}
      <AnimatePresence>
        {drawer && (
          <motion.aside
            key="gaveta"
            className="sidebar"
            data-open={drawer}
            initial={suave ? { opacity: 0 } : { x: '-100%', opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={suave ? { opacity: 0 } : { x: '-100%', opacity: 0.4 }}
            transition={suave
              ? { duration: 0 }
              : { type: 'spring', stiffness: 240, damping: 28, mass: 0.8 }}
          >
            <Brand />
            {conteudoLateral}
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {drawer && (
          <motion.div
            key="scrim"
            className="side-scrim"
            onClick={() => setDrawer(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <nav className="tabbar" aria-label="Navegação principal">
        {TABS.map((t) => (
          <motion.button
            key={t.id}
            className="tab"
            type="button"
            aria-current={view.k === t.v.k}
            onClick={() => go(t.v)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          >
            <motion.span
              className="tab-ico"
              animate={{ scale: view.k === t.v.k ? 1.12 : 1, rotate: view.k === t.v.k ? -4 : 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            >
              <t.icon />
            </motion.span>
            {t.label}
          </motion.button>
        ))}
      </nav>

      {/* ------------------------------------------------------------------ atalho rápido */}
      {/* O botão flutuante é o caminho de um clique para o que se faz a toda a
          hora. Abre para cima, sobre a barra de tarefas, e fecha-se sozinho com
          Escape — é um menu, e um menu que fica aberto a tapar o ecrã é pior
          do que não o ter. */}
      <div className="fab-wrap">
        <AnimatePresence>
          {fabAberto && (
            <motion.div
              className="fab-menu"
              key="menu"
              initial={{ opacity: 0, scale: 0.7, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.7, y: 16 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26, mass: 0.6 }}
            >
              {ATALHOS.map((a, i) => {
                const v: View = { k: 'tool', id: a.id };
                return (
                  <motion.button
                    key={a.id}
                    className="fab-item"
                    type="button"
                    title={a.nome}
                    onClick={() => { go(v); setFabAberto(false); }}
                    initial={{ opacity: 0, y: 12, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.8 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28, delay: i * 0.03 }}
                    whileHover={{ scale: 1.07, x: -3 }}
                    whileTap={{ scale: 0.94 }}
                  >
                    {a.icon({})}
                    <span>{a.nome}</span>
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          className="fab"
          type="button"
          aria-label={fabAberto ? 'Fechar atalhos' : 'Abrir atalhos'}
          aria-expanded={fabAberto}
          onClick={() => setFabAberto((a) => !a)}
          animate={{ rotate: fabAberto ? 135 : 0 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 340, damping: 24 }}
        >
          <span className="animate-spin-slow fab-anel" aria-hidden />
          <span className="animate-fab-glow fab-nucleo" aria-hidden>
            <Icon.plus />
          </span>
        </motion.button>
      </div>
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
