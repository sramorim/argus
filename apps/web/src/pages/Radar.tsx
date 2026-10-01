/**
 * Presence Radar — o que mudou na presença pública de um alvo.
 *
 * O radar compara dois snapshots guardados pelo ARGOS. Duas honestidades que
 * este ecrã tem de transmitir sem depender do utilizador as deduzir:
 *
 *  - **Sem anterior não há comparação.** Na primeira observação
 *    (`temAnterior: false`) diz-se que não existe snapshot anterior. Escrever
 *    "nada mudou" seria mentira com a mesma cara.
 *  - **Radar não vigia ninguém.** Ele compara o que já foi observado em
 *    execuções anteriores; não tem canal nenhum para notificar a pessoa.
 *
 * A nota da API é mostrada por inteiro, por cima de qualquer interpretação.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type EstadoRadar, type RespostaRadar } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, Skeleton, useToast } from '../components/ui';
import { EscolherInvestigacao, useInvestigacoes, quando } from '../components/Intel';
import type { View } from './AppShell';

const CLASSE_ESTADO: Record<EstadoRadar, string> = {
  NEW: 'mud-new',
  REMOVED: 'mud-removed',
  CHANGED: 'mud-changed',
  UNCHANGED: 'mud-unchanged',
};

const ROTULO_ESTADO: Record<EstadoRadar, string> = {
  NEW: 'novo',
  REMOVED: 'removido',
  CHANGED: 'alterado',
  UNCHANGED: 'inalterado',
};

function Selo({ estado }: { estado: string }) {
  const classe = CLASSE_ESTADO[estado as EstadoRadar] ?? 'mud-unchanged';
  const rotulo = ROTULO_ESTADO[estado as EstadoRadar] ?? estado;
  return <span className={`tag ${classe}`}>{rotulo}</span>;
}

export default function Radar({ setView }: { setView: (v: View) => void }) {
  const { lista, erro: erroLista } = useInvestigacoes();
  const [inv, setInv] = useState('');
  const [res, setRes] = useState<RespostaRadar | null>(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!inv && lista && lista.length) setInv(lista[0].id);
  }, [lista, inv]);

  const observar = async () => {
    if (!inv) return;
    setBusy(true);
    setErro('');
    try {
      const r = await api.radar(inv);
      setRes(r);
      if (!r.radar.temAnterior) {
        toast('info', 'Primeira observação guardada: a próxima comparação já terá anterior.');
      } else {
        toast('ok', 'Radar calculado a partir dos dois snapshots guardados.');
      }
    } catch (e) {
      setErro((e as ApiError).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  const detetados = res?.radar.detetados ?? [];
  const rs = res?.radar.resumo;

  return (
    <div className="page page-wide">
      <header className="card">
        <h1 className="t-h1">Presence Radar</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '70ch' }}>
          Compara a presença pública observada agora com o snapshot anterior guardado pelo ARGOS
          para a mesma investigação. Cada observação guarda o estado atual — a comparação só
          existe a partir da segunda.
        </p>
      </header>

      {/* ------------------------------------------------------ escolha do alvo */}
      <div className="card">
        <div className="card-head">Investigação</div>
        {erroLista && <Note kind="err">{erroLista}</Note>}
        {!lista && !erroLista ? (
          <Skeleton lines={2} />
        ) : lista && lista.length === 0 ? (
          <Empty icon={Icon.eye} title="Ainda não há investigações" action={
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>
              criar investigação
            </button>
          }>
            O radar observa uma investigação que já correu ferramentas: é aí que os nós com data,
            bio e links vêm parar ao snapshot.
          </Empty>
        ) : lista ? (
          <>
            <EscolherInvestigacao lista={lista} valor={inv} onChange={setInv} />
            <div style={{ height: 12 }} />
            <button className="btn btn-primary" type="button" onClick={observar} disabled={!inv || busy}>
              {busy ? <span className="spin" /> : <><Icon.eye /> observar presença</>}
            </button>
            <div className="t-xs dim" style={{ marginTop: 10 }}>
              A observação grava o estado atual no servidor. Diga-se desde já: sem snapshot
              anterior não há comparação possível.
            </div>
          </>
        ) : null}
      </div>

      {erro && (
        <div className="card">
          <Note kind="err">{erro}</Note>
        </div>
      )}

      {res && (
        <>
          {/* ------------------------------------------------------- nota da API */}
          <div className="card">
            <div className="card-head">
              <span>Nota da API</span>
              <span className="grow" />
              <span className="t-xs dim num">comparado em {quando(res.radar.comparadoEm)}</span>
            </div>

            <Note kind={res.radar.temAnterior ? 'info' : 'warn'}>{res.nota}</Note>
            <div style={{ height: 10 }} />
            <p className="t-sm muted">{res.radar.nota}</p>

            {!res.radar.temAnterior && (
              <>
                <div style={{ height: 10 }} />
                <Note kind="warn">
                  <b>Não há snapshot anterior</b> — o pedido devolveu <span className="mono">anterior: null</span>.
                  Esta é a primeira observação deste alvo: guarda o estado e volte a pedir o radar
                  depois de repetir as ferramentas. Aqui não se afirma que <b>nada mudou</b>, porque
                  ainda não existe nada com que comparar.
                </Note>
              </>
            )}

            <div className="stat-row" style={{ marginTop: 14 }}>
              <div><div className="v num">{rs?.NEW ?? 0}</div><div className="l">novos</div></div>
              <div><div className="v num">{rs?.REMOVED ?? 0}</div><div className="l">removidos</div></div>
              <div><div className="v num">{rs?.CHANGED ?? 0}</div><div className="l">alterados</div></div>
              <div><div className="v num">{rs?.UNCHANGED ?? 0}</div><div className="l">inalterados</div></div>
              <div><div className="v num">{rs?.alteracoes ?? 0}</div><div className="l">alterações</div></div>
            </div>

            <div className="t-xs dim" style={{ marginTop: 10 }}>
              anterior {res.anterior ? `capturado em ${quando(res.anterior.capturadoEm)}` : '— nenhum guardado'} ·
              {' '}atual guardado em {quando(res.atual.capturadoEm)}
            </div>
          </div>

          {/* --------------------------------------------------------- detetados */}
          <div className="card">
            <div className="card-head">Detetados · {detetados.length}</div>
            {detetados.length === 0 ? (
              <p className="t-sm dim">
                {res.radar.temAnterior
                  ? 'Sem alterações entre os dois snapshots: o estado observado é idêntico ao anterior.'
                  : 'A primeira observação não devolve detetados — não há anterior para comparar.'}
              </p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Estado</th>
                      <th>Caminho</th>
                      <th>Antes</th>
                      <th>Depois</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detetados.map((d, i) => (
                      <tr key={`${d.valor}-${i}`}>
                        <td data-l="categoria" className="t-xs">{d.categoria}</td>
                        <td data-l="estado"><Selo estado={d.estado} /></td>
                        <td data-l="caminho" className="mono t-xs" style={{ overflowWrap: 'anywhere', maxWidth: 240 }}>{d.valor}</td>
                        <td data-l="antes" className="t-xs dim" style={{ overflowWrap: 'anywhere', maxWidth: 200 }}>{d.antes ?? '—'}</td>
                        <td data-l="depois" className="t-xs" style={{ overflowWrap: 'anywhere', maxWidth: 200 }}>{d.depois ?? '—'}</td>
                        <td data-l="nota" className="t-xs muted" style={{ overflowWrap: 'anywhere', maxWidth: 280 }}>{d.nota}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ------------------------------------------------------ proveniência */}
          <div className="card">
            <div className="card-head">Proveniência</div>
            <dl className="kv">
              <dt>investigação</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{res.investigacao.titulo}</dd>
              <dt>alvo</dt>
              <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{res.investigacao.alvo}</dd>
              <dt>id</dt>
              <dd className="mono t-xs" style={{ overflowWrap: 'anywhere' }}>{res.investigacao.id}</dd>
            </dl>
            <div style={{ marginTop: 12 }}>
              <Note kind="info">
                O radar <b>não vigia ninguém</b>: compara o que o ARGOS já observou em execuções
                anteriores desta investigação. Um intervalo sem eventos é um intervalo sem coleta,
                não uma prova de silêncio.
              </Note>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
