/**
 * Unified Profile — o que o Intelligence Engine sabe sobre um alvo.
 *
 * O perfil junta as entidades dispersas por várias ferramentas numa só leitura,
 * mas **sem fundir o que não está provado**: as contas ficam listadas com a
 * sua confiança, as divergências viram lacuna, e cada bloco traz a evidência
 * que o sustenta. Duas regras que este ecrã não pode quebrar:
 *
 *  1. A faixa de confiança (HIGH/MEDIUM/LOW/UNCONFIRMED) é mostrada com o que
 *     ela não prova — nunca se escreve "é a mesma pessoa".
 *  2. A exportação vem do servidor (`/api/intel/relatorio`): são quatro
 *     formatos do MESMO conteúdo, não quatro reconstruções no cliente.
 */
import { useEffect, useState } from 'react';
import {
  api, ApiError, type FormatoRelatorio, type RespostaPerfil,
} from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, Skeleton, useToast } from '../components/ui';
import {
  EscolherInvestigacao, LEITOR_CONFIANCA, SeloConfianca, fontes, useInvestigacoes, quando,
} from '../components/Intel';
import type { View } from './AppShell';

const FORMATOS: { id: FormatoRelatorio; nome: string }[] = [
  { id: 'json', nome: 'JSON' },
  { id: 'csv', nome: 'CSV' },
  { id: 'html', nome: 'HTML' },
  { id: 'pdf', nome: 'PDF' },
];

