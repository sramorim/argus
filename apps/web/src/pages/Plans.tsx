import { useEffect, useState } from 'react';
import { api, type Plan, type User, CONTACTO, useContacto, pedidoPlanoLink } from '../api';
import { Icon } from '../components/Icons';
import { Modal, Note, Skeleton, useToast } from '../components/ui';

export default function Plans({ user }: { user: User }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [ask, setAsk] = useState<Plan | null>(null);
  const toast = useToast();
  const wa = useContacto();

  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

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
            <PlanCardView key={p.id} p={p} current={user.plan === p.id} onAsk={() => setAsk(p)} />
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">Como funciona a ativação</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Note kind="info">
            Não há gateway de pagamento integrado. A ativação é feita à mão depois de confirmada a
            transferência — é uma decisão de produto, não uma limitação técnica.
          </Note>
          <div className="t-sm muted" style={{ display: 'grid', gap: 6 }}>
            <p><b>1.</b> Escolhes o plano e abres o WhatsApp com a mensagem já escrita.</p>
            <p><b>2.</b> Confirmamos o pagamento e mudamos o plano na base de dados.</p>
            <p><b>3.</b> Recarregas a página: o plano, as cotas e as ferramentas trancadas mudam logo.</p>
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
        actions={ask ? (
          <>
            <button className="btn btn-quiet" type="button" onClick={async () => {
              const link = pedidoPlanoLink(ask, user, wa?.whatsapp ?? CONTACTO.whatsapp);
              try {
                await navigator.clipboard.writeText(link);
                toast('ok', 'Link do pedido copiado. É só abrir e enviar.');
              } catch {
                toast('err', 'O navegador não deixou copiar. Abre o botão do WhatsApp.');
              }
            }}>
              <Icon.copy width={15} height={15} /> copiar
            </button>
            <a className="btn btn-primary" href={pedidoPlanoLink(ask, user, wa?.whatsapp ?? CONTACTO.whatsapp)}
              target="_blank" rel="noopener noreferrer">
              <Icon.phone width={15} height={15} /> pedir no WhatsApp
            </a>
          </>
        ) : undefined}
      >
        {ask && (
          <>
            <p className="t-sm muted">
              {ask.priceBRL === 0
                ? 'O plano Free é o teu plano atual.'
                : `${ask.name} — R$ ${ask.priceBRL.toFixed(2).replace('.', ',')} por mês, sem taxa de adesão.`}
            </p>
            <ul className="plan-perks" style={{ marginTop: 12 }}>
              {ask.perks.map((k) => <li key={k}>{k}</li>)}
            </ul>
            <Note kind="warn">
              A cobrança continua a ser combinada diretamente connosco. Nenhum número de cartão
              passa por este site.
            </Note>
            {/* O botão abre o WhatsApp com o pedido já escrito. Nada é "registado"
                no servidor: quem ativa o plano é a pessoa do outro lado, depois de
                confirmar a transferência. */}
            <p className="t-xs dim" style={{ marginTop: 12 }}>
              Ao carregar, abrimos o WhatsApp com o pedido escrito. Fica a decisão de enviar.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}

function PlanCardView({ p, current, onAsk }: { p: Plan; current: boolean; onAsk: () => void }) {
  return (
    <div className="plan-card" data-current={current}>
      {current && <span className="plan-badge">ATUAL</span>}
      <div className="plan-name">{p.name}</div>
      <div className="plan-price">
        {p.priceBRL === 0 ? 'Grátis' : `R$ ${p.priceBRL.toFixed(2).replace('.', ',')}`}
        {p.priceBRL > 0 && <small> /mês</small>}
      </div>
      <div className="plan-note">{p.highlight}</div>
      <ul className="plan-perks">
        {p.perks.map((k) => <li key={k}>{k}</li>)}
      </ul>
      <button className={`btn btn-block ${!current && p.priceBRL > 0 ? 'btn-primary' : 'btn-quiet'}`}
        type="button" onClick={onAsk} disabled={current}>
        {current ? 'plano atual' : p.priceBRL === 0 ? 'voltar ao Free' : 'ativar este plano'}
      </button>
      {!current && p.priceBRL === 0 && (
        <p className="t-xs dim" style={{ marginTop: 8, textAlign: 'center' }}>a downgrade também é feita à mão</p>
      )}
    </div>
  );
}
