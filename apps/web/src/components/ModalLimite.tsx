/**
 * Modal de limite de créditos atingido.
 *
 * Aparece quando o servidor recusa um pedido por falta de crédito partilhado
 * (hoje: DataLikers). Diz **quanto** se usou e **quanto** havia — um limite
 * sem número não se pode planear nem comparar. O botão não pede uma conta
 * externa nem uma chave: leva à página de limites, onde a pessoa decide.
 *
 * O texto é o que a pessoa precisa e nada mais. Não há gateway de pagamento
 * neste produto, e o modal não finge que há.
 */
import { Icon } from './Icons';

export default function ModalLimite({
  abertos, limite, onFechar, onGerenciar,
}: {
  abertos: boolean;
  limite: number;
  onFechar: () => void;
  onGerenciar: () => void;
}) {
  if (!abertos) return null;
  return (
    <div className="scrim" onClick={onFechar} role="dialog" aria-modal="true" aria-label="Limite do plano atingido">
      <div className="modal modal-limite" onClick={(e) => e.stopPropagation()}>
        <div className="limite-ico"><Icon.alert /></div>
        <h3>Limite do plano atingido</h3>
        <p className="t-sm muted" style={{ lineHeight: 1.65 }}>
          Você atingiu seu limite de <b style={{ color: 'var(--t-1)' }}>{limite}</b> consultas deste plano.
          Os teus resultados anteriores continuam guardados e legíveis.
        </p>
        <div className="limite-acoes">
          <button className="btn btn-primary btn-block" type="button" onClick={onGerenciar}>
            Ver opções de recarga
          </button>
          <button className="btn btn-quiet btn-block" type="button" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
