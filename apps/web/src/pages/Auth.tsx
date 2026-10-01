import { useState } from 'react';
import { api, ApiError, useContacto } from '../api';
import { Icon } from '../components/Icons';
import { Mark, Note } from '../components/ui';

const MENSAGENS: Record<string, string> = {
  email_invalido: 'Email inválido.',
  nome_invalido: 'O nome precisa de pelo menos 2 caracteres.',
  senha_curta: 'A senha precisa de pelo menos 8 caracteres.',
  senha_longa: 'Senha demasiado longa (máximo 200).',
  email_em_uso: 'Já existe uma conta com este email.',
  credenciais_invalidas: 'Email ou senha incorretos.',
  // As chaves têm de bater certo com o `error` que o servidor devolve
  // (index.ts): `demasiadas_tentativas`. Com a chave errada caía-se no
  // `a.message` cru, que o utilizador via como código.
  demasiadas_tentativas: 'Demasiadas tentativas. Tente daqui a pouco.',
  conta_suspensa: 'Esta conta está suspensa. Fala connosco.',
  sem_rede: 'Sem ligação ao servidor. Verifique a rede.',
};

export default function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const wa = useContacto();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'register') await api.register({ email, name, password });
      else await api.login({ email, password });
      onDone();
    } catch (x) {
      const a = x as ApiError;
      setErr(MENSAGENS[a.code] ?? a.message ?? 'Não foi possível. Tente outra vez.');
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Mark size={34} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 720, letterSpacing: '.2em' }}>ARGOS</div>
          <div className="t-xs dim">{mode === 'register' ? 'criar conta' : 'entrar'}</div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button role="tab" type="button" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setErr(''); }}>Criar conta</button>
        <button role="tab" type="button" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setErr(''); }}>Entrar</button>
      </div>

      <form onSubmit={submit} noValidate>
        {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}

        {mode === 'register' && (
          <div className="field">
            <label htmlFor="auth-name">Nome</label>
            <input id="auth-name" className="input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="o teu nome" required autoComplete="name" maxLength={60} />
          </div>
        )}

        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" className="input" type="email" inputMode="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com"
            required autoComplete="email" autoCapitalize="none" spellCheck={false} />
        </div>

        <div className="field">
          <label htmlFor="auth-pass">Senha</label>
          <input id="auth-pass" className="input" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'mínimo 8 caracteres' : 'a tua senha'}
            required minLength={8} maxLength={200}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
        </div>

        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !email || !password || (mode === 'register' && name.length < 2)}>
          {busy ? <><span className="spin" /> a entrar…</>
            : mode === 'register' ? <><Icon.plus /> criar conta grátis</> : <><Icon.logout /> entrar</>}
        </button>

        {mode === 'register' && (
          <p className="t-xs dim" style={{ marginTop: 12, textAlign: 'center', lineHeight: 1.55 }}>
            Sem cartão, sem trial que expira. Só dados públicos e uso defensivo.
          </p>
        )}

        <div className="auth-credit">
          <div>{wa?.copyright ?? '© 2026 Daniel Senhor Amorim'}</div>
          {wa && <a href={wa.link} target="_blank" rel="noopener noreferrer">{wa.label}</a>}
        </div>
      </form>
    </div>
  );
}
