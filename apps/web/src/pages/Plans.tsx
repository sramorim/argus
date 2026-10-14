import { useEffect, useState } from 'react';
import { api, type Contacto, type Plan, type ToolPublic, type User, CONTACTO, useContacto, pedidoPlanoLink, precoTexto, periodoCurto } from '../api';
import { Icon } from '../components/Icons';
import { Modal, Note, Skeleton } from '../components/ui';
import PagamentoPix from '../components/PagamentoPix';

export default function Plans({ user }: { user: User }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  /* Só para a tabela comparativa: que ferramentas cada plano abre. É a mesma
     lista do painel, com o `minPlan` que o servidor devolve — nada aqui é
     escrito à mão. */
  const [tools, setTools] = useState<ToolPublic[] | null>(null);
  const [ask, setAsk] = useState<Plan | null>(null);
  const wa = useContacto();

  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);
  useEffect(() => { api.tools().then((r) => setTools(r.tools)).catch(() => setTools([])); }, []);

  return (
    <div className="page">
      <header className="card">
        <h1 className="t-h1">Planos</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '62ch' }}>
          O Free não expira e não pede cartão. Os limites são todos validados no servidor: o que
          aparece aqui é exatamente o que o backend aplica, linha a linha.
        </p>
      </header>

{plans === null ? <Skeleton lines={6} /> : (
          <div className="plan-grid">
            {plans.map((p) => (
              <PlanCardView
                key={p.id} p={p} current={user.plan === p.id}
                onAsk={() => setAsk(p)}
                pix={p.id === 'pro' ? wa : null}
                email={user.email}
              />
            ))}
          </div>
        )}

        {/*
         * Tabela comparativa: ferramenta a ferramenta, o que cada plano abre.
         * O ✓ do Free acende quando `minPlan` é `free`; o do Pro quando o plano
         * Pro chega lá (`free` ou `pro`). O Pro Max não tem coluna: tudo o que
         * o Pro abre, ele abre — uma terceira coluna de ✓ repetidos não diz
         * nada a ninguém.
         */}
        {tools !== null && tools.length > 0 && (
          <div className="card tabela-card">
            <div className="card-head">Ferramenta · Free · Pro</div>
            <div className="tbl-wrap">
              <table className="tbl tabela-planos">
                <thead>
                  <tr><th scope="col">Ferramenta</th><th scope="col">Free</th><th scope="col">Pro</th></tr>
                </thead>
                <tbody>
                  {tools.map((t) => (
                    <tr key={t.id}>
                      <td data-l="ferramenta">{t.name}</td>
                      <td data-l="free">
                        {t.minPlan === 'free'
                          ? <span className="check-ok"><Icon.check width={18} height={18} /></span>
                          : <span className="check-nao" aria-label="não incluído">—</span>}
                      </td>
                      <td data-l="pro">
                        {t.minPlan !== 'pro_max'
                          ? <span className="check-ok"><Icon.check width={18} height={18} /></span>
                          : <span className="check-nao" aria-label="não incluído">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">Como funciona a ativação</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Note kind="info">
            Pix direto para o responsável. O botão JA PAGUEI avisa a administração; o acesso Pro
            é liberado manualmente depois da conferência do comprovante.
          </Note>
          <div className="t-sm muted" style={{ display: 'grid', gap: 6 }}>
            <p><b>1.</b> Copie a chave Pix e transfira o valor exibido no plano.</p>
            <p><b>2.</b> Toque em JA PAGUEI e envie o comprovante pelo WhatsApp que abrir.</p>
            <p><b>3.</b> Depois da conferência, a administração libera o Pro para sua conta.</p>
          </div>
          <div>
            {wa && <a className="btn btn-quiet" href={wa.link} target="_blank" rel="noopener noreferrer">
              {wa.label}
            </a>}
          </div>
        </div>
      </div>

      <Modal
        open={!!ask} onClose={() => setAsk(null)}
        title={`Ativar o plano ${ask?.name ?? ''}`}
        actions={ask && ask.id !== 'pro' ? (
          <a className="btn btn-primary" href={pedidoPlanoLink(ask, user, wa?.whatsapp ?? CONTACTO.whatsapp)} target="_blank" rel="noopener noreferrer">
            <Icon.phone width={15} height={15} /> conversar no WhatsApp
          </a>
        ) : undefined}
      >
        {ask && (
          <>
            <p className="t-sm muted">
              {ask.priceBRL === 0
                ? 'O plano Free é o teu plano atual.'
                : `${ask.name} — ${precoTexto(ask)}.`}
            </p>
            <ul className="plan-perks" style={{ marginTop: 12 }}>
              {ask.perks.map((k) => <li key={k}>{k}</li>)}
            </ul>

            {/* O Pix entra aqui, e só aqui: dentro do pedido de ativação. Não há
                gateway de pagamento, e a chave não está escrita no código — vem
                do servidor (PIX_KEY). */}
            {ask.id === 'pro' && ask.priceBRL > 0 && wa?.pix && wa.whatsapp && (
              <PagamentoPix
                chave={wa.pix}
                preco={ask.priceBRL}
                vitalicio={ask.pricePeriod === 'unico'}
                numero={wa.whatsapp}
                email={user.email}
                planId={ask.id}
                planName={ask.name}
                nomeRecebedor={wa.pixNome ?? ''}
                cidadeRecebedor={wa.pixCidade ?? ''}
              />
            )}

            {ask.id === 'pro' && ask.priceBRL > 0 && !wa?.pix && (
              <Note kind="warn">O Pix ainda não está configurado. Fale com a administração para concluir o pagamento.</Note>
            )}

            <Note kind="warn">
              Nenhum cartão passa por este site. A ativação é confirmada à mão, depois de vermos
              o comprovante.
            </Note>
          </>
        )}
      </Modal>
    </div>
  );
}

function PlanCardView({
  p, current, onAsk, pix, email,
}: {
  p: Plan;
  current: boolean;
  onAsk: () => void;
  /** Só o Pro tem Pix no cartão — ver o comentário dentro. */
  pix: Contacto | null;
  email: string;
}) {
  return (
    <div className="plan-card" data-current={current}>
      {current && <span className="plan-badge">ATUAL</span>}
      <div className="plan-name">{p.name}</div>
      <div className="plan-price">
        {p.priceBRL === 0 ? 'Grátis' : `R$ ${p.priceBRL.toFixed(2).replace('.', ',')}`}
        {p.priceBRL > 0 && <small>{periodoCurto(p)}</small>}
      </div>
      <div className="plan-note">{p.highlight}</div>
      <ul className="plan-perks">
        {p.perks.map((k) => <li key={k}>{k}</li>)}
      </ul>
      <button className={`btn btn-block btn-continuar ${!current && p.priceBRL > 0 ? 'btn-primary' : 'btn-quiet'}`}
        type="button" onClick={onAsk} disabled={current}>
        {current ? 'plano atual' : p.priceBRL === 0 ? 'voltar ao Free' : 'Continuar'}
      </button>
      {!current && p.priceBRL === 0 && (
        <p className="t-xs dim" style={{ marginTop: 8, textAlign: 'center' }}>a downgrade também é feita à mão</p>
      )}

      {/*
       * A chave Pix fica no cartão, e não só dentro do modal de "ativar".
       *
       * A pessoa que decide se paga é a que tem a chave à frente; pedir-lhe
       * que abra um modal para a ver é um passo a mais entre a decisão e o
       * pagamento. O bloco é o mesmo componente do modal — mesmo QR, mesma
       * mensagem, uma implementação só.
       *
       * Só no Pro: é o plano que se vende por Pix. O Pro Max (R$ 79,90/mês)
       * continua a ser combinado por WhatsApp, e fingir que tem checkout é
       * pior do que não ter.
       */}
      {!current && pix?.pix && (
        <PagamentoPix
          chave={pix.pix}
          preco={p.priceBRL}
          vitalicio={p.pricePeriod === 'unico'}
          numero={pix.whatsapp}
          email={email}
          planId={p.id}
          planName={p.name}
          nomeRecebedor={pix.pixNome ?? ''}
          cidadeRecebedor={pix.pixCidade ?? ''}
          compacto
        />
      )}
      {p.id === 'pro' && !pix?.pix && (
        <p className="t-xs dim" style={{ marginTop: 12, textAlign: 'center' }}>
          Pix direto ainda não configurado. Fale com a administração.
        </p>
      )}
    </div>
  );
}
