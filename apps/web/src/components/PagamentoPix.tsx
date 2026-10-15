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
import { api, type PlanId } from '../api';
import { Icon } from './Icons';
import { useToast } from './ui';

function campoPix(id: string, valor: string): string {
  const tamanho = new TextEncoder().encode(valor).length;
  return `${id}${String(tamanho).padStart(2, '0')}${valor}`;
}

function crc16Pix(texto: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function payloadPix(chave: string, preco: number, nome: string, cidade: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)
    && !/^\+55\d{10,11}$/.test(chave)) return null;
  if (!nome.trim() || !cidade.trim()) return null;
  const recebedor = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25);
  const municipio = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15);
  if (!recebedor || !municipio) return null;
  const contaPix = campoPix('00', 'BR.GOV.BCB.PIX') + campoPix('01', chave);
  const adicional = campoPix('05', '***');
  const base = campoPix('00', '01') + campoPix('26', contaPix) + campoPix('52', '0000')
    + campoPix('53', '986') + campoPix('54', preco.toFixed(2)) + campoPix('58', 'BR')
    + campoPix('59', recebedor) + campoPix('60', municipio) + campoPix('62', adicional) + '6304';
  return `${base}${crc16Pix(base)}`;
}

export default function PagamentoPix({
  chave, preco, vitalicio, numero, email, planId, planName, nomeRecebedor, cidadeRecebedor, compacto = false,
}: {
  chave: string;
  preco: number;
  vitalicio: boolean;
  numero: string;
  email: string;
  planId: PlanId;
  planName: string;
  nomeRecebedor: string;
  cidadeRecebedor: string;
  /** Versão para o cartão de planos: a mesma coisa, com menos ar. */
  compacto?: boolean;
}) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  /* Gera BR Code Pix EMV com valor fixo; sem dados bancários completos,
     mantemos a cópia da chave disponível e não exibimos um QR enganoso. */
  const svg = useMemo(() => {
    try {
      const payload = payloadPix(chave, preco, nomeRecebedor, cidadeRecebedor);
      if (!payload) return null;
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      /* Uma chave que não caiba num QR tem de continuar a ser utilizável: o
         código e o botão de copiar estão logo abaixo. Devolve-se nada e segue. */
      return null;
    }
  }, [chave, preco, nomeRecebedor, cidadeRecebedor]);

  const precoTxt = `R$ ${preco.toFixed(2).replace('.', ',')}`;
  const periodo = vitalicio ? 'vitalício' : 'mensal';

  /* O comprovante vai escrito: o que a pessoa teve de dizer para pedir o
     plano (qual plano, que valor) e o que o dono precisa para saber a quem
     ativar (o email com que a pessoa entrou). */
  const texto = `Olá, paguei o plano ${planName}, segue comprovante.\nE-mail cadastrado: ${email}`;
  const waLink = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

  const jaPaguei = async () => {
    // Abre a janela no gesto original para os navegadores móveis não bloquearem
    // o WhatsApp depois da resposta da API.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setEnviando(true);
    try {
      await api.pixIntent(planId);
      if (popup) popup.location.href = waLink;
      else window.location.assign(waLink);
    } catch (e) {
      popup?.close();
      toast('err', e instanceof Error ? e.message : 'Não foi possível registrar o aviso de pagamento. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

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

      {svg ? (
        <div className="pix-qr" role="img" aria-label="QR code da chave Pix">
          <div className="pix-qr-caixa" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="t-xs dim">Pix de {precoTxt}. Escaneie pelo aplicativo do seu banco.</p>
        </div>
      ) : <p className="t-xs dim">Copie a chave Pix no seu banco e informe o valor de {precoTxt}. O QR Pix será exibido quando os dados do recebedor estiverem completos.</p>}

      <button className="btn btn-primary btn-block" type="button" onClick={jaPaguei} disabled={enviando}>
        <Icon.phone width={18} height={18} /> {enviando ? 'Registrando aviso…' : 'JA PAGUEI'}
      </button>
      <p className="t-xs dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
        O clique avisa a administração. No WhatsApp, anexe o comprovante; o acesso é liberado
        manualmente depois da conferência.
      </p>
    </div>
  );
}
