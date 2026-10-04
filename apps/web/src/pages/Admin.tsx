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
  /** 'admin' | 'free' | 'pro'. NULL = vitalício. */
  role?: string; plan_expires?: string | null;
  /** Consumo do mês, pela regra que a pessoa vê em Conta > Gerenciar limites. */
  creditos?: {
    datalikers: { usados: number; limite: number; temChave: boolean; limiteDefinido: number | null };
    shodan: { usados: number; limite: number };
  };
}
interface AdminState {
  users: AdminUser[]; nUsers: number; nRuns: number; nInvs: number; hoje: number;
  plans: { id: PlanId; name: string }[]; db: { path: string; writable: boolean };
}

export default function Admin() {
  const [st, setSt] = useState<AdminState | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  /* Limite a escrever, por pessoa: o campo é uncontrolled para quem não está
     a editar. Sem este estado cada tecla recarregava a lista inteira. */
  const [limites, setLimites] = useState<Record<string, string>>({});
  const toast = useToast();

  const load = () => api.admin().then(setSt).catch((e) => setErr((e as ApiError).message));
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
  const rebaixarFree = async (id: string, email: string) => {
    try {
      await api.adminSetPlan(id, 'free', true);
      toast('ok', `${email} voltou para Free.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };

  /*
   * Recarga de créditos à mão — o outro lado do Pix do Plans.
   *
   * Não há gateway de pagamento, logo a ativação é sempre humana: entra o
   * valor que a pessoa comprou e o limite passa a ser esse. "Voltar ao plano"
   * é o botão de desfazer, e existe porque um limite escrito à mão e
   * esquecido é um cliente que nunca mais bate no tecto.
   */
  const definirLimite = async (id: string, email: string, valor: string) => {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      toast('err', 'O limite tem de ser um número inteiro de 0 a 100000.');
      return;
    }
    try {
      await api.adminSetLimite(id, n);
      toast('ok', `Limite de DataLikers de ${email}: ${n} por mês.`);
      setLimites((s) => { const copy = { ...s }; delete copy[id]; return copy; });
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
  };
  const voltarAoPlano = async (id: string, email: string) => {
    try {
      await api.adminSetLimite(id, null);
      toast('ok', `${email} voltou ao limite do plano.`);
      load();
    } catch (e) { toast('err', (e as ApiError).message); }
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
                    <tr><th>Conta</th><th>Plano</th><th>Uso do mês</th><th>Registada</th><th>Permissões</th><th>Ações</th></tr>
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
                        <td data-l="uso do mês">
                          <div className="uso-admin">
                            <span className="num">
                              {u.creditos?.datalikers.usados ?? 0}/{u.creditos?.datalikers.limite ?? 0}
                            </span>
                            <span className="t-xs dim">datalikers</span>
                          </div>
                          <div className="uso-admin">
                            <span className="num">
                              {u.creditos?.shodan.usados ?? 0}/{u.creditos?.shodan.limite ?? 0}
                            </span>
                            <span className="t-xs dim">shodan</span>
                          </div>
                          {u.creditos?.datalikers.temChave && <span className="tag tag-pro">chave própria</span>}

                          {/* Recarga à mão. Só aparece quando o limite não é o do
                              plano — senão areia a tabela com um campo para
                              cada pessoa que nunca precisou de nada. */}
                          {(u.creditos?.datalikers.limiteDefinido ?? null) !== null ? (
                            <div className="uso-cartao">
                              <input
                                className="input"
                                type="number"
                                min={0}
                                max={100000}
                                inputMode="numeric"
                                style={{ minHeight: 30, padding: '2px 6px', fontSize: 12, width: 76 }}
                                value={limites[u.id] ?? String(u.creditos!.datalikers.limiteDefinido)}
                                aria-label={`Limite mensal de DataLikers para ${u.email}`}
                                onChange={(e) => setLimites((s) => ({ ...s, [u.id]: e.target.value }))}
                              />
                              <button className="btn btn-sm btn-primary" type="button"
                                title="Escreve este limite para o período em curso"
                                onClick={() => definirLimite(u.id, u.email, limites[u.id] ?? String(u.creditos!.datalikers.limiteDefinido))}>
                                <Icon.check width={13} height={13} />
                              </button>
                              <button className="btn btn-sm btn-quiet" type="button"
                                title="Volta ao limite que o plano dá"
                                onClick={() => voltarAoPlano(u.id, u.email)}>
                                <Icon.arrowLeft width={13} height={13} />
                              </button>
                            </div>
                          ) : (
                            <button className="btn btn-sm btn-quiet" type="button"
                              title="Ativa mais créditos a esta pessoa (depois de ver o comprovante)"
                              onClick={() => setLimites((s) => ({ ...s, [u.id]: '' }))}>
                              <Icon.plus width={13} height={13} /> créditos
                            </button>
                          )}
                          {limites[u.id] === '' && (
                            <div className="uso-cartao">
                              <input
                                className="input"
                                type="number"
                                min={0}
                                max={100000}
                                inputMode="numeric"
                                autoFocus
                                placeholder="consultas"
                                style={{ minHeight: 30, padding: '2px 6px', fontSize: 12, width: 76 }}
                                aria-label={`Novo limite mensal de DataLikers para ${u.email}`}
                                onChange={(e) => setLimites((s) => ({ ...s, [u.id]: e.target.value }))}
                              />
                              <button className="btn btn-sm btn-primary" type="button" disabled={!limites[u.id]}
                                onClick={() => definirLimite(u.id, u.email, limites[u.id])}>
                                <Icon.check width={13} height={13} />
                              </button>
                              <button className="btn btn-sm btn-quiet" type="button"
                                onClick={() => setLimites((s) => { const c = { ...s }; delete c[u.id]; return c; })}>
                                <Icon.close width={13} height={13} />
                              </button>
                            </div>
                          )}
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
