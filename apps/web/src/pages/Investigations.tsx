/**
 * Investigações: lista, detalhe com grafo, renomear e apagar.
 *
 * Uma investigação guardada tem de ser re-abrível de verdade — com os nós, as
 * ligações e as ferramentas que a produziram. É isso que a separa de um
 * histórico de texto.
 */
import { useEffect, useState } from 'react';
import { api, type Investigation, type InvestigationDetail, ApiError, PLAN_NAME } from '../api';
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
            domínio, um IP, um username ou um email. O ARGUS escolhe as ferramentas certas,
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
