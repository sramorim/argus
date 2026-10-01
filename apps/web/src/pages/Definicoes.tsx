/**
 * Definições — só coisas que existem de facto no produto.
 *
 * Aqui não há atalhos inventados nem "preferências de servidor": cada bloco
 * aponta para um endpoint real (`/api/me`, `/api/plans`, `/api/keys`,
 * `/api/contact`) ou para o que fica **neste navegador**. O que é local leva
 * a etiqueta "guardado neste navegador" — o utilizador tem de saber distinguir
 * o que o servidor sabe do que é só disposição deste aparelho.
 */
import { useEffect, useState } from 'react';
import { api, type Plan, type Usage, type User, PLAN_NAME, useContacto } from '../api';
import { Icon } from '../components/Icons';
import { Note, Skeleton, useToast } from '../components/ui';
import { guardar, preferencias, type Preferencias } from '../prefs';
import type { View } from './AppShell';

export default function Definicoes({ user, usage, setView }: {
  user: User; usage: Usage | null; setView: (v: View) => void;
}) {
  const wa = useContacto();
  const toast = useToast();
  const [me, setMe] = useState<{ user: User | null; usage?: Usage } | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [keys, setKeys] = useState<{ provider: string }[] | null>(null);
  const [prefs, setPrefs] = useState<Preferencias>(() => preferencias());

  useEffect(() => { api.me().then(setMe).catch(() => setMe({ user: null })); }, []);
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);
  useEffect(() => { api.keys().then((r) => setKeys(r.keys ?? [])).catch(() => setKeys([])); }, []);

  const alterar = <K extends keyof Preferencias>(chave: K, valor: Preferencias[K]) => {
    setPrefs(guardar(chave, valor));
    toast('ok', 'Preferência guardada neste navegador.');
  };

  const conta = me?.user ?? user;
  const cota = me?.usage ?? usage;
  const plano = plans?.find((p) => p.id === user.plan) ?? null;

  return (
    <div className="page">
      <header className="card">
        <h1 className="t-h1">Definições</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '66ch' }}>
          O que o produto tem mesmo: conta, plano, chaves e o canal de contacto. As opções de
          apresentação ficam no navegador e estão marcadas como tais.
        </p>
      </header>

      {/* ------------------------------------------------------------- conta */}
      <div className="card">
        <div className="card-head">
          <span>Conta</span>
          <span className="grow" />
          <div className="card-head-actions">
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'account' })}>
              gerir conta
            </button>
          </div>
        </div>
        {me === null ? (
          <Skeleton lines={3} />
        ) : !me.user ? (
          <Note kind="warn">
            O pedido a <span className="mono">GET /api/me</span> não devolveu sessão. Os dados
            abaixo são os que a app já tinha em memória.
          </Note>
        ) : null}
        <dl className="kv" style={{ marginTop: me && me.user ? 0 : 12 }}>
          <dt>nome</dt>
          <dd>{conta.name || '— sem nome —'}</dd>
          <dt>email</dt>
          <dd style={{ overflowWrap: 'anywhere' }}>{conta.email}</dd>
          <dt>plano</dt>
          <dd><span className="tag tag-pro">{PLAN_NAME[conta.plan]}</span></dd>
          <dt>administração</dt>
          <dd>{conta.isAdmin ? 'sim' : 'não'}</dd>
          <dt>id</dt>
          <dd className="mono t-xs" style={{ overflowWrap: 'anywhere' }}>{conta.userId}</dd>
        </dl>
        {cota && (
          <div className="stat-row" style={{ marginTop: 14 }}>
            <div><div className="v num">{cota.today}</div><div className="l">execuções hoje</div></div>
            <div><div className="v num">{cota.daily}</div><div className="l">limite diário</div></div>
            <div><div className="v num">{Math.max(0, cota.daily - cota.today)}</div><div className="l">restantes</div></div>
            <div><div className="v num">{cota.inflight ?? 0}/{cota.concurrent ?? '—'}</div><div className="l">em curso</div></div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- plano */}
      <div className="card">
        <div className="card-head">
          <span>Plano</span>
          <span className="grow" />
          <div className="card-head-actions">
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'plans' })}>
              ver planos
            </button>
          </div>
        </div>
        {plans === null ? (
          <Skeleton lines={3} />
        ) : !plano ? (
          <Note kind="info">
            O servidor não devolveu o plano <span className="mono">{user.plan}</span> em
            {' '}<span className="mono">GET /api/plans</span>. Mostra-se só o identificador —
            nenhum limite é deduzido.
          </Note>
        ) : (
          <>
            <div className="t-h2">{plano.name}</div>
            <div className="t-sm dim" style={{ marginBottom: 12 }}>
              {plano.priceBRL === 0 ? 'Grátis' : `R$ ${plano.priceBRL.toFixed(2).replace('.', ',')} por mês`} · {plano.highlight}
            </div>
            <dl className="kv">
              <dt>execuções/dia</dt>
              <dd>{plano.dailyRuns} · ráfaga {plano.burstRuns}</dd>
              <dt>itens por resultado</dt>
              <dd>{plano.maxItems}</dd>
              <dt>concorrência</dt>
              <dd>{plano.concurrent}</dd>
              <dt>investigações</dt>
              <dd>{plano.investigations}</dd>
              <dt>salto do grafo</dt>
              <dd>{plano.graphHops}</dd>
            </dl>
            <p className="t-xs dim" style={{ marginTop: 10 }}>
              Estes limites são validados no servidor, linha a linha.
            </p>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------ chaves */}
      <div className="card">
        <div className="card-head">
          <span>Chaves API (BYOK)</span>
          <span className="grow" />
          <div className="card-head-actions">
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => setView({ k: 'keys' })}>
              abrir chaves
            </button>
          </div>
        </div>
        {keys === null ? (
          <Skeleton lines={2} />
        ) : keys.length === 0 ? (
          <p className="t-sm muted">
            Nenhuma chave guardada. Sem chave, as ferramentas que dependem de fonte paga dizem o
            que falta em vez de inventar resultados.
          </p>
        ) : (
          <div className="t-sm muted">
            {keys.length} chave(s) guardada(s): <span className="mono">{keys.map((k) => k.provider).join(', ')}</span>.
            Guardadas cifradas no servidor e nunca devolvidas pela API.
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- contacto */}
      <div className="card">
        <div className="card-head">Contacto do autor</div>
        <p className="t-sm muted" style={{ marginBottom: 12 }}>
          O número vem do servidor (<span className="mono">GET /api/contact</span>), não está
          escrito à mão neste ecrã.
        </p>
        {wa ? (
          <>
            <div className="row">
              <a className="btn btn-quiet" href={wa.link} target="_blank" rel="noopener noreferrer">
                <Icon.phone width={15} height={15} /> {wa.label}
              </a>
              {wa.autorLink && (
                <a className="btn btn-quiet" href={wa.autorLink} target="_blank" rel="noopener noreferrer">
                  <Icon.globe width={15} height={15} /> {wa.autor}
                </a>
              )}
            </div>
            <p className="t-xs dim" style={{ marginTop: 12 }}>
              {wa.copyright}
              {wa.autor ? ` · ${wa.autor}` : ''}
            </p>
          </>
        ) : (
          <Note kind="info">
            Contacto indisponível: o servidor ainda não respondeu a <span className="mono">/api/contact</span>.
            Sem resposta não se mostra número nenhum — mostrar um número errado é pior que não
            mostrar nenhum.
          </Note>
        )}
      </div>

      {/* ----------------------------------------------------- preferências */}
      <div className="card">
        <div className="card-head">Preferências de apresentação</div>
        <Note kind="info">
          Estas opções ficam em <span className="mono">localStorage</span> <b>neste navegador</b>:
          não viajam para o servidor, não sincronizam entre aparelhos e não alteram o que o ARGOS
          sabe sobre si.
        </Note>
        <div style={{ height: 6 }} />

        <div className="pref">
          <div className="pref-head">
            <span className="pref-nome">Densidade das tabelas</span>
            <span className="grow" />
            <span className="tag tag-legal">guardado neste navegador</span>
          </div>
          <div className="pref-desc">
            Altura das linhas em todas as tabelas (Health, Radar, perfil, histórico e sessões).
          </div>
          <div className="row">
            <button className="chip" type="button" aria-pressed={prefs.densidade === 'confortavel'}
              onClick={() => alterar('densidade', 'confortavel')}>
              confortável
            </button>
            <button className="chip" type="button" aria-pressed={prefs.densidade === 'compacta'}
              onClick={() => alterar('densidade', 'compacta')}>
              compacta
            </button>
          </div>
        </div>

        <div className="pref">
          <div className="pref-head">
            <span className="pref-nome">Linhas alternadas nas tabelas</span>
            <span className="grow" />
            <span className="tag tag-legal">guardado neste navegador</span>
          </div>
          <div className="pref-desc">
            Pinta uma em duas linhas para mais colunas se seguirarem ao mesmo tempo.
          </div>
          <div className="row">
            <button className="chip" type="button" aria-pressed={prefs.zebra === 'nao'}
              onClick={() => alterar('zebra', 'nao')}>
              desligado
            </button>
            <button className="chip" type="button" aria-pressed={prefs.zebra === 'sim'}
              onClick={() => alterar('zebra', 'sim')}>
              ligado
            </button>
          </div>
        </div>

        <p className="t-xs dim" style={{ marginTop: 12 }}>
          Não há opção de tema claro: o sistema visual é escuro por decisão de identidade e o CSS
          atual não tem um segundo tema. Um botão que não mudava nada seria enganoso.
        </p>
      </div>
    </div>
  );
}
