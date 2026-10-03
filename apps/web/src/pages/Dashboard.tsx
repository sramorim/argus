/**
 * Painel — o primeiro ecrã de quem entra.
 *
 * Não é um painel de administração: é a mesa de trabalho de quem vai
 * investigar. Por isso a ordem é deliberada:
 *
 *   1. a ação principal, em grande — começar uma investigação;
 *   2. o resto do trabalho (sessões recentes, histórico), resumido;
 *   3. as ferramentas por objetivo, para quando se sabe o que se procura.
 *
 * A regra que atravessa este ecrã: **mostrar o estado real**. Se não há
 * sessões, diz que não há. Se a cota acabou, diz que acabou. Não se enche a
 * página de cartões a competir entre si para parecer mais cheio.
 */
import { useEffect, useState, useRef } from 'react';
import type { ReactElement } from 'react';
import type { SVGProps } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { api, type ToolPublic, type Usage, type User, ApiError } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, Skeleton, SearchInput, useToast } from '../components/ui';
import { GRUPOS, porGrupo, buscar, ATALHOS, NOME_PLANO } from '../ia';
import type { View } from './AppShell';
import gsap from 'gsap';

interface Resumo {
  sessoes: { id: string; title: string; seed: string; updated_at: string; node_count?: number; edge_count?: number }[];
  historico: { id: string; tool_id: string; created_at: string; bytes: number }[];
  fontes: { total: number; ok: number } | null;
}

