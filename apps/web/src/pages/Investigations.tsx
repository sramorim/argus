/**
 * Investigações: lista, detalhe com grafo, renomear e apagar.
 *
 * Uma investigação guardada tem de ser re-abrível de verdade — com os nós, as
 * ligações e as ferramentas que a produziram. É isso que a separa de um
 * histórico de texto.
 */
import { useEffect, useState } from 'react';
import {
  api, ApiError, PLAN_NAME,
  CLASSE_FASE, CLASSE_FERRAMENTA, ROTULO_FASE, ROTULO_FERRAMENTA, ROTULO_MODO,
  type ExecutarResposta, type FerramentaPlano, type FasePlano, type Investigation,
  type InvestigationDetail, type ModoPlano, type Plano, type PlanoResposta,
  type Progresso, type RegistoFerramenta, type RegistoFase, type ResumoProgresso,
} from '../api';
import { Icon } from '../components/Icons';
import { Empty, Modal, Note, Skeleton, useToast, CardGridSkeleton } from '../components/ui';
import GraphView from '../components/GraphView';
import type { View } from './AppShell';

export default function Investigations({ view, setView }: { view: { id?: string }; setView: (v: View) => void }) {
  const [list, setList] = useState<Investigation[] | null>(null);
  const [det, setDet] = useState<InvestigationDetail | null>(null);
  const [err, setErr] = useState('');
  const toast = useToast();
  const selected = view.id;

  const load = () => api.investigations().then((r) => setList(r.investigations)).catch((e) => setErr((e as ApiError).message));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selected) { setDet(null); return; }
    setDet(null);
    api.investigation(selected).then(setDet).catch((e) => toast('err', (e as ApiError).message));
  }, [selected]);

  const rename = async (id: string, title: string) => {
    try { await api.renameInvestigation(id, title); toast('ok', 'Investigação renomeada.'); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  const remove = async (id: string) => {
    try { await api.delInvestigation(id); toast('ok', 'Investigação apagada.'); setView({ k: 'inv' }); load(); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  if (selected) {
    return (
      <div className="page page-wide">
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => setView({ k: 'inv' })} style={{ marginBottom: 14 }}>
          <Icon.arrowLeft width={14} height={14} /> todas as investigações
        </button>
        {err && <Note kind="err">{err}</Note>}
        {!det ? (
          <div className="card"><Skeleton lines={6} /></div>
        ) : (
          <InvestigationDetailView det={det} onRename={rename} onRemove={remove} />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="card">
        <h1 className="t-h1">Investigações</h1>
        <p className="t-sm muted" style={{ marginTop: 6 }}>
          Cada investigação guarda o grafo completo — nós, ligações, de que fonte veio cada um e
          com que confiança — mais as ferramentas que a produziram. Relê-las não gasta cota.
        </p>
      </header>

      {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}

      {list === null ? <CardGridSkeleton n={4} /> : list.length === 0 ? (
        <div className="card">
          <Empty icon={Icon.network} title="Ainda não há investigações" action={
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'tool', id: 'graph-investigation' })}>
              criar a primeira
            </button>
          }>
            Corre a ferramenta <b style={{ color: 'var(--t-2)' }}>Investigação (Grafo)</b> com um
            domínio, um IP, um username ou um email. O ARGOS escolhe as ferramentas certas,
            executa-as e guarda o grafo com proveniência.
          </Empty>
        </div>
      ) : (
        <div className="tool-grid">
          {list.map((i) => (
            <button key={i.id} className="tool-card" type="button" onClick={() => setView({ k: 'inv', id: i.id })}>
              <div className="tool-top">
                <span className="tool-glyph"><Icon.network /></span>
                <span className="tool-name" style={{ overflowWrap: 'anywhere' }}>{i.title}</span>
              </div>
              <div className="t-xs dim">
                {new Date(i.updated_at).toLocaleString('pt-BR')} · {i.node_count ?? 0} nós · {i.edge_count ?? 0} ligações
              </div>
              {i.tools?.length ? (
                <div className="tool-foot">
                  {i.tools.slice(0, 4).map((t) => (
                    <span className="tag" key={t.toolId}>{t.toolId} · {t.findingCount}</span>
                  ))}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InvestigationDetailView({ det, onRename, onRemove }: {
  det: InvestigationDetail; onRename: (id: string, t: string) => void; onRemove: (id: string) => void;
}) {
  const inv = det.investigation;
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(inv.title);
  const [confirm, setConfirm] = useState(false);

  const graph = {
    nodes: det.nodes,
    edges: det.edges.map((e) => ({ ...e, from: e.from.replace(`${inv.id}:`, ''), to: e.to.replace(`${inv.id}:`, '') })),
    runs: (inv.tools ?? []).map((t) => ({ toolId: t.toolId, ok: t.ok, ms: t.ms, findingCount: t.findingCount })),
    seedType: inv.seed_type,
  };

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            {edit ? (
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { onRename(inv.id, title); setEdit(false); } }} />
            ) : (
              <h1 className="t-h1" style={{ overflowWrap: 'anywhere' }}>{inv.title}</h1>
            )}
            <div className="t-sm dim" style={{ marginTop: 4 }}>
              tipo <b>{inv.seed_type}</b> · criada {new Date(inv.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-quiet" type="button" onClick={() => { if (edit) { onRename(inv.id, title); setEdit(false); } else setEdit(true); }}>
              {edit ? 'guardar' : 'renomear'}
            </button>
            <button className="btn btn-sm btn-danger" type="button" onClick={() => setConfirm(true)}>
              <Icon.trash width={14} height={14} />
            </button>
          </div>
        </div>

        <div className="stat-row" style={{ marginTop: 14 }}>
          <div><div className="v num">{det.nodes.length}</div><div className="l">nós</div></div>
          <div><div className="v num">{det.edges.length}</div><div className="l">ligações</div></div>
          <div><div className="v num">{new Set(det.nodes.map((n) => n.type)).size}</div><div className="l">tipos</div></div>
          <div><div className="v num">{Math.max(0, ...det.nodes.map((n) => n.hop))}</div><div className="l">saltos</div></div>
        </div>
      </div>

      <PlanoInvestigacao invId={inv.id} seedType={inv.seed_type} />

      <div className="card">
        <div className="card-head">Grafo</div>
        <GraphView graph={graph} />
      </div>

      <div className="card">
        <div className="card-head">Ferramentas usadas</div>
        {(inv.tools?.length ?? 0) === 0 ? (
          <p className="t-sm dim">Esta investigação foi guardada sem registo de ferramentas.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Ferramenta</th><th>Achados</th><th>Tempo</th><th>Estado</th></tr></thead>
              <tbody>
                {(inv.tools ?? []).map((t, i) => (
                  <tr key={`${t.toolId}-${i}`}>
                    <td data-l="ferramenta" className="mono">{t.toolId}</td>
                    <td data-l="achados" className="num">{t.findingCount}</td>
                    <td data-l="tempo" className="num dim">{t.ms} ms</td>
                    <td data-l="estado"><span className={`st ${t.ok ? 'st-ok' : 'st-empty'}`}>● {t.ok ? 'com dados' : 'sem dados'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">Nós do grafo</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Tipo</th><th>Valor</th><th>Confiança</th><th>Salto</th><th>Fontes</th></tr></thead>
            <tbody>
              {det.nodes.map((n) => (
                <tr key={n.id}>
                  <td data-l="tipo">{n.type}</td>
                  <td data-l="valor" className="mono" style={{ overflowWrap: 'anywhere' }}>{n.value}</td>
                  <td data-l="confiança">{n.confidence}</td>
                  <td data-l="salto" className="num dim">{n.hop}</td>
                  <td data-l="fontes" className="t-xs dim">{n.sourceIds.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={confirm} onClose={() => setConfirm(false)}
        title="Apagar esta investigação?"
        actions={<button className="btn btn-danger" type="button" onClick={() => onRemove(inv.id)}>apagar definitivamente</button>}
      >
        <p className="t-sm muted">
          Some o grafo guardado ({det.nodes.length} nós, {det.edges.length} ligações). Não há como
          recuperar. O histórico de execuções é mantido.
        </p>
      </Modal>
    </>
  );
}

/* ------------------------------------------------- plano e execução (FASE F) */

/** Ferramentas de um plano, na ordem em que aparecem nas fases. */
const ferramentasDo = (p: Plano): FerramentaPlano[] => p.fases.flatMap((f) => f.ferramentas);

/** Uma linha do plano: o que ia correr, o input exacto e porque é que não correu. */
function LinhaFerramenta({ plan, reg }: { plan: FerramentaPlano; reg?: RegistoFerramenta }) {
  const bloqueada = plan.estado === 'BLOQUEADA' && !reg;
  const rotulo = reg ? ROTULO_FERRAMENTA[reg.estado] : bloqueada ? 'não executada' : 'pendente';
  const classe = reg ? CLASSE_FERRAMENTA[reg.estado] : bloqueada ? 'st st-skipped' : 'st st-empty';
  const entrada = plan.input ? Object.entries(plan.input) : [];

  return (
    <div className="ferr">
      <span className="mono ferr-id">{plan.id}</span>
      <span className={`tag ${plan.kind === 'etapa' ? 'tag-free' : 'tag-legal'}`}>{plan.kind}</span>
      <span className={classe}>● {rotulo}</span>
      {reg?.contagem !== undefined && (
        <span className="t-xs num dim">{reg.contagem} {plan.kind === 'etapa' ? 'itens' : 'achados'}</span>
      )}
      {reg && reg.ms > 0 && <span className="t-xs num dim">{reg.ms} ms</span>}
      {plan.motivo && <span className="ferr-motivo">{plan.motivo}</span>}
      {reg?.erro && <span className="ferr-erro">{reg.erro}</span>}
      {reg?.nota && <span className="ferr-nota">{reg.nota}</span>}
      {plan.nota && !reg?.nota && <span className="ferr-nota">{plan.nota}</span>}
      {entrada.length > 0 && (
        <span className="t-xs mono dim ferr-input">
          {entrada.map(([k, v]) => `${k}=${v}`).join(' · ')}
        </span>
      )}
    </div>
  );
}

/**
 * Uma das 8 fases. O cabeçalho mostra sempre o estado e o motivo — abrir a
 * fase mostra as ferramentas, o input e o que saiu de cada uma. Uma fase
 * pulada no modo escolhido não abre: não há o que mostrar além do motivo.
 */
function LinhaFase({ fase, reg, aberta, onToggle }: {
  fase: FasePlano; reg?: RegistoFase; aberta: boolean; onToggle: () => void;
}) {
  const estado = reg ? reg.estado : fase.estado;
  const motivo = fase.motivo ?? reg?.motivo;

  if (fase.pulada) {
    return (
      <li className="fase" data-estado="PENDENTE">
        <div className="fase-head">
          <span className="fase-nome">{fase.fase}</span>
          <span className="tag tag-free">pulada</span>
          <span className="fase-motivo">{motivo ?? 'fora do modo escolhido'}</span>
        </div>
      </li>
    );
  }

  return (
    <li className="fase" data-estado={estado}>
      <button className="fase-head" type="button" aria-expanded={aberta} onClick={onToggle}>
        <span className="fase-nome">{fase.fase}</span>
        <span className={`tag ${CLASSE_FASE[estado]}`}>{ROTULO_FASE[estado]}</span>
        {motivo && <span className="fase-motivo">{motivo}</span>}
        <span className="fase-seta"><Icon.chevronDown width={14} height={14} /></span>
      </button>
      {aberta && (
        <div className="fase-corpo">
          {fase.ferramentas.length === 0 ? (
            <p className="t-xs dim">Sem ferramentas nesta fase.</p>
          ) : fase.ferramentas.map((f) => (
            <LinhaFerramenta key={f.id} plan={f} reg={reg?.ferramentas.find((r) => r.id === f.id)} />
          ))}
          <p className="t-xs dim">{fase.descricao}</p>
        </div>
      )}
    </li>
  );
}

/**
 * Plano de investigação e execução.
 *
 * O painel mostra o que o planeador decidiu e o que a execução fez — e nada
 * mais. Estados vêm do servidor: `CONCLUIDA` só quando tudo correu, `ERRO` só
 * quando algo falhou, e o que não correu fica visível com o motivo concreto
 * (plano insuficiente, CLI em falta, custo do Apify por confirmar). O
 * plano personalizado constrói-se a partir do que o servidor disse que se
 * aplica ao alvo — nunca a partir de uma lista escrita à mão no cliente.
 */
function PlanoInvestigacao({ invId, seedType }: { invId: string; seedType: string }) {
  const toast = useToast();
  const [plano, setPlano] = useState<Plano | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [resumo, setResumo] = useState<ResumoProgresso | null>(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [custo, setCusto] = useState(false);
  const [candidatos, setCandidatos] = useState<FerramentaPlano[] | null>(null);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [confirmarTroca, setConfirmarTroca] = useState(false);

  const aplicar = (r: PlanoResposta) => {
    setPlano(r.plano ?? null);
    setProgresso(r.progresso ?? null);
    setResumo(r.resumo ?? null);
    setErro('');
    if (r.plano) setAberta((a) => a ?? r.plano!.fases.find((f) => !f.pulada)?.fase ?? null);
  };

  useEffect(() => {
    setPlano(null); setProgresso(null); setResumo(null); setCandidatos(null);
    setEscolhidas([]); setAberta(null); setErro(''); setCusto(false); setBusy(false);
    api.plano(invId).then(aplicar).catch((e) => setErro((e as ApiError).message));
  }, [invId]);

  const gerar = async (modo: ModoPlano, ferramentas?: string[]): Promise<Plano | null> => {
    setBusy(true);
    try {
      const r = await api.gerarPlano(invId, { modo, ferramentas });
      aplicar(r);
      toast('ok', `Plano ${modo} gerado: ${r.plano?.resumo.ferramentas ?? 0} ferramentas em ${r.plano?.resumo.fases ?? 0} fases.`);
      return r.plano;
    } catch (e) {
      const m = (e as ApiError).message;
      setErro(m);
      toast('err', m);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Para personalizar é preciso saber o que o servidor considera aplicável.
   * Um FULL já carregado dá isso de borla; um plano sem execução pode ser
   * substituído sem perder nada. Só com execução feita é que se avisa primeiro.
   */
  const montarPersonalizado = async () => {
    if (plano?.modo === 'FULL') { setCandidatos(ferramentasDo(plano)); return; }
    if (plano && (resumo?.executadas ?? 0) > 0) { setConfirmarTroca(true); return; }
    const p = await gerar('FULL');
    if (p) { setCandidatos(ferramentasDo(p)); setEscolhidas([]); }
  };

  const executar = async (reexecutar: boolean) => {
    setBusy(true);
    try {
      const r: ExecutarResposta = await api.executarPlano(invId, { confirmarCusto: custo, reexecutar });
      setPlano(r.plano);
      setProgresso(r.progresso);
      setResumo(r.resumo);
      setErro('');
      if (r.erro) {
        toast('warn', `A execução parou a meio: ${r.erro}`);
      } else {
        toast('ok', `${r.resumo.concluidas} de ${r.resumo.fases} fases concluídas · ${r.resumo.executadas} de ${r.resumo.ferramentas} ferramentas executadas.`);
      }
    } catch (e) {
      const m = (e as ApiError).message;
      setErro(m);
      toast('err', m);
    } finally {
      setBusy(false);
    }
  };

  const precisaCusto = !!plano && ferramentasDo(plano).some((f) => f.id === 'apify' && f.estado === 'PRONTO');
  const feitas = (resumo?.executadas ?? 0) > 0;
  const pct = resumo ? Math.round((resumo.concluidas / Math.max(1, resumo.fases)) * 100) : 0;

  return (
    <div className="card">
      <div className="card-head">
        Plano de investigação
        {plano && <span className="tag">{ROTULO_MODO[plano.modo]}</span>}
        <span className="grow" />
        <div className="card-head-actions">
          <button className="btn btn-quiet btn-sm" type="button" disabled={busy || !!candidatos} onClick={() => { setCandidatos(null); gerar('QUICK'); }}>QUICK</button>
          <button className="btn btn-quiet btn-sm" type="button" disabled={busy || !!candidatos} onClick={() => { setCandidatos(null); gerar('FULL'); }}>FULL</button>
          <button className="btn btn-quiet btn-sm" type="button" disabled={busy} onClick={montarPersonalizado}>personalizar</button>
        </div>
      </div>

      {erro && <div style={{ marginBottom: 12 }}><Note kind="err">{erro}</Note></div>}
      {busy && <div className="progress" style={{ marginBottom: 12 }}><i /></div>}

      {candidatos ? (
        <div className="plano-custom">
          <p className="t-sm muted">
            Escolha o que quer correr. As que não se aplicam a <b>{seedType}</b> estão assinaladas e
            ficam no plano como <b>bloqueadas</b>, com o motivo — não desaparecem.
          </p>
          <div className="chip-row" style={{ marginTop: 10 }}>
            {candidatos.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.estado === 'BLOQUEADA' ? 'chip chip-block' : 'chip'}
                aria-pressed={escolhidas.includes(c.id)}
                title={c.motivo ?? `${c.rotulo} · aplica-se a ${seedType}`}
                onClick={() => setEscolhidas((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}
              >
                {c.rotulo}
              </button>
            ))}
          </div>
          <div className="plano-acoes" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary btn-sm" type="button" disabled={busy || escolhidas.length === 0}
              onClick={() => { setCandidatos(null); gerar('CUSTOM', escolhidas); }}
            >
              gerar plano personalizado ({escolhidas.length})
            </button>
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setCandidatos(null)}>cancelar</button>
          </div>
        </div>
      ) : !plano ? (
        <div className="plano-vazio">
          <p className="t-sm muted">
            Ainda não há plano para esta investigação. O planeador escolhe as 8 fases e as ferramentas
            que se aplicam a <b>{seedType}</b> — e diz, com motivo, o que fica por correr.
          </p>
          <div className="plano-acoes" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => gerar('QUICK')}>plano QUICK</button>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => gerar('FULL')}>plano completo</button>
            <button className="btn btn-quiet btn-sm" type="button" disabled={busy} onClick={montarPersonalizado}>personalizar</button>
          </div>
        </div>
      ) : (
        <>
          <div className="t-sm plano-resumo">
            <span className="dim">
              {plano.resumo.fases} fases · {plano.resumo.ferramentas} ferramentas
              {plano.resumo.bloqueadas ? ` · ${plano.resumo.bloqueadas} bloqueadas` : ''}
              {plano.resumo.puladas ? ` · ${plano.resumo.puladas} puladas` : ''}
              {plano.resumo.fora ? ` · ${plano.resumo.fora} de fora do plano (não se aplicam a ${seedType})` : ''}
            </span>
          </div>

          {resumo && (
            <div className="plano-progresso">
              <div className="meter"><i style={{ width: `${pct}%` }} /></div>
              <div className="t-xs dim">
                {resumo.concluidas} de {resumo.fases} fases concluídas · {resumo.executadas} de {resumo.ferramentas} ferramentas executadas
                {resumo.bloqueadas ? ` · ${resumo.bloqueadas} bloqueadas` : ''}
                {resumo.erros ? ` · ${resumo.erros} com erro` : ''}
                {resumo.pendentes ? ` · ${resumo.pendentes} por correr` : ''}
              </div>
            </div>
          )}

          <ol className="fases">
            {plano.fases.map((f) => (
              <LinhaFase
                key={f.fase}
                fase={f}
                reg={progresso?.fases.find((r) => r.fase === f.fase)}
                aberta={aberta === f.fase}
                onToggle={() => setAberta((a) => (a === f.fase ? null : f.fase))}
              />
            ))}
          </ol>

          <div className="plano-acoes">
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => executar(false)}>
              {feitas ? 'continuar execução' : 'executar plano'}
            </button>
            {progresso && (
              <button className="btn btn-sm" type="button" disabled={busy} onClick={() => executar(true)}>
                reexecutar tudo
              </button>
            )}
            {precisaCusto && (
              <label className="plano-custo">
                <input type="checkbox" checked={custo} onChange={(e) => setCusto(e.target.checked)} />
                confirmo o custo do Apify (pay-per-event)
              </label>
            )}
          </div>
          <p className="t-xs dim plano-nota">
            O plano mostra o que está por correr <b>antes</b> de correr. Fases das etapas do Intel
            (Normalization, Correlation, Intelligence, Snapshots) calculam-se sobre os nós que já
            existem — sem nós, ficam bloqueadas em vez de inventarem resultado.
          </p>
        </>
      )}

      <Modal
        open={confirmarTroca}
        onClose={() => setConfirmarTroca(false)}
        title="Trocar o plano actual?"
        actions={
          <button
            className="btn btn-danger" type="button"
            onClick={async () => { setConfirmarTroca(false); const p = await gerar('FULL'); if (p) { setCandidatos(ferramentasDo(p)); setEscolhidas([]); } }}
          >
            gerar plano completo e escolher
          </button>
        }
      >
        <p className="t-sm muted">
          Para montar o plano personalizado o servidor tem de avaliar o que se aplica a{' '}
          <b>{seedType}</b>. Isso substitui o plano actual — o que já foi executado deixa de contar
          e a execução recomeça do zero.
        </p>
      </Modal>
    </div>
  );
}