export default function Perfil({ setView }: { setView: (v: View) => void }) {
  const { lista, erro: erroLista } = useInvestigacoes();
  const [inv, setInv] = useState('');
  const [res, setRes] = useState<RespostaPerfil | null>(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!inv && lista && lista.length) setInv(lista[0].id);
  }, [lista, inv]);

  const gerar = async () => {
    if (!inv) return;
    setBusy(true);
    setErro('');
    try {
      setRes(await api.perfil(inv));
    } catch (e) {
      setErro((e as ApiError).message);
      setRes(null);
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const p = res?.perfil;
  const cruz = res?.cruzamento;

  return (
    <div className="page page-wide">
      <header className="card">
        <h1 className="t-h1">Unified Profile</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '70ch' }}>
          Uma só leitura sobre o alvo: contas, identificadores, correlações, resoluções, lacunas,
          evidências, linha do tempo e atividade — tudo com proveniência e faixa de confiança,
          vindo de <span className="mono">GET /api/intel/perfil</span>.
        </p>
      </header>

      <div className="card">
        <div className="card-head">Investigação</div>
        {erroLista && <Note kind="err">{erroLista}</Note>}
        {!lista && !erroLista ? (
          <Skeleton lines={2} />
        ) : lista && lista.length === 0 ? (
          <Empty icon={Icon.layers} title="Ainda não há investigações" action={
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'nova' })}>
              criar investigação
            </button>
          }>
            O perfil unificado é calculado a partir dos nós do grafo: sem investigação com
            ferramentas corridas, não há entidades para unificar.
          </Empty>
        ) : lista ? (
          <>
            <EscolherInvestigacao lista={lista} valor={inv} onChange={setInv} />
            <div style={{ height: 12 }} />
            <button className="btn btn-primary" type="button" onClick={gerar} disabled={!inv || busy}>
              {busy ? <span className="spin" /> : <><Icon.layers /> gerar perfil</>}
            </button>
          </>
        ) : null}
      </div>

      {erro && (
        <div className="card">
          <Note kind="err">{erro}</Note>
        </div>
      )}

      {!res && !erro && busy && (
        <div className="card"><Skeleton lines={5} /></div>
      )}

      {res && p && (
        <>
          {/* ------------------------------------------------------- cabeçalho */}
          <div className="card">
            <div className="perfil-topo">
              <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                <div className="t-xs dim" style={{ marginBottom: 4 }}>
                  {res.investigacao.titulo} · {res.investigacao.tipo} · atualizado {quando(res.investigacao.atualizado)}
                </div>
                <h2 className="t-h1" style={{ overflowWrap: 'anywhere' }}>{p.rotulo}</h2>
                <div className="t-sm dim mono" style={{ overflowWrap: 'anywhere' }}>{res.investigacao.alvo}</div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
                <SeloConfianca confianca={p.confiancaGeral} />
                <span className="t-xs muted">{LEITOR_CONFIANCA[p.confiancaGeral]}</span>
              </div>
            </div>

            <div className="stat-row" style={{ marginTop: 14 }}>
              <div><div className="v num">{res.resumo.entidades}</div><div className="l">entidades</div></div>
              <div><div className="v num">{res.resumo.nos}</div><div className="l">nós</div></div>
              <div><div className="v num">{res.resumo.arestas}</div><div className="l">ligações</div></div>
              <div><div className="v num">{res.resumo.correlacoes}</div><div className="l">correlações</div></div>
              <div><div className="v num">{res.resumo.resolucoes}</div><div className="l">resoluções</div></div>
              <div><div className="v num">{p.evidencias.length}</div><div className="l">evidências</div></div>
            </div>

            <div style={{ marginTop: 14 }}>
              <Note kind="info">
                Correspondência entre entidades <b>nunca é afirmação de identidade</b>. Cada bloco
                abaixo traz a faixa de confiança e a nota do que ela não prova — usernames são
                reutilizáveis e é por isso que investigações morrem. Gerado em {quando(p.geradoEm)}.
              </Note>
            </div>
          </div>

          {/* ------------------------------------------------------ exportação */}
          <div className="card">
            <div className="card-head">Exportar relatório</div>
            <p className="t-sm muted" style={{ marginBottom: 12 }}>
              O servidor gera os quatro formatos a partir do mesmo perfil: o conteúdo não muda,
              só o invólucro. Cada botão é um link direto para
              {' '}<span className="mono">GET /api/intel/relatorio</span> e o browser guarda o
              ficheiro.
            </p>
            <div className="row">
              {FORMATOS.map((f) => (
                <a
                  key={f.id}
                  className="btn btn-sm btn-quiet"
                  href={api.relatorioUrl(res.investigacao.id, f.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                >
                  <Icon.download width={14} height={14} /> {f.nome}
                </a>
              ))}
            </div>
          </div>

          {/* ------------------------------------------- contas e plataformas */}
          <div className="card">
            <div className="card-head">Contas e plataformas</div>
            {cruz && (
              <>
                <dl className="kv" style={{ marginBottom: 14 }}>
                  <dt>identificador</dt>
                  <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{cruz.identificador ?? '— nenhum dominante'}</dd>
                  <dt>plataformas</dt>
                  <dd>{cruz.totalPlataformas} observada(s) · {cruz.iguais} com o mesmo identificador</dd>
                  <dt>confiança</dt>
                  <dd><SeloConfianca confianca={cruz.confianca} /></dd>
                </dl>
                <Note kind="info">{cruz.nota}</Note>
                <div style={{ height: 14 }} />
              </>
            )}
            {p.contas.length === 0 ? (
              <p className="t-sm dim">Sem contas identificadas nas entidades desta investigação.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Plataforma</th><th>Username</th><th>URL</th><th>Entidade</th></tr>
                  </thead>
                  <tbody>
                    {p.contas.map((c, i) => (
                      <tr key={`${c.plataforma}-${c.entidade}-${i}`}>
                        <td data-l="plataforma">{c.plataforma}</td>
                        <td data-l="username" className="mono t-xs" style={{ overflowWrap: 'anywhere' }}>{c.username ?? '—'}</td>
                        <td data-l="url" className="t-xs" style={{ overflowWrap: 'anywhere', maxWidth: 280 }}>
                          {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue-3)' }}>{c.url}</a> : 'sem URL pública'}
                        </td>
                        <td data-l="entidade" className="mono t-xs dim" style={{ overflowWrap: 'anywhere' }}>{c.entidade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ------------------------------------------------- identificadores */}
          <div className="card">
            <div className="card-head">Identificadores e atributos</div>
            {p.identificadores.length === 0 ? (
              <p className="t-sm dim">Nenhum identificador repetido entre entidades.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Tipo</th><th>Valor</th><th>Entidades</th></tr></thead>
                  <tbody>
                    {p.identificadores.map((i, n) => (
                      <tr key={`${i.tipo}-${i.valor}-${n}`}>
                        <td data-l="tipo" className="t-xs">{i.tipo}</td>
                        <td data-l="valor" className="mono" style={{ overflowWrap: 'anywhere' }}>{i.valor}</td>
                        <td data-l="entidades" className="t-xs dim">{i.entidades.length} · {i.entidades.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {Object.keys(p.atributos).length > 0 && (
              <>
                <div style={{ height: 14 }} />
                <dl className="kv">
                  {Object.entries(p.atributos).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{k}</dt>
                      <dd style={{ overflowWrap: 'anywhere' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>

          {/* ------------------------------------------------------ correlações */}
          <div className="card">
            <div className="card-head">Correlações · {res.correlacoes.length}</div>
            {res.correlacoes.length === 0 ? (
              <p className="t-sm dim">Sem correlações: não há valor observado em mais do que uma entidade.</p>
            ) : (
              <div>
                {res.correlacoes.map((c, i) => (
                  <div className="finding" key={`${c.tipo}-${c.valor}-${i}`}>
                    <div className="finding-key">
                      <div className="k">{c.tipo}</div>
                      <div className="m mono" style={{ overflowWrap: 'anywhere' }}>{c.valor}</div>
                    </div>
                    <div className="finding-val">
                      <div className="row-tight" style={{ marginBottom: 5 }}>
                        <SeloConfianca confianca={c.confianca} />
                        <span className="t-xs dim num">{c.total} ponto(s) · {c.fatores.length} fator(es)</span>
                      </div>
                      <div className="t-xs muted">{c.nota}</div>
                      <div className="src-ref">
                        evidência: {fontes(c.evidencias)} · entidades {c.entidades.join(', ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ------------------------------------------------------ resoluções */}
          <div className="card">
            <div className="card-head">Resoluções · {res.resolucoes.length}</div>
            {res.resolucoes.length === 0 ? (
              <p className="t-sm dim">Sem resoluções: nenhuma correspondência foi sequer pontuada.</p>
            ) : (
              <div>
                {res.resolucoes.map((r, i) => (
                  <div className="finding" key={`${r.a}-${r.b}-${i}`}>
                    <div className="finding-key">
                      <div className="k" style={{ overflowWrap: 'anywhere' }}>{r.a} ↔ {r.b}</div>
                      <div className="m">{r.total} ponto(s) · {r.fatores.length} fator(es)</div>
                    </div>
                    <div className="finding-val">
                      <div className="row-tight" style={{ marginBottom: 5 }}>
                        <SeloConfianca confianca={r.confianca} />
                      </div>
                      <div className="t-xs muted">{r.nota}</div>
                      <div className="src-ref">evidência: {fontes(r.evidencias)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* -------------------------------------------------------- relações */}
          <div className="card">
            <div className="card-head">Relações · {res.relacoes.length}</div>
            {res.relacoes.length === 0 ? (
              <p className="t-sm dim">Sem relações: não há declaração de fonte nem valor partilhado entre entidades.</p>
            ) : (
              <div>
                {res.relacoes.map((r, i) => (
                  <div className="finding" key={`${r.de}-${r.para}-${r.tipo}-${i}`}>
                    <div className="finding-key">
                      <div className="k">{r.tipo}</div>
                      <div className="m">{r.de} → {r.para}</div>
                    </div>
                    <div className="finding-val">
                      <div className="row-tight" style={{ marginBottom: 5 }}>
                        <SeloConfianca confianca={r.confianca} />
                        <span className="t-xs dim">{r.rotulo}</span>
                      </div>
                      <div className="t-xs muted">{r.nota}</div>
                      <div className="src-ref">evidência: {fontes(r.evidencias)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ------------------------------------------------ lacunas + evidências */}
          <div className="card">
            <div className="card-head">Lacunas · {p.lacunas.length}</div>
            {p.lacunas.length === 0 ? (
              <p className="t-sm dim">Nenhuma lacuna declarada pelo motor. Isto não significa que nada falte — só que nada foi assinalado.</p>
            ) : (
              <ul className="pontos">
                {p.lacunas.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            )}
            <div style={{ height: 16 }} />
            <div className="card-head">Evidências · {p.evidencias.length}</div>
            {p.evidencias.length === 0 ? (
              <p className="t-sm dim">Sem evidências registadas.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Provider</th><th>Nota</th><th>Fonte</th><th>Quando</th></tr></thead>
                  <tbody>
                    {p.evidencias.map((e, i) => (
                      <tr key={`${e.provider}-${i}`}>
                        <td data-l="provider" className="t-xs">{e.provider}</td>
                        <td data-l="nota" className="t-xs" style={{ overflowWrap: 'anywhere', maxWidth: 420 }}>{e.nota}</td>
                        <td data-l="fonte" className="t-xs dim mono" style={{ overflowWrap: 'anywhere', maxWidth: 220 }}>
                          {e.url
                            ? <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue-3)' }}>{e.fonte}</a>
                            : e.fonte}
                        </td>
                        <td data-l="quando" className="t-xs dim">{quando(e.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ------------------------------------------------ timeline + atividade */}
          <div className="card">
            <div className="card-head">Linha do tempo e atividade</div>

            <div className="stat-row">
              <div><div className="v num">{res.atividade.total}</div><div className="l">eventos</div></div>
              <div><div className="v num">{res.atividade.comData}</div><div className="l">com data</div></div>
              <div><div className="v num">{res.atividade.semData}</div><div className="l">sem data</div></div>
              <div><div className="v num">{res.atividade.duracaoDias ?? '—'}</div><div className="l">dias de intervalo</div></div>
              <div><div className="v num">{res.atividade.pico ? res.atividade.pico.total : '—'}</div><div className="l">pico num dia</div></div>
            </div>

            <p className="t-xs dim" style={{ margin: '10px 0 14px' }}>{res.timeline.nota} {res.atividade.nota}</p>

            {res.atividade.porPlataforma.length > 0 && (
              <div className="tbl-wrap" style={{ marginBottom: 14 }}>
                <table className="tbl">
                  <thead><tr><th>Plataforma</th><th>Eventos</th></tr></thead>
                  <tbody>
                    {res.atividade.porPlataforma.slice(0, 8).map((pl) => (
                      <tr key={pl.plataforma}>
                        <td data-l="plataforma">{pl.plataforma}</td>
                        <td data-l="eventos" className="num">{pl.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {res.timeline.intervalos.slice(0, 5).map((iv, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <Note kind="warn">{iv.nota}</Note>
              </div>
            ))}

            {res.timeline.eventos.length === 0 ? (
              <p className="t-sm dim">Sem eventos com data observada.</p>
            ) : (
              <div>
                {res.timeline.eventos.slice(0, 40).map((ev, i) => (
                  <div className="list-row" key={`${ev.quando}-${i}`}>
                    <Icon.clock width={16} height={16} style={{ color: 'var(--t-4)' }} />
                    <div className="grow">
                      <div className="t" style={{ overflowWrap: 'anywhere' }}>{ev.descricao}</div>
                      <div className="s">
                        {quando(ev.quando)} · {ev.tipo}{ev.plataforma ? ` · ${ev.plataforma}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
                {res.timeline.eventos.length > 40 && (
                  <p className="t-xs dim" style={{ marginTop: 8 }}>
                    A mostrar 40 de {res.timeline.eventos.length} eventos com data — o relatório
                    completo está nos formatos acima.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