export default function Dashboard({
  user, tools, usage, setView,
}: {
  user: User; tools: ToolPublic[]; usage: Usage | null; setView: (v: View) => void;
}) {
  const [q, setQ] = useState('');
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState('');
  const toast = useToast();

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.investigations().then((r) => r.investigations).catch(() => []),
      api.history().then((r) => r.runs).catch(() => []),
      api.plans().then((r) => r.plans.length).catch(() => 0),
    ]).then(([sessoes, hist]) => {
      if (!vivo) return;
      setResumo({
        sessoes: sessoes.slice(0, 4) as Resumo['sessoes'],
        historico: hist.slice(0, 5),
        fontes: { total: hist.length, ok: hist.filter((h) => h.bytes > 0).length },
      });
    });
    return () => { vivo = false; };
  }, []);

  const restantes = usage ? Math.max(0, usage.daily - usage.today) : null;
  const encontrados = q.trim() ? buscar(tools, q) : tools;

  return (
    <div className="page">
      {/* ---------- 1. a ação principal ---------- */}
      <section className="hero-panel">
        <div className="hero-panel-txt">
          <span className="hero-kicker">INTELIGÊNCIA DE FONTES ABERTAS</span>
          <h1 className="t-h1" style={{ margin: '10px 0 6px' }}>
            Começa por um alvo. O ARGUS faz o resto.
          </h1>
          <p className="muted t-sm" style={{ maxWidth: '60ch', lineHeight: 1.64 }}>
            Um username, e-mail, telefone, domínio, IP, URL ou carteira.
            O ARGUS escolhe as ferramentas certas, cruza resultados e mostra
            <b style={{ color: 'var(--blue-3)' }}> a proveniência de cada achado</b>.
          </p>
        </div>
        <div className="hero-panel-cta">
          <motion.button
            className="btn btn-primary btn-lg"
            type="button"
            onClick={() => setView({ k: 'nova' })}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.995 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          >
            <Icon.target /> Nova investigação
          </motion.button>
              <button className="btn btn-lg" type="button" onClick={() => document.getElementById('ferramentas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            ver as {tools.length} ferramentas
          </button>
        </div>
      </section>

      {/* ---------- 2. estado real ---------- */}
      {erro && <div style={{ marginBottom: 'var(--s-4)' }}><Note kind="err">{erro}</Note></div>}

      <div className="grid grid-4" style={{ marginTop: 'var(--s-4)' }}>
        <StatCard
          rotulo="Cota de hoje"
          valor={`${usage?.today ?? 0}/${usage?.daily ?? 0}`}
          nota={restantes === 0 ? 'esgotada — volta amanhã' : `${restantes ?? 0} execuções restantes`}
          estado={restantes === 0 ? 'warn' : 'ok'}
          icone={Icon.activity}
        />
        <StatCard
          rotulo="Plano"
          valor={NOME_PLANO[user.plan]}
          nota={`${tools.filter((t) => t.lock === 'open').length} de ${tools.length} ferramentas abertas`}
          icone={Icon.crown}
        />
        <StatCard
          rotulo="Sessões guardadas"
          valor={resumo ? String(resumo.sessoes.length) : '—'}
          nota="investigações com grafo"
          icone={Icon.network}
        />
        <StatCard
          rotulo="Execuções"
          valor={resumo ? String(resumo.historico.length) : '—'}
          nota="no teu histórico"
          icone={Icon.history}
        />
      </div>

      {/* ---------- 2.5 o módulo independente ---------- */}
      {/* O OmniDork não é uma ferramenta do catálogo — não há servidor que o
          execute — por isso não entra no grid de ferramentas nem na busca:
          aparece uma vez, como módulo próprio, e abre na mesma janela de
          sempre. */}
      <section className="od-entry" aria-label="OmniDork Builder">
        <div className="od-entry-txt">
          <span className="od-kicker">OSINT QUERY MODULE</span>
          <div className="od-entry-title">OmniDork Builder</div>
          <p className="od-entry-sub">
            Monta a dork com <code className="od-code">filetype:</code>,{' '}
            <code className="od-code">site:</code> e <code className="od-code">inurl:</code>{' '}
            e entrega-a ao motor de busca numa separador nova. Corre no teu
            browser — sem custo de servidor e sem consulta a sair daqui.
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

      {/* ---------- 3. o trabalho a continuar ---------- */}
      <div className="grid grid-2" style={{ marginTop: 'var(--s-4)', alignItems: 'start' }}>
        <section className="card">
          <div className="card-head">
            Sessões recentes
            <span className="grow" />
            <div className="card-head-actions">
              <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'inv' })}>
                ver todas
              </button>
            </div>
          </div>
          {!resumo ? (
            <Skeleton lines={3} />
          ) : resumo.sessoes.length === 0 ? (
            <Empty icon={Icon.network} title="Ainda não investigaste nada">
              Corre a tua primeira investigação. O resultado fica guardado com o grafo
              inteiro, e relê-lo não gasta cota.
            </Empty>
          ) : (
            resumo.sessoes.map((s) => (
              <button
                key={s.id}
                className="list-row"
                type="button"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setView({ k: 'inv', id: s.id })}
              >
                <Icon.network width={15} height={15} style={{ color: 'var(--blue-3)' }} />
                <div className="grow">
                  <div className="t">{s.title}</div>
                  <div className="s" style={{ lineHeight: 1.58 }}>
                    {s.seed} · {s.node_count ?? 0} nós · {s.edge_count ?? 0} ligações ·{' '}
                    {new Date(s.updated_at).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <Icon.chevronRight width={14} height={14} style={{ color: 'var(--t-4)' }} />
              </button>
            ))
          )}
        </section>

        <section className="card">
          <div className="card-head">
            Atalhos
            <span className="grow" />
            <div className="card-head-actions">
              <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'history' })}>
                histórico
              </button>
            </div>
          </div>
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {ATALHOS.map((a) => {
              const t = tools.find((x) => x.id === a.id);
              if (!t || t.lock === 'locked') return null;
              return (
                <motion.button
                  key={a.id}
                  className="shortcut"
                  type="button"
                  onClick={() => setView({ k: 'tool', id: t.id })}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.995 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                >
                  <a.icon />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="sc-t">{a.nome}</div>
                    <div className="sc-x">{a.exemplo}</div>
                  </div>
                  <Icon.chevronRight width={14} height={14} style={{ color: 'var(--t-4)' }} />
                </motion.button>
              );
            })}
          </div>
        </section>
      </div>

      {/* ---------- 4. as ferramentas por objetivo ---------- */}
      <section className="section" id="ferramentas" style={{ marginTop: 'var(--s-6)' }}>
        <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="t-h2">Ferramentas</h2>
            <p className="t-sm muted" style={{ marginTop: 4, lineHeight: 1.64 }}>
              {tools.length} registadas, todas testadas com alvos reais antes de entrarem aqui.
            </p>
          </div>
        </div>

        <div style={{ marginBottom: 'var(--s-4)' }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Procurar ferramenta, alvo ou etiqueta… (ex.: username, domínio, DNS, telefone)"
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
                IP, username…) ou o que procuras (dns, telefone, reputação).
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
                      <div className="card-sub" style={{ lineHeight: 1.62 }}>{g.resumo}</div>
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
                          : <Icon.chevronRight width={13} height={13} style={{ color: 'var(--t-4)' }} />}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <AppFoot />
    </div>
  );
}

