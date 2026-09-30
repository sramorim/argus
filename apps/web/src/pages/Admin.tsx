/**
 * Painel de administração.
 *
 * Existe para uma coisa concreta: ativar planos depois de confirmado o
 * pagamento, e suspender quem precise de ser suspenso. Tudo o que aparece aqui é
 * verificado no servidor a cada pedido — esconder botões no cliente não protege
 * nada, e este ficheiro não finge que protege.
 */
import { useEffect, useState } from 'react';
import { api, type PlanId, ApiError, PLAN_NAME } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, SearchInput, Skeleton, useToast } from '../components/ui';

interface AdminUser {
  id: string; email: string; name: string; plan: PlanId;
  is_admin: number; suspended: number; created_at: string;
}
interface AdminState {
  users: AdminUser[]; nUsers: number; nRuns: number; nInvs: number; hoje: number;
  plans: { id: PlanId; name: string }[]; db: { path: string; writable: boolean };
}

export default function Admin() {
  const [st, setSt] = useState<AdminState | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();

  const load = () => api.admin().then(setSt).catch((e) => setErr((e as ApiError).message));
  useEffect(() => { load(); }, []);

  const setPlan = async (id: string, plan: PlanId) => {
    try { await api.adminSetPlan(id, plan, true); toast('ok', `Plano alterado para ${PLAN_NAME[plan]} e cota de hoje reiniciada.`); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };
  const setFlags = async (id: string, flags: { isAdmin?: boolean; suspended?: boolean }) => {
    try { await api.adminSetFlags(id, flags); toast('ok', 'Atualizado.'); load(); }
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
                            <button className="btn btn-sm btn-quiet" type="button"
                              onClick={() => setFlags(u.id, { isAdmin: !u.is_admin })}>
                              {u.is_admin ? 'tirar admin' : 'dar admin'}
                            </button>
                            <button className="btn btn-sm btn-quiet" type="button"
                              onClick={() => setFlags(u.id, { suspended: !u.suspended })}>
                              {u.suspended ? 'reativar' : 'suspender'}
                            </button>
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
