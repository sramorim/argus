/**
 * Área DM — painel exclusivo do dono do ARGOS.
 *
 * Centraliza tudo o que o dono precisa no dia a dia: aprovar Pix, gerir
 * planos, ver o estado do serviço e (futuro) editar layout. Visível apenas
 * para administradores, é a porta de entrada rápida sem precisar navegar
 * pelos menus dispersos.
 *
 * As APIs são as mesmas do Admin.tsx — a diferença é a organização: aqui
 * a informação crítica (Pix pendente, resumo do serviço) aparece primeiro,
 * com ações de um toque.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type PixIntent, type PlanId, ApiError, PLAN_NAME } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, SearchInput, Skeleton, useToast } from '../components/ui';
import { NOME_PLANO } from '../ia';

/* --------------------------------------------------------- layout editor */

type LayoutStatus = 'pendente' | 'manter' | 'remover' | 'melhorar' | 'implementar';

interface LayoutItem {
  id: string;
  nome: string;
  area: string;
  status: LayoutStatus;
  nota: string;
}

interface LayoutArea {
  id: string;
  nome: string;
  itens: { id: string; nome: string }[];
}

const LAYOUT_AREAS: LayoutArea[] = [
  {
    id: 'nav', nome: 'Navegação',
    itens: [
      { id: 'nav-sidebar', nome: 'Sidebar (desktop)' },
      { id: 'nav-drawer', nome: 'Gaveta lateral (mobile)' },
      { id: 'nav-bottombar', nome: 'Barra inferior (mobile)' },
      { id: 'nav-header', nome: 'Cabeçalho / Barra superior' },
      { id: 'nav-brand', nome: 'Logo / Marca ARGOS' },
      { id: 'nav-user-menu', nome: 'Menu do utilizador (avatar)' },
    ],
  },
  {
    id: 'dashboard', nome: 'Painel (Dashboard)',
    itens: [
      { id: 'dash-banner', nome: 'Banner / Hero' },
      { id: 'dash-stats', nome: '4 indicadores (investigações, ferramentas, execuções, hoje)' },
      { id: 'dash-mapa', nome: 'Mapa de Conexões' },
      { id: 'dash-globo', nome: 'Globo 3D' },
      { id: 'dash-perfis', nome: 'Perfis analisados' },
      { id: 'dash-atividade', nome: 'Atividade recente' },
      { id: 'dash-fontes', nome: 'Fontes monitoradas' },
      { id: 'dash-busca', nome: 'Barra de busca' },
      { id: 'dash-atalhos', nome: 'Atalhos rápidos' },
    ],
  },
  {
    id: 'ferramentas', nome: 'Ferramentas OSINT',
    itens: [
      { id: 'tool-username-finder', nome: 'Username Finder' },
      { id: 'tool-username-intel', nome: 'Username Intel' },
      { id: 'tool-email-intel', nome: 'Email Intel' },
      { id: 'tool-phone-intel', nome: 'Phone Intel' },
      { id: 'tool-social-search', nome: 'Social Search' },
      { id: 'tool-telegram-intel', nome: 'Telegram Intel' },
      { id: 'tool-social-presence', nome: 'Social Presence (socialscan)' },
      { id: 'tool-domain-infra', nome: 'Domain Infra (RDAP/DNS/CT)' },
      { id: 'tool-paste-search', nome: 'Paste Search' },
      { id: 'tool-graph-investigation', nome: 'Graph Investigation' },
    ],
  },
  {
    id: 'vistas', nome: 'Páginas / Vistas',
    itens: [
      { id: 'vista-nova', nome: 'Nova Investigação' },
      { id: 'vista-inv', nome: 'Investigações (lista)' },
      { id: 'vista-history', nome: 'Histórico' },
      { id: 'vista-health', nome: 'Estado do Sistema' },
      { id: 'vista-radar', nome: 'Radar de Presença' },
      { id: 'vista-perfil', nome: 'Perfil Unificado' },
      { id: 'vista-plans', nome: 'Planos & Preços' },
      { id: 'vista-account', nome: 'Conta do utilizador' },
      { id: 'vista-definicoes', nome: 'Definições' },
      { id: 'vista-admin', nome: 'Administração' },
      { id: 'vista-dm', nome: 'Área DM' },
    ],
  },
  {
    id: 'componentes', nome: 'Componentes gerais',
    itens: [
      { id: 'comp-footer', nome: 'Rodapé / Canais oficiais' },
      { id: 'comp-janela', nome: 'Sistema de janelas (Janela)' },
      { id: 'comp-modal', nome: 'Modais / Popups' },
      { id: 'comp-toasts', nome: 'Notificações (toasts)' },
      { id: 'comp-plan-tag', nome: 'Etiquetas de plano (Free/Pro/Pro Max)' },
      { id: 'comp-skeleton', nome: 'Carregamento (skeletons)' },
      { id: 'comp-empty', nome: 'Estados vazios' },
    ],
  },
  {
    id: 'estilo', nome: 'Estilo & Tema',
    itens: [
      { id: 'style-cores', nome: 'Paleta de cores (azul marinho, vermelho, etc.)' },
      { id: 'style-fontes', nome: 'Tipografia (Inter, Montserrat, JetBrains)' },
      { id: 'style-icones', nome: 'Ícones' },
      { id: 'style-spacing', nome: 'Espaçamentos & bordas' },
      { id: 'style-animacoes', nome: 'Animações (framer-motion)' },
    ],
  },
];

