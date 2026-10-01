/**
 * Conta: perfil, cota, senha, sessões e eliminação.
 *
 * A eliminação de conta não é enfeite — é o direito ao esquecimento (art. 18
 * da LGPD) e um produto brasileiro que investigate pessoas tem de o oferecer.
 */
import { useEffect, useState } from 'react';
import { api, type User, type Usage, ApiError, PLAN_NAME } from '../api';
import { Icon } from '../components/Icons';
import { Field, Modal, Note, Skeleton, useToast } from '../components/ui';

export default function Account({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [delPwd, setDelPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const toast = useToast();

  useEffect(() => { api.me().then((r) => setUsage(r.usage ?? null)).catch(() => {}); }, []);

  const changePwd = async () => {
    if (pwd.next !== pwd.confirm) { toast('err', 'A confirmação não coincide com a nova senha.'); return; }
    setBusy(true);
    try {
      const r = await api.changePassword(pwd.current, pwd.next);
      toast('ok', r.msg);
      setPwd({ current: '', next: '', confirm: '' });
    } catch (e) { toast('err', (e as ApiError).message); }
    finally { setBusy(false); }
  };

  const wipe = async () => {
    setBusy(true);
    try {
      await api.deleteAccount(delPwd);
      toast('ok', 'Conta eliminada.');
      onLogout();
    } catch (e) { toast('err', (e as ApiError).message); setBusy(false); }
  };

  const logoutAll = async () => {
    try { await api.logoutAll(); toast('ok', 'Todas as sessões encerradas.'); onLogout(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  const pct = usage?.daily ? Math.min(100, (usage.today / usage.daily) * 100) : 0;

  return (
    <div className="page">
      <header className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="tool-glyph" style={{ width: 44, height: 44, flex: '0 0 44px' }}><Icon.user width={20} height={20} /></div>
          <div style={{ minWidth: 0 }}>
            <h1 className="t-h1" style={{ overflowWrap: 'anywhere' }}>{user.name}</h1>
            <div className="t-sm dim" style={{ overflowWrap: 'anywhere' }}>{user.email}</div>
          </div>
          <span className="grow" />
          <span className="tag tag-pro">{PLAN_NAME[user.plan]}</span>
        </div>
      </header>

      <div className="card">
        <div className="card-head">Cota de hoje</div>
        {usage ? (
          <>
            <div className="stat-row">
              <div><div className="v num">{usage.today}</div><div className="l">execuções feitas</div></div>
              <div><div className="v num">{usage.daily}</div><div className="l">limite diário</div></div>
              <div><div className="v num">{Math.max(0, usage.daily - usage.today)}</div><div className="l">restantes</div></div>
              <div><div className="v num">{usage.inflight ?? 0}/{usage.concurrent ?? 1}</div><div className="l">em curso</div></div>
            </div>
            <div className="meter" style={{ marginTop: 12 }}><i style={{ width: `${pct}%` }} /></div>
            <div className="t-xs dim" style={{ marginTop: 8 }}>
              {usage.maxItems ? `Até ${usage.maxItems} itens por resultado` : ''}
              {usage.graphHops ? ` · grafo com ${usage.graphHops} salto(s)` : ''}
              {usage.investigations != null ? ` · ${usage.investigations} investigações guardadas` : ''}
            </div>
          </>
        ) : <Skeleton lines={2} />}
      </div>

      <div className="card">
        <div className="card-head">Alterar senha</div>
        <Note kind="info">
          Ao mudar a senha, <b>todas</b> as sessões são encerradas — incluindo este dispositivo.
          Volta a entrar com a senha nova.
        </Note>
        <div style={{ height: 12 }} />
        <Field label="Senha atual" required>
          <input className="input" type="password" value={pwd.current} autoComplete="current-password"
            onChange={(e) => setPwd((v) => ({ ...v, current: e.target.value }))} />
        </Field>
        <Field label="Nova senha" hint="Mínimo 8 caracteres." required>
          <input className="input" type="password" value={pwd.next} autoComplete="new-password"
            onChange={(e) => setPwd((v) => ({ ...v, next: e.target.value }))} />
        </Field>
        <Field label="Confirmar nova senha" required>
          <input className="input" type="password" value={pwd.confirm} autoComplete="new-password"
            onChange={(e) => setPwd((v) => ({ ...v, confirm: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') changePwd(); }} />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="button" onClick={changePwd} disabled={busy || !pwd.current || pwd.next.length < 8}>
            {busy ? <span className="spin" /> : 'alterar senha'}
          </button>
          <button className="btn btn-quiet" type="button" onClick={logoutAll}>
            <Icon.logout width={15} height={15} /> encerrar todas as sessões
          </button>
          <button className="btn btn-quiet" type="button" onClick={onLogout}>sair</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">Zona sensível</div>
        <Note kind="warn">
          A eliminação apaga a conta, as investigações, as chaves guardadas e o histórico. É
          imediato e não tem volta atrás.
        </Note>
        <div style={{ height: 12 }} />
        <button className="btn btn-danger" type="button" onClick={() => setConfirmDel(true)}>
          <Icon.trash width={15} height={15} /> eliminar conta
        </button>
      </div>

      <div className="card">
        <div className="card-head">Como tratamos os seus dados</div>
        <div className="t-sm muted" style={{ display: 'grid', gap: 8 }}>
          <p>• Guardamos o essencial: email, nome, hash da senha (scrypt), chaves cifradas e o histórico de execuções.</p>
          <p>• As consultas a fontes públicas são feitas pelo ARGOS. O endereço IP do servidor é visto pelas fontes; o seu, em princípio, não.</p>
          <p>• Só usamos fontes públicas e apenas com fundamento legal ou defensivo. Nada de dados de terceiros comprados, nada de port scanner ativo.</p>
          <p>• Pode pedir a eliminação a qualquer momento, aqui em cima, sem falar com ninguém.</p>
        </div>
      </div>

      <Modal
        open={confirmDel} onClose={() => setConfirmDel(false)}
        title="Eliminar a conta"
        actions={
          <button className="btn btn-danger" type="button" onClick={wipe} disabled={busy || delPwd.length < 1}>
            eliminar definitivamente
          </button>
        }
      >
        <p className="t-sm muted" style={{ marginBottom: 12 }}>
          Escreve a tua senha para confirmar. Isto apaga tudo o que está associado a {user.email}.
        </p>
        <Field label="Senha" required>
          <input className="input" type="password" value={delPwd} autoComplete="current-password"
            onChange={(e) => setDelPwd(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
