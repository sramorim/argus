/**
 * Gerenciar limites — a página de créditos.
 *
 * Fica dentro da Conta (Conta › Gerenciar limites) e é o **único** sítio do
 * produto onde se pede uma chave ao utilizador. Está aqui, e não na tela da
 * ferramenta, por uma razão: quem chega aqui já bateu no limite ou quer
 * gerir o consumo de propósito. No meio do fluxo principal, um campo de token
 * parece uma obrigacao — e ninguem devia ter de trazer uma chave para usar o
 * produto.
 *
 * Duas secções, e a ordem é a do menos para o mais compromisso:
 *
 *   A. **Meu saldo (chave partilhada)** — a chave do servidor, o tecto do
 *      plano e um botão para comprar mais. É o caminho normal.
 *   B. **A minha própria chave** — para quem prefere pagar à DataLikers
 *      diretamente e usar sem tecto nosso. Vem com o link de parceiro.
 *
 * O número que aparece aqui é o mesmo que o servidor usa para decidir: vem de
 * `GET /api/creditos`, não é contado no browser.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type EstadoCreditos, ApiError } from '../api';
import { Icon } from '../components/Icons';
import { Note, Skeleton, useToast } from '../components/ui';

export default function GerenciarLimites({ onVoltar }: { onVoltar?: () => void } = {}) {
  const [cr, setCr] = useState<EstadoCreditos | null>(null);
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState('');
  const [aGravar, setAGravar] = useState(false);
  const toast = useToast();

  const carregar = useCallback(
    () => api.creditos().then(setCr).catch((e) => setErro((e as ApiError).message)),
    [],
  );
  useEffect(() => { carregar(); }, [carregar]);

  if (!cr) {
    return erro
      ? <Note kind="err">{erro}</Note>
      : <div className="card"><Skeleton lines={4} /></div>;
  }

  const pct = cr.limite > 0 ? Math.min(100, Math.round((cr.usados / cr.limite) * 100)) : 0;
  const periodo = cr.periodo;

  const gravar = async () => {
    setErro('');
    setAGravar(true);
    try {
      await api.guardarChaveDados(chave.trim());
      setChave('');
      await carregar();
      toast('ok', 'Chave guardada. A partir de agora conta contra a sua conta.');
    } catch (e) {
      // A chave é validada no servidor antes de ser guardada: um segredo
      // errado guardado é um segredo guardado.
      setErro((e as ApiError).message);
    } finally { setAGravar(false); }
  };

  const remover = async () => {
    setErro('');
    try {
      await api.removerChaveDados();
      await carregar();
      toast('ok', 'Chave removida. Volta a usar a chave partilhada.');
    } catch (e) { setErro((e as ApiError).message); }
  };

  return (
    <div className="page">
      <button
        className="btn btn-quiet btn-sm"
        type="button"
        style={{ marginBottom: 12, alignSelf: 'flex-start' }}
        onClick={() => onVoltar?.()}
      >
        <Icon.arrowLeft width={14} height={14} /> voltar
      </button>

      <header className="card">
        <div className="regra"><span className="micro">Gerenciar limites</span></div>
        <h1 className="t-h1">Créditos e limites</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '64ch', lineHeight: 1.65 }}>
          As consultas ao cache da DataLikers são o que consome limite. Por omissão usam a chave
          partilhada do ARGOS, sujeita a um tecto mensal do teu plano. Se preferires a tua conta,
          cola a tua chave abaixo — e passa a não ter tecto nosso.
        </p>
      </header>

      {erro && <Note kind="err">{erro}</Note>}

      {/* ---------------- Secção A: saldo partilhado ---------------- */}
      <section className="card">
        <div className="card-head">Secção A · Meu saldo (chave partilhada)</div>

        {cr.temChavePropria ? (
          <Note kind="ok">
            Tens a tua própria chave guardada. As consultas vão contra a tua conta da DataLikers
            e <b>não contam</b> para o tecto partilhado — o limite agora é o do teu plano lá.
          </Note>
        ) : (
          <>
            <div className="uso-topo">
              <span className="uso-num">
                <b>{cr.usados}</b>/{cr.limite} usadas
              </span>
              <span className="micro">período {periodo}</span>
            </div>
            <div className="meter" role="img" aria-label={`${cr.usados} de ${cr.limite} consultas usadas`}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="t-xs dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
              {cr.limite === 0
                ? 'O teu plano não tem consultas de DataLikers incluídas.'
                : pct >= 100
                  ? 'Chegaste ao tecto. Recarrega para continuar, ou usa a tua conta na secção B.'
                  : `Restam ${Math.max(0, cr.limite - cr.usados)} neste período.`}
            </p>
            <div className="row" style={{ marginTop: 14 }}>
              <a className="btn btn-primary" href={cr.checkoutUrl} target="_blank" rel="noopener noreferrer">
                <Icon.coins width={18} height={18} /> Comprar 100 extras
              </a>
            </div>
            <p className="t-xs dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
              Não temos gateway de pagamento: a recarga é combinada connosco e ativada à mão.
            </p>
          </>
        )}
      </section>

      {/* ---------------- Secção B: chave própria ---------------- */}
      <section className="card">
        <div className="card-head">Secção B · Usar minha própria chave</div>

        <p className="t-sm muted" style={{ lineHeight: 1.7 }}>
          Para uso ilimitado, crie a sua conta DataLikers pelo nosso link parceiro e cole a sua
          chave abaixo. Você ganha bônus e nós recebemos comissão.
        </p>

        <a
          className="btn btn-quiet"
          href={cr.afiliadoUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginTop: 12 }}
        >
          <Icon.link width={16} height={16} /> Criar conta na DataLikers (link parceiro) ↗
        </a>

        <div className="divider" />

        {cr.temChavePropria ? (
          <>
            <div className="row-tight">
              <span className="ponto" data-e="ok" />
              <span className="t-sm">Chave guardada.</span>
            </div>
            <p className="t-xs dim" style={{ marginTop: 6, lineHeight: 1.6 }}>
              Fica cifrada em disco (AES-256-GCM) e nunca mais é mostrada. Para a mudar, apague-a
              e cole a nova.
            </p>
            <button className="btn btn-quiet" type="button" style={{ marginTop: 12 }} onClick={remover}>
              <Icon.trash width={16} height={16} /> Remover
            </button>
          </>
        ) : (
          <>
            <p className="t-sm muted" style={{ marginBottom: 10 }}>
              Após criar, copie sua API Key no dashboard deles e cole aqui:
            </p>
            <input
              className="input"
              type="password"
              value={chave}
              autoComplete="off"
              spellCheck={false}
              placeholder="a sua DATALIKERS_API_KEY"
              onChange={(e) => setChave(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && chave.trim()) gravar(); }}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" type="button" disabled={!chave.trim() || aGravar} onClick={gravar}>
                {aGravar ? <span className="spin" /> : <><Icon.plus width={18} height={18} /> Salvar</>}
              </button>
            </div>
            <p className="t-xs dim" style={{ marginTop: 10, lineHeight: 1.6 }}>
              Validamos a chave antes de guardar. Se for recusada, não fica guardada.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