const STATUS_LABELS: Record<LayoutStatus, { label: string; cor: string; emoji: string }> = {
  pendente:    { label: 'Pendente',    cor: 'var(--t-3)',    emoji: '⏳' },
  manter:      { label: 'Manter',      cor: '#22c55e',      emoji: '✅' },
  remover:     { label: 'Remover',     cor: '#ef4444',      emoji: '🗑️' },
  melhorar:    { label: 'Melhorar',    cor: '#f59e0b',      emoji: '🔧' },
  implementar: { label: 'Implementar', cor: '#3b82f6',      emoji: '🆕' },
};

const STORAGE_KEY = 'argos_dm_layout_v1';

function loadLayout(): LayoutItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  // gera estado padrão
  return LAYOUT_AREAS.flatMap(a =>
    a.itens.map(i => ({ id: i.id, nome: i.nome, area: a.id, status: 'pendente' as LayoutStatus, nota: '' }))
  );
}

function saveLayout(items: LayoutItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* noop */ }
}

/* ------------------------------------------------------------------ tipos */

interface AdminUser {
  id: string; email: string; name: string; plan: PlanId;
  is_admin: number; suspended: number; created_at: string;
  role?: string; plan_expires?: string | null;
}
interface AdminState {
  users: AdminUser[]; nUsers: number; nRuns: number; nInvs: number; hoje: number;
  plans: { id: PlanId; name: string }[]; db: { path: string; writable: boolean };
}

type Aba = 'resumo' | 'pix' | 'usuarios' | 'layout';

/* --------------------------------------------------------------- helpers */

const fmt = (n: number) => n.toLocaleString('pt-BR');
const dtBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const dtHoraBR = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/* ============================================================ componente */

