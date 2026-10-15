/**
 * Painel de administração.
 *
 * Existe para uma coisa concreta: ativar planos depois de confirmado o
 * pagamento, e suspender quem precise de ser suspenso. Tudo o que aparece aqui é
 * verificado no servidor a cada pedido — esconder botões no cliente não protege
 * nada, e este ficheiro não finge que protege.
 */
import { useEffect, useState } from 'react';
import { api, type PixIntent, type PlanId, ApiError, PLAN_NAME } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, SearchInput, Skeleton, useToast } from '../components/ui';

interface AdminUser {
  id: string; email: string; name: string; plan: PlanId;
  is_admin: number; suspended: number; created_at: string;
  /** 'admin' | 'free' | 'pro'. NULL = vitalício. */
  role?: string; plan_expires?: string | null;
}
interface AdminState {
  users: AdminUser[]; nUsers: number; nRuns: number; nInvs: number; hoje: number;
  plans: { id: PlanId; name: string }[]; db: { path: string; writable: boolean };
}

export default function Admin() {
  const [st, setSt] = useState<AdminState | null>(null);
  const [pixIntents, setPixIntents] = useState<PixIntent[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  /* Limite a escrever, por pessoa: o campo é uncontrolled para quem não está
     a editar. Sem este estado cada tecla recarregava a lista inteira. */
  const toast = useToast();

  const load = async () => {
    try {
      const [state, pix] = await Promise.all([api.admin(), api.adminPixIntents()]);
      setSt(state);
      setPixIntents(pix.intents);
      setErr('');
    } catch (e) { setErr((e as ApiError).message); }
  };
  useEffect(() => { load(); }, []);

  const setPlan = async (id: string, plan: PlanId) => {
    try { await api.adminSetPlan(id, plan, true); toast('ok', `Plano alterado para ${PLAN_NAME[plan]} e cota de hoje reiniciada.`); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  /*
   * Os dois botões do dia a dia: quem mandou o comprovante no WhatsApp é
   * promovido para PRO vitalício; quem cancelou volta para Free.
   *
   * `planExpires: null` é o vitalício — no banco é a ausência de data de
   * fim. Passar `true` no segundo argumento reinicia a cota do dia, que é o
   * que se quer quando a pessoa acabou de pagar.
   */
  const promoverProVitalicio = async (id: string, email: string) => {
    try {
      await api.adminSetPlan(id, 'pro', true, null);
      toast('ok', `PRO vitalício ativado para ${email}.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };
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
  const rebaixarFree = async (id: string, email: string) => {
    try {
      await api.adminSetPlan(id, 'free', true);
      toast('ok', `${email} voltou para Free.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };

  const setFlags = async (id: string, flags: { isAdmin?: boolean; suspended?: boolean }) => {
    try { await api.adminSetFlags(id, flags); toast('ok', 'Atualizado.'); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };
  const excluir = async (id: string, email: string) => {
    if (!window.confirm(`Excluir a conta ${email}? Isto apaga também as investigações e o histórico dela e não pode ser desfeito.`)) return;
    try { await api.adminDeleteUser(id); toast('ok', `${email} foi excluída.`); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  const users = (st?.users ?? []).filter((u) => {
    const n = q.trim().toLowerCase();
    return !n || u.email.toLowerCase().includes(n) || u.name.toLowerCase().includes(n);
  });

  return (
    <div className="page page-wide">
      <header className="card">
        <h1 className="t-h1">Administração</h1>
        <p className="t-sm muted" style={{ marginTop: 6 }}>
          Ativação de planos, suspensão e acesso. Cada ação é validada no servidor com o papel do
          utilizador — o botão escondido não é proteção nenhuma.
        </p>
      </header>

      {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}

      {st ? (
        <>
          <div className="card">
            <div className="card-head">Estado do serviço</div>
            <div className="stat-row">
              <div><div className="v num">{st.nUsers}</div><div className="l">contas</div></div>
              <div><div className="v num">{st.nRuns}</div><div className="l">execuções guardadas</div></div>
              <div><div className="v num">{st.nInvs}</div><div className="l">investigações</div></div>
              <div><div className="v num">{st.hoje}</div><div className="l">execuções hoje</div></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Note kind={st.db.writable ? 'ok' : 'err'}>
                Base de dados: <span className="mono t-xs">{st.db.path}</span> —{' '}
                {st.db.writable ? 'com escrita. Os dados sobrevivem a um deploy.' : 'SEM ESCRITA. O serviço está a perder tudo.'}
              </Note>
            </div>
          </div>

          <section className="card" aria-labelledby="pix-admin-title">
            <div className="card-head pix-admin-head">
              <span id="pix-admin-title">Avisos de pagamento Pix</span>
              <span className="tag tag-pro">{pixIntents.length} pendente{pixIntents.length === 1 ? '' : 's'}</span>
            </div>
            <p className="t-sm muted" style={{ marginBottom: 12 }}>
              Estes avisos são gerados quando alguém toca em JA PAGUEI. Confira o comprovante no WhatsApp antes de liberar o acesso.
            </p>
            {pixIntents.length === 0 ? (
              <Empty icon={Icon.check} title="Nenhum aviso pendente">Quando uma pessoa informar o pagamento, o pedido aparece aqui.</Empty>
            ) : (
              <div className="pix-admin-list">
                {pixIntents.map((p) => (
                  <article className="pix-admin-item" key={p.id}>
                    <div className="pix-admin-person">
                      <strong>{p.name}</strong>
                      <span className="t-sm muted" style={{ overflowWrap: 'anywhere' }}>{p.email}</span>
                      <span className="t-xs dim">{PLAN_NAME[p.plan_id]} · R$ {p.amount_brl.toFixed(2).replace('.', ',')} · vitalício</span>
                    </div>
                    <div className="pix-admin-meta">
                      <span className="t-xs dim">Último aviso {new Date(p.last_clicked_at).toLocaleString('pt-BR')}</span>
                      <span className="t-xs dim">{p.clicks} clique{p.clicks === 1 ? '' : 's'}</span>
                    </div>
                    <div className="pix-admin-actions">
                      <button className="btn btn-sm btn-primary" type="button" onClick={() => aprovarPix(p)}>
                        <Icon.check width={14} height={14} /> Conferi · liberar Pro
                      </button>
                      <button className="btn btn-sm btn-quiet" type="button" onClick={() => dispensarPix(p)}>
                        arquivar aviso
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="card">
            <div className="card-head">Utilizadores</div>
            <SearchInput value={q} onChange={setQ} placeholder="procurar por email ou nome…" />
            <div style={{ height: 12 }} />
            {users.length === 0 ? (
              <Empty icon={Icon.search} title="Nenhuma conta corresponde">{q ? `Nada encontrado para “${q}”.` : 'Não há contas.'}</Empty>
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
                          {/* Vitalício é a ausência de data de fim — e é o que o
                              botão "Promover" escreve. */}
                          <div className="t-xs dim" style={{ marginTop: 4 }}>
                            {u.plan === 'free' ? '—'
                              : u.plan_expires ? `até ${new Date(u.plan_expires).toLocaleDateString('pt-BR')}`
                              : 'vitalício'}
                          </div>
                        </td>
                        <td data-l="registada" className="t-xs dim">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
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
                              <button className="btn btn-sm btn-primary" type="button"
                                title="Ativa o PRO vitalício (pagamento único, sem data de fim)"
                                onClick={() => promoverProVitalicio(u.id, u.email)}>
                                <Icon.crown width={14} height={14} /> Promover para PRO Vitalício
                              </button>
                            ) : (
                              <button className="btn btn-sm btn-quiet" type="button"
                                title="Volta ao plano Free"
                                onClick={() => rebaixarFree(u.id, u.email)}>
                                <Icon.arrowLeft width={14} height={14} /> Rebaixar para Free
                              </button>
                            )}
                            <button className="btn btn-sm btn-quiet" type="button"
                              onClick={() => setFlags(u.id, { isAdmin: !u.is_admin })}>
                              {u.is_admin ? 'tirar admin' : 'dar admin'}
                            </button>
                            <button className="btn btn-sm btn-quiet" type="button"
                              onClick={() => setFlags(u.id, { suspended: !u.suspended })}>
                              {u.suspended ? 'reativar' : 'suspender'}
                            </button>
                            {!u.is_admin && (
                              <button className="btn btn-sm btn-quiet btn-perigo" type="button"
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
                A mostrar os primeiros {users.length} de {st.nUsers} (a lista da API traz no máximo 200).
              </p>
            )}
          </div>
        </>
      ) : <div className="card"><Skeleton lines={6} /></div>}
    </div>
  );
}
