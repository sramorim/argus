/**
 * Pagamento por Pix, dentro do pedido de ativação de plano.
 *
 * Três coisas e nenhuma a mais: a chave para copiar, o QR code para apontar a
 * câmara, e o botão que manda o comprovante para o WhatsApp.
 *
 * Duas decisões que valem a pena escrever:
 *
 *  1. **A chave vem do servidor.** Vem em `PIX_KEY` e chega pelo
 *     `/api/contact`. Escrever um identificador de pagamento dentro do
 *     bundle do browser é a forma mais rápida de cobrar a pessoa errada no dia
 *     em que a chave muda — e nenhuma troca de chave passa a exigir deploy.
 *  2. **O QR é desenhado em SVG, no browser.** `qrcode-generator` é uma
 *     biblioteca de um ficheiro, sem dependências: não há imagem externa, não
 *     há pedido de rede e o código aparece mesmo offline.
 */
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Icon } from './Icons';
import { useToast } from './ui';

export default function PagamentoPix({
  chave, preco, vitalicio, numero, email, compacto = false,
}: {
  chave: string;
  preco: number;
  vitalicio: boolean;
  numero: string;
  email: string;
  /** Versão para o cartão de planos: a mesma coisa, com menos ar. */
  compacto?: boolean;
}) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);

  /* O conteúdo do QR é a chave tal e qual — é o que a aplicação do banco lê. */
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(chave);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      /* Uma chave que não caiba num QR tem de continuar a ser utilizável: o
         código e o botão de copiar estão logo abaixo. Devolve-se nada e segue. */
      return null;
    }
  }, [chave]);

  const precoTxt = `R$ ${preco.toFixed(2).replace('.', ',')}`;
  const periodo = vitalicio ? 'vitalício' : 'mensal';

  /* O comprovante vai escrito: o que a pessoa teve de dizer para pedir o
     plano (qual plano, que valor) e o que o dono precisa para saber a quem
     ativar (o email com que a pessoa entrou). */
  const texto = `Olá! Paguei o plano PRO Argos (R$${preco.toFixed(2).replace('.', ',')}). Meu email no Argos é: ${email}`;
  const waLink = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(chave);
      setCopiado(true);
      toast('ok', 'Chave Pix copiada.');
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* O `clipboard` só existe em contexto seguro (https). Sem ele a pessoa
         vê a chave no campo e copia à mão — e diz-se isso, em vez de o botão
         não fazer nada e parecer quebrado. */
      toast('warn', 'O navegador não deixou copiar. Seleciona o código à mão.');
    }
  };

  return (
    <div className={`pix${compacto ? ' pix-compacto' : ''}`}>
      <div className="pix-head">
        <span className="micro">Chave Pix:</span>
        <span className="tag">{vitalicio ? `pagamento único · ${precoTxt}` : `${precoTxt} ${periodo}`}</span>
      </div>

      <div className="pix-linha">
        <code className="pix-chave">{chave}</code>
        <button className="btn btn-sm" type="button" onClick={copiar}>
          {copiado ? <><Icon.check width={15} height={15} /> copiado</> : <><Icon.copy width={15} height={15} /> Copiar</>}
        </button>
      </div>

      {svg && (
        <div className="pix-qr" role="img" aria-label="QR code da chave Pix">
          {/* `createSvgTag` devolve uma string SVG já com width/height 100%. */}
          <div className="pix-qr-caixa" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="t-xs dim">Ou aponte a câmara para o código.</p>
        </div>
      )}

      <a className="btn btn-primary btn-block" href={waLink} target="_blank" rel="noopener noreferrer">
        <Icon.phone width={18} height={18} /> Enviar comprovante no WhatsApp
      </a>
      <p className="t-xs dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
        O WhatsApp abre com o texto já escrito — só anexar o comprovante. A ativação é
        confirmada por nós, à mão.
      </p>
    </div>
  );
}