export default function DM() {
  const [aba, setAba] = useState<Aba>('resumo');
  const [st, setSt] = useState<AdminState | null>(null);
  const [pix, setPix] = useState<PixIntent[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [state, pixRes] = await Promise.all([api.admin(), api.adminPixIntents()]);
      setSt(state);
      setPix(pixRes.intents);
      setErr('');
    } catch (e) { setErr((e as ApiError).message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ----------------------------------------------------------- ações Pix */
  const aprovarPix = async (intent: PixIntent) => {
    try {
      await api.adminApprovePixIntent(intent.id);
      toast('ok', `Pro liberado para ${intent.email}.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };
  const dispensarPix = async (intent: PixIntent) => {
    try {
      await api.adminDismissPixIntent(intent.id);
      toast('ok', `Aviso Pix de ${intent.email} arquivado.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };

  /* ------------------------------------------------------- ações usuário */
  const promoverPro = async (id: string, email: string) => {
    try {
      await api.adminSetPlan(id, 'pro', true, null);
      toast('ok', `PRO vitalício ativado para ${email}.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };
  const rebaixarFree = async (id: string, email: string) => {
    try {
      await api.adminSetPlan(id, 'free', true);
      toast('ok', `${email} voltou para Free.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };
  const toggleFlag = async (id: string, flags: { isAdmin?: boolean; suspended?: boolean }) => {
    try { await api.adminSetFlags(id, flags); toast('ok', 'Atualizado.'); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };
  const excluir = async (id: string, email: string) => {
    if (!window.confirm(`Excluir a conta ${email}? Isto apaga investigações, histórico — não pode ser desfeito.`)) return;
    try { await api.adminDeleteUser(id); toast('ok', `${email} excluída.`); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };
  const setPlan = async (id: string, plan: PlanId) => {
    try { await api.adminSetPlan(id, plan, true); toast('ok', `Plano → ${PLAN_NAME[plan]}, cota reiniciada.`); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  /* --------------------------------------------------------- filtro user */
  const users = (st?.users ?? []).filter((u) => {
    const n = q.trim().toLowerCase();
    return !n || u.email.toLowerCase().includes(n) || u.name.toLowerCase().includes(n);
  });

  /* ================================================================ abas */

  const ABAS: { id: Aba; label: string; icon: (p: Record<string, unknown>) => React.ReactElement; badge?: number }[] = [
    { id: 'resumo', label: 'Resumo', icon: Icon.grid },
    { id: 'pix', label: 'Pix', icon: Icon.coins, badge: pix.length || undefined },
    { id: 'usuarios', label: 'Usuários', icon: Icon.user },
    { id: 'layout', label: 'Layout', icon: Icon.layers },
  ];

  /* ========================================================== renderizar */

  return (
    <div className="page page-wide">
      {/* Cabeçalho */}
      <header className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="t-h1" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon.crown width={24} height={24} style={{ color: 'var(--blue)' }} />
            Área DM
          </h1>
          <p className="t-sm muted" style={{ marginTop: 4 }}>
            Painel exclusivo do dono — gestão completa do ARGOS.
          </p>
        </div>
      </header>

      {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}

      {/* Navegação por abas */}
      <nav className="dm-tabs" role="tablist" style={{
        display: 'flex', gap: 4, marginBottom: 16,
        background: 'var(--surface)', borderRadius: 10, padding: 4,
        border: '1px solid var(--line)',
      }}>
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            className={`btn btn-sm ${aba === a.id ? 'btn-primary' : 'btn-quiet'}`}
            onClick={() => setAba(a.id)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative' }}
          >
            <a.icon width={16} height={16} />
            <span>{a.label}</span>
            {a.badge ? (
              <span style={{
                background: 'var(--erro)', color: '#fff', borderRadius: 99, fontSize: 11,
                fontWeight: 700, minWidth: 18, height: 18, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', padding: '0 5px',
              }}>{a.badge}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {!st ? <div className="card"><Skeleton lines={8} /></div> : (
        <>
          {/* ====================================================== RESUMO */}
          {aba === 'resumo' && (
            <>
              {/* Cards de estatística */}
              <div className="card">
                <div className="card-head">Estado do serviço</div>
                <div className="stat-row">
                  <div><div className="v num">{fmt(st.nUsers)}</div><div className="l">contas</div></div>
                  <div><div className="v num">{fmt(st.nRuns)}</div><div className="l">execuções</div></div>
                  <div><div className="v num">{fmt(st.nInvs)}</div><div className="l">investigações</div></div>
                  <div><div className="v num">{fmt(st.hoje)}</div><div className="l">hoje</div></div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <Note kind={st.db.writable ? 'ok' : 'err'}>
                    BD: <span className="mono t-xs">{st.db.path}</span> —{' '}
                    {st.db.writable ? 'com escrita ✓' : 'SEM ESCRITA — dados em perigo'}
                  </Note>
                </div>
              </div>

              {/* Pix pendentes — visão rápida */}
              {pix.length > 0 && (
                <div className="card" style={{ borderLeft: '3px solid var(--erro)' }}>
                  <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon.coins width={18} height={18} style={{ color: 'var(--erro)' }} />
                    {pix.length} Pix pendente{pix.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {pix.slice(0, 3).map((p) => (
                      <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        padding: '8px 12px', background: 'var(--surface)', borderRadius: 8,
                      }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <strong>{p.name}</strong>
                          <div className="t-xs dim">{p.email} · R$ {p.amount_brl.toFixed(2).replace('.', ',')}</div>
                        </div>
                        <button className="btn btn-sm btn-primary" onClick={() => aprovarPix(p)}>
                          <Icon.check width={14} height={14} /> Liberar
                        </button>
                        <button className="btn btn-sm btn-quiet" onClick={() => dispensarPix(p)}>
                          Arquivar
                        </button>
                      </div>
                    ))}
                  </div>
                  {pix.length > 3 && (
                    <button className="btn btn-sm btn-quiet" style={{ marginTop: 8 }}
                      onClick={() => setAba('pix')}>
                      Ver todos os {pix.length} avisos →
                    </button>
                  )}
                </div>
              )}

              {/* Últimos usuários */}
              <div className="card">
                <div className="card-head">Últimas contas</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {st.users.slice(0, 5).map((u) => (
                    <div key={u.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '6px 10px', background: 'var(--surface)', borderRadius: 8,
                    }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <span style={{ fontWeight: 600 }}>{u.name || '—'}</span>
                        <span className="t-xs dim" style={{ marginLeft: 8 }}>{u.email}</span>
                      </div>
                      <span className={`tag ${u.plan === 'pro' || u.plan === 'pro_max' ? 'tag-pro' : ''}`}>
                        {NOME_PLANO[u.plan]}
                      </span>
                      <span className="t-xs dim">{dtBR(u.created_at)}</span>
                    </div>
                  ))}
                </div>
                <button className="btn btn-sm btn-quiet" style={{ marginTop: 10 }}
                  onClick={() => setAba('usuarios')}>
                  Ver todos →
                </button>
              </div>
            </>
          )}

          {/* ========================================================= PIX */}
          {aba === 'pix' && (
            <div className="card">
              <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon.coins width={18} height={18} />
                Avisos de pagamento Pix
                <span className="tag tag-pro" style={{ marginLeft: 'auto' }}>
                  {pix.length} pendente{pix.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="t-sm muted" style={{ margin: '8px 0 12px' }}>
                Confira o comprovante no WhatsApp antes de liberar.
              </p>
              {pix.length === 0 ? (
                <Empty icon={Icon.check} title="Nenhum aviso pendente">
                  Quando alguém informar o pagamento, aparece aqui.
                </Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pix.map((p) => (
                    <article key={p.id} style={{
                      padding: '12px 16px', background: 'var(--surface)',
                      borderRadius: 10, border: '1px solid var(--line)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <strong style={{ fontSize: 15 }}>{p.name}</strong>
                          <div className="t-sm muted" style={{ overflowWrap: 'anywhere' }}>{p.email}</div>
                          <div className="t-xs dim" style={{ marginTop: 4 }}>
                            {PLAN_NAME[p.plan_id]} · R$ {p.amount_brl.toFixed(2).replace('.', ',')} · vitalício
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="t-xs dim">Último aviso: {dtHoraBR(p.last_clicked_at)}</div>
                          <div className="t-xs dim">{p.clicks} clique{p.clicks !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => aprovarPix(p)}>
                          <Icon.check width={14} height={14} /> Conferi · liberar Pro
                        </button>
                        <button className="btn btn-sm btn-quiet" onClick={() => dispensarPix(p)}>
                          Arquivar aviso
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ==================================================== USUÁRIOS */}
          {aba === 'usuarios' && (
            <div className="card">
              <div className="card-head">Utilizadores ({fmt(st.nUsers)})</div>
              <SearchInput value={q} onChange={setQ} placeholder="procurar por email ou nome…" />
              <div style={{ height: 12 }} />
              {users.length === 0 ? (
                <Empty icon={Icon.search} title="Nenhuma conta">
                  {q ? `Nada encontrado para "${q}".` : 'Não há contas.'}
                </Empty>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr><th>Conta</th><th>Plano</th><th>Registada</th><th>Permissões</th><th>Ações</th></tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td data-l="conta">
                            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{u.name}</div>
                            <div className="t-xs dim" style={{ overflowWrap: 'anywhere' }}>{u.email}</div>
                          </td>
                          <td data-l="plano">
                            <select className="input" style={{ minHeight: 34, padding: '4px 8px', fontSize: 13 }}
                              value={u.plan} onChange={(e) => setPlan(u.id, e.target.value as PlanId)}>
                              {(st.plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <div className="t-xs dim" style={{ marginTop: 4 }}>
                              {u.plan === 'free' ? '—'
                                : u.plan_expires ? `até ${dtBR(u.plan_expires)}`
                                : 'vitalício'}
                            </div>
                          </td>
                          <td data-l="registada" className="t-xs dim">{dtBR(u.created_at)}</td>
                          <td data-l="permissões">
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              {!!u.is_admin && <span className="tag tag-pro">admin</span>}
                              {!!u.suspended && <span className="tag">suspensa</span>}
                              {!u.is_admin && !u.suspended && <span className="dim t-xs">utilizador</span>}
                            </div>
                          </td>
                          <td data-l="ações">
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              {u.plan !== 'pro' ? (
                                <button className="btn btn-sm btn-primary" onClick={() => promoverPro(u.id, u.email)}
                                  title="PRO vitalício (pagamento único)">
                                  <Icon.crown width={14} height={14} /> Pro vitalício
                                </button>
                              ) : (
                                <button className="btn btn-sm btn-quiet" onClick={() => rebaixarFree(u.id, u.email)}>
                                  <Icon.arrowLeft width={14} height={14} /> Free
                                </button>
                              )}
                              <button className="btn btn-sm btn-quiet"
                                onClick={() => toggleFlag(u.id, { isAdmin: !u.is_admin })}>
                                {u.is_admin ? 'tirar admin' : 'dar admin'}
                              </button>
                              <button className="btn btn-sm btn-quiet"
                                onClick={() => toggleFlag(u.id, { suspended: !u.suspended })}>
                                {u.suspended ? 'reativar' : 'suspender'}
                              </button>
                              {!u.is_admin && (
                                <button className="btn btn-sm btn-quiet btn-perigo"
                                  onClick={() => excluir(u.id, u.email)}>
                                  <Icon.trash width={14} height={14} /> excluir
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {st.nUsers > users.length && (
                <p className="t-xs dim" style={{ marginTop: 10 }}>
                  A mostrar {users.length} de {st.nUsers}.
                </p>
              )}
            </div>
          )}

          {/* ====================================================== LAYOUT */}
          {aba === 'layout' && <LayoutEditor toast={toast} />}
        </>
      )}
    </div>
  );
}

/* ============================================================ LAYOUT EDITOR */

function LayoutEditor({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [items, setItems] = useState<LayoutItem[]>(loadLayout);
  const [areaAberta, setAreaAberta] = useState<string | null>(LAYOUT_AREAS[0]?.id ?? null);
  const [filtro, setFiltro] = useState<LayoutStatus | 'todos'>('todos');

  // salva no localStorage a cada mudança
  useEffect(() => { saveLayout(items); }, [items]);

  const setStatus = useCallback((id: string, status: LayoutStatus) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  }, []);

  const setNota = useCallback((id: string, nota: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, nota } : i));
  }, []);

  // contadores
  const counts = useMemo(() => {
    const c = { total: items.length, pendente: 0, manter: 0, remover: 0, melhorar: 0, implementar: 0 };
    items.forEach(i => { c[i.status]++; });
    return c;
  }, [items]);

  // exportar como texto
  const exportar = useCallback(() => {
    const linhas: string[] = ['# ARGOS — Revisão de Layout', `# Data: ${new Date().toLocaleDateString('pt-BR')}`, ''];
    for (const area of LAYOUT_AREAS) {
      const areaItems = items.filter(i => i.area === area.id && i.status !== 'pendente');
      if (areaItems.length === 0) continue;
      linhas.push(`## ${area.nome}`, '');
      for (const item of areaItems) {
        const s = STATUS_LABELS[item.status];
        linhas.push(`- ${s.emoji} **${item.nome}** → ${s.label}`);
        if (item.nota) linhas.push(`  💬 ${item.nota}`);
      }
      linhas.push('');
    }
    const pendentes = items.filter(i => i.status === 'pendente');
    if (pendentes.length > 0) {
      linhas.push(`## Pendentes (${pendentes.length})`, '');
      pendentes.forEach(p => linhas.push(`- ⏳ ${p.nome}`));
    }
    const texto = linhas.join('\n');
    navigator.clipboard?.writeText(texto).then(
      () => toast('ok', 'Revisão copiada para a área de transferência!'),
      () => toast('err', 'Não foi possível copiar.'),
    );
  }, [items, toast]);

  // resetar tudo
  const resetar = useCallback(() => {
    const fresh = LAYOUT_AREAS.flatMap(a =>
      a.itens.map(i => ({ id: i.id, nome: i.nome, area: a.id, status: 'pendente' as LayoutStatus, nota: '' }))
    );
    setItems(fresh);
    toast('ok', 'Todas as anotações foram limpas.');
  }, [toast]);

  // filtrar por status
  const filtrados = useMemo(() => {
    if (filtro === 'todos') return items;
    return items.filter(i => i.status === filtro);
  }, [items, filtro]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Resumo */}
      <div className="card">
        <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon.layers width={18} height={18} />
          Editor de Layout
        </div>
        <p className="t-sm muted" style={{ marginTop: 4 }}>
          Marque cada elemento como <b>manter</b>, <b>remover</b>, <b>melhorar</b> ou <b>implementar</b>.
          Escreva notas e depois exporte tudo.
        </p>

        {/* Contadores */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12,
        }}>
          {(Object.keys(STATUS_LABELS) as LayoutStatus[]).map(s => (
            <button key={s}
              className={`btn btn-sm ${filtro === s ? '' : 'btn-quiet'}`}
              style={{
                borderColor: filtro === s ? STATUS_LABELS[s].cor : undefined,
                color: filtro === s ? STATUS_LABELS[s].cor : undefined,
              }}
              onClick={() => setFiltro(filtro === s ? 'todos' : s)}
            >
              {STATUS_LABELS[s].emoji} {STATUS_LABELS[s].label} ({counts[s]})
            </button>
          ))}
        </div>

        {/* Ações */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" onClick={exportar}>
            <Icon.copy width={14} height={14} /> Exportar revisão
          </button>
          <button className="btn btn-sm btn-quiet" onClick={() => window.location.reload()}>
            <Icon.activity width={14} height={14} /> Recarregar app
          </button>
          <button className="btn btn-sm btn-quiet btn-perigo" onClick={resetar}>
            <Icon.trash width={14} height={14} /> Limpar tudo
          </button>
        </div>
      </div>

      {/* Áreas */}
      {LAYOUT_AREAS.map(area => {
        const areaItems = filtrados.filter(i => i.area === area.id);
        if (areaItems.length === 0 && filtro !== 'todos') return null;
        const aberta = areaAberta === area.id;
        const areaCount = items.filter(i => i.area === area.id && i.status !== 'pendente').length;
        const areaTotal = items.filter(i => i.area === area.id).length;

        return (
          <div key={area.id} className="card" style={{ overflow: 'hidden' }}>
            <button
              onClick={() => setAreaAberta(aberta ? null : area.id)}
              style={{
                width: '100%', background: 'none', border: 'none', padding: '12px 16px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                color: 'inherit', textAlign: 'left', fontSize: 15, fontWeight: 600,
              }}
            >
              <span style={{
                display: 'inline-flex', transition: 'transform .2s',
                transform: aberta ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>▶</span>
              {area.nome}
              <span className="t-xs muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>
                {areaCount}/{areaTotal} marcados
              </span>
            </button>

            {aberta && (
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(filtro === 'todos'
                  ? items.filter(i => i.area === area.id)
                  : areaItems
                ).map(item => (
                  <LayoutItemRow key={item.id} item={item} setStatus={setStatus} setNota={setNota} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- layout item row */

function LayoutItemRow({ item, setStatus, setNota }: {
  item: LayoutItem;
  setStatus: (id: string, s: LayoutStatus) => void;
  setNota: (id: string, n: string) => void;
}) {
  const [notaAberta, setNotaAberta] = useState(false);
  const info = STATUS_LABELS[item.status];

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      border: `1px solid ${item.status !== 'pendente' ? info.cor + '44' : 'var(--line)'}`,
      background: item.status !== 'pendente' ? info.cor + '08' : 'var(--surface)',
    }}>
      {/* Nome + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 500, flex: 1, minWidth: 140 }}>
          {item.nome}
        </span>
        <span className="t-xs" style={{
          padding: '2px 8px', borderRadius: 6, fontWeight: 600,
          color: info.cor, background: info.cor + '18',
        }}>
          {info.emoji} {info.label}
        </span>
      </div>

      {/* Botões de status */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {(Object.keys(STATUS_LABELS) as LayoutStatus[]).filter(s => s !== 'pendente').map(s => (
          <button key={s}
            className={`btn btn-sm ${item.status === s ? '' : 'btn-quiet'}`}
            style={{
              fontSize: 12, padding: '3px 8px', minHeight: 28,
              borderColor: item.status === s ? STATUS_LABELS[s].cor : undefined,
              color: item.status === s ? STATUS_LABELS[s].cor : undefined,
            }}
            onClick={() => setStatus(item.id, item.status === s ? 'pendente' : s)}
          >
            {STATUS_LABELS[s].emoji} {STATUS_LABELS[s].label}
          </button>
        ))}
        <button
          className={`btn btn-sm ${notaAberta || item.nota ? '' : 'btn-quiet'}`}
          style={{ fontSize: 12, padding: '3px 8px', minHeight: 28, marginLeft: 'auto' }}
          onClick={() => setNotaAberta(!notaAberta)}
        >
          💬 {item.nota ? 'Nota ✓' : 'Nota'}
        </button>
      </div>

      {/* Campo de nota */}
      {notaAberta && (
        <textarea
          value={item.nota}
          onChange={e => setNota(item.id, e.target.value)}
          placeholder="Ex: Tirar isso, está feio · Melhorar a cor · Adicionar botão X..."
          rows={2}
          style={{
            width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--line)', background: 'var(--bg)',
            color: 'inherit', fontSize: 13, resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      )}
    </div>
  );
}
