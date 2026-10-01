/**
 * Chaves API (BYOK).
 *
 * A tela diz sempre **o que a chave desbloqueia** — uma chave guardada sem uso é
 * dinheiro gasto à toa. E diz onde se obtém, porque "precisa de chave" sem link
 * é um beco sem saída.
 */
import { useEffect, useState } from 'react';
import { api, type ByokProvider, ApiError } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Field, Note, Skeleton, useToast } from '../components/ui';

export default function Keys() {
  const [providers, setProviders] = useState<ByokProvider[]>([]);
  const [keys, setKeys] = useState<{ provider: string; created_at: string; meta: ByokProvider | null }[] | null>(null);
  const [provider, setProvider] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  const load = () => api.keys().then((r) => setKeys(r.keys)).catch((e) => setErr((e as ApiError).message));
  useEffect(() => {
    api.byokProviders().then((r) => { setProviders(r.providers); setProvider((p) => p || r.providers[0]?.id || ''); }).catch(() => {});
    load();
  }, []);

  const add = async () => {
    setErr('');
    setBusy(true);
    try {
      await api.addKey(provider, secret);
      setSecret('');
      toast('ok', 'Chave guardada (cifrada com AES-256-GCM no servidor).');
      load();
    } catch (e) { setErr((e as ApiError).message); }
    finally { setBusy(false); }
  };

  const del = async (p: string) => {
    try { await api.delKey(p); toast('ok', 'Chave removida.'); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  const sel = providers.find((p) => p.id === provider);

  return (
    <div className="page">
      <header className="card">
        <h1 className="t-h1">Chaves API (BYOK)</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '62ch' }}>
          A tua chave, no teu servidor. É guardada cifrada (AES-256-GCM) e nunca é devolvida pela
          API — nem para ti. Sem chave, as ferramentas que dependem de fonte paga dizem o que
          falta em vez de inventar resultados.
        </p>
      </header>

      <div className="card">
        <div className="card-head">Chaves guardadas</div>
        {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}
        {keys === null ? <Skeleton lines={2} /> : keys.length === 0 ? (
          <Empty icon={Icon.key} title="Nenhuma chave guardada">
            Não é preciso para usar o ARGOS: as ferramentas gratuitas funcionam sem chave. Uma chave
            só desbloqueia fontes que exigem conta (por exemplo, a base de brechas Leak-Lookup).
          </Empty>
        ) : (
          <div>
            {keys.map((k) => (
              <div className="list-row" key={k.provider}>
                <Icon.key width={16} height={16} style={{ color: 'var(--t-4)' }} />
                <div className="grow">
                  <div className="t">{k.meta?.label ?? k.provider}</div>
                  <div className="s">usada por {k.meta?.usedBy ?? '—'} · guardada em {new Date(k.created_at).toLocaleDateString('pt-BR')}</div>
                </div>
                <button className="btn btn-sm btn-quiet" type="button" onClick={() => del(k.provider)}>remover</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">Adicionar chave</div>
        <Field label="Serviço">
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.usedBy}</option>)}
          </select>
        </Field>
        {sel && (
          <Note kind="info">
            Obtém a chave em <a href={sel.doc} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--blue-3)' }}>{sel.doc.replace(/^https?:\/\//, '')} ↗</a>.
            {' '}Fica a ser usada apenas por {sel.usedBy}.
          </Note>
        )}
        <div style={{ height: 12 }} />
        <Field label="Chave" hint="Fica cifrada em disco. Não volta a ser mostrada depois de guardada.">
          <input className="input" type="password" value={secret} autoComplete="off" spellCheck={false}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && secret) add(); }}
            placeholder="a sua chave" />
        </Field>
        <button className="btn btn-primary" type="button" onClick={add} disabled={!secret || busy || !provider}>
          {busy ? <span className="spin" /> : <><Icon.plus /> guardar chave</>}
        </button>
      </div>
    </div>
  );
}
