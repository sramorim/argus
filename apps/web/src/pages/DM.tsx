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
import { useCallback, useEffect, useState } from 'react';
import { api, type PixIntent, type PlanId, ApiError, PLAN_NAME } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, SearchInput, Skeleton, useToast } from '../components/ui';
import { NOME_PLANO } from '../ia';

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
          {aba === 'layout' && (
            <div className="card">
              <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon.layers width={18} height={18} />
                Editor de Layout
              </div>
              <p className="t-sm muted" style={{ marginTop: 4 }}>
                Modo de edição visual para marcar elementos da interface.
              </p>
              <div style={{
                marginTop: 16, padding: 24, borderRadius: 12,
                border: '2px dashed var(--line)', textAlign: 'center',
                background: 'var(--surface)',
              }}>
                <Icon.layers width={40} height={40} style={{ color: 'var(--t-3)', marginBottom: 12 }} />
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
                  Editor de Layout — em breve
                </div>
                <p className="t-sm muted" style={{ maxWidth: 420, margin: '0 auto' }}>
                  Aqui vai poder clicar em qualquer elemento da interface e marcar como
                  "manter" ou "remover", escrever notas e exportar as alterações.
                  Funcionalidade em desenvolvimento.
                </p>
              </div>

              {/* Configurações rápidas que já funcionam */}
              <div style={{ marginTop: 20 }}>
                <div className="card-head" style={{ fontSize: 14, marginBottom: 12 }}>Ações rápidas</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button className="btn btn-sm btn-quiet" onClick={() => window.location.reload()}>
                    <Icon.activity width={14} height={14} /> Recarregar app
                  </button>
                  <button className="btn btn-sm btn-quiet" onClick={() => {
                    navigator.clipboard?.writeText(window.location.href);
                    toast('ok', 'URL copiada.');
                  }}>
                    <Icon.copy width={14} height={14} /> Copiar URL
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