function CardFerramenta({ t, setView }: { t: ToolPublic; setView: (v: View) => void }) {
  return (
    <button
      className="tool-card"
      type="button"
      data-locked={t.lock === 'locked'}
      onClick={() => setView({ k: 'tool', id: t.id })}
    >
      <div className="tool-top">
        <span className="tool-name">{t.name}</span>
        <span className="spacer" />
        {t.lock === 'locked' ? <span className="tag tag-pro">PRO</span> : <span className="tag tag-free">GRÁTIS</span>}
      </div>
      <div className="tool-sum">{t.summary}</div>
    </button>
  );
}

function StatCard({
  rotulo, valor, nota, icone: Ico, estado,
}: {
  rotulo: string; valor: string; nota: string;
  icone: (p: SVGProps<SVGSVGElement>) => ReactElement; estado?: 'ok' | 'warn';
}) {
  const numRef = useRef<HTMLSpanElement>(null);
  const valorNum = Number(valor.split('/')[0]) || 0;
  const cor = estado === 'warn' ? 'var(--aviso)' : estado === 'ok' ? 'var(--blue-3)' : 'var(--t-3)';
  const suave = useReducedMotion();

  /* O número começa a zero no DOM de propósito. Antes escrevia-se já o valor
     final e o gsap punha-o a zero um instante depois: o número aparecia, era
     reposto a 0 e voltava a contar — via-se isso duas vezes. */
  useEffect(() => {
    const el = numRef.current;
    if (!el || suave) { if (el) el.textContent = String(valorNum); return; }
    el.textContent = '0';
    const tween = gsap.fromTo(el,
      { innerText: 0 },
      { innerText: valorNum, duration: 1.1, snap: { innerText: 1 }, ease: 'power2.out', overwrite: true }
    );
    return () => { tween.kill(); };
  }, [valorNum, suave]);

  return (
    <div className="card" style={{ padding: 'var(--s-4)' }}>
      <div className="row-tight" style={{ marginBottom: 7 }}>
        <Ico width={14} height={14} style={{ color: cor }} />
        <span className="tnum">{rotulo}</span>
      </div>
      <div className="v" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.15 }}>
        <span ref={numRef} className="num">0</span>{valor.includes('/') ? `/${valor.split('/')[1]}` : ''}
      </div>
      <div className="t-xs dim" style={{ marginTop: 3 }}>{nota}</div>
    </div>
  );
}

/** Rodapé da aplicação. Canais só quando existem — não se inventam URLs. */
export function AppFoot() {
  const [wa, setWa] = useState<{ label: string; link: string; autor: string; copyright: string } | null>(null);
  useEffect(() => { api.contacto().then(setWa).catch(() => {}); }, []);
  return (
    <footer className="appfoot">
      <span>
        {wa?.copyright ?? '© 2026 SR. Amorim'} · Todos os direitos reservados.
      </span>
      <span className="appfoot-links">
        {wa && <a href={wa.link} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        <a href="https://github.com/sramorim/argus" target="_blank" rel="noopener noreferrer">Código</a>
      </span>
    </footer>
  );
}
