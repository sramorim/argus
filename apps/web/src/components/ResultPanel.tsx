/**
 * Painel de resultado.
 *
 * A ideia que organiza tudo: **um resultado sem proveniência não é um
 * resultado**. Por isso a matriz de fontes é um separador de primeira classe —
 * é ela que prova que nada foi inventado — e cada achado diz de onde veio.
 *
 *organization:
 *  1. barra de resumo (tempo · achados · fontes OK · fontes com problema)
 *  2. notas da execução (truncamentos, avisos da ferramenta)
 *  3. separadores: Achados · Fontes · Grafo
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ToolRun, Finding, Confidence, Graph } from '../api';
import { CONF_LABEL, CONF_HINT, KIND_LABEL, STATUS_LABEL } from '../api';
import { Icon } from './Icons';
import { Empty, Note, useToast } from './ui';
import GraphView from './GraphView';

// ------------------------------------------------------------------ valores
function ValueView({ v, link }: { v: unknown; link?: string }) {
  if (v == null) return <span className="dim">—</span>;
  if (typeof v === 'boolean') return <span>{v ? 'sim' : 'não'}</span>;
  if (typeof v === 'number') return <span className="mono num">{v}</span>;
  if (typeof v === 'string') {
    const isUrl = /^https?:\/\//i.test(v);
    return (
      <span>
        <span className={link || isUrl ? 'mono' : ''} style={{ overflowWrap: 'anywhere' }}>{v}</span>
        {(link || isUrl) && (
          <> <a className="t-xs" style={{ color: 'var(--red-hi)' }} href={link || v} target="_blank" rel="noreferrer noopener">abrir ↗</a></>
        )}
      </span>
    );
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="dim">vazio</span>;
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      const shown = v.slice(0, 30).map(String);
      return (
        <span className="t-sm" style={{ color: 'var(--t-3)' }}>
          {shown.join(' · ')}{v.length > 30 && <span className="dim"> (+{v.length - 30})</span>}
        </span>
      );
    }
    return <TableView rows={v as unknown[] as Record<string, unknown>[]} />;
  }
  return <KVView o={v as Record<string, unknown>} />;
}

function KVView({ o }: { o: Record<string, unknown> }) {
  const entries = Object.entries(o);
  if (!entries.length) return <span className="dim">vazio</span>;
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v == null ? '—' : Array.isArray(v) ? v.map(String).join(', ') : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function TableView({ rows }: { rows: Record<string, unknown>[] }) {
  const [open, setOpen] = useState(false);
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r ?? {})))).slice(0, 6);
  const shown = open ? rows : rows.slice(0, 8);
  if (!cols.length) return <span className="dim">sem campos</span>;
  return (
    <div>
      <div className="tbl-wrap" style={{ maxHeight: open ? 'none' : 320, overflowY: 'auto' }}>
        <table className="tbl">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const cell = r?.[c];
                  return (
                    <td key={c} data-l={c}>
                      {cell == null ? <span className="dim">—</span>
                        : typeof cell === 'boolean' ? (cell ? 'sim' : 'não')
                          : /^(https?:\/\/)/.test(String(cell))
                            ? <a href={String(cell)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--red-hi)', overflowWrap: 'anywhere' }}>{String(cell).replace(/^https?:\/\//, '').slice(0, 42)}</a>
                            : String(cell).slice(0, 140)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <button className="btn btn-sm btn-quiet" style={{ marginTop: 8 }} onClick={() => setOpen(!open)} type="button">
          {open ? 'mostrar menos' : `mostrar todos (${rows.length})`}
        </button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- achado
function FindingRow({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const isComplex = typeof f.value === 'object' && f.value !== null;
  const c: Confidence = f.evidence.confidence;
  return (
    <div className="finding">
      <div className="finding-key">
        <div className="k" title={CONF_HINT[c]}><span className={`conf-dot c-${c}`} />{f.label}</div>
        <div className="m">
          {CONF_LABEL[c]}
          {f.evidence.kind !== 'fact' && ` · ${KIND_LABEL[f.evidence.kind]}`}
        </div>
      </div>
      <div className="finding-val">
        {isComplex ? (
          <>
            <button className="btn btn-sm btn-quiet" onClick={() => setOpen(!open)} type="button">
              {open ? 'ocultar' : 'ver dados'} {Array.isArray(f.value) ? `(${(f.value as unknown[]).length} itens)` : ''}
            </button>
            {open && <div style={{ marginTop: 9 }}><ValueView v={f.value} /></div>}
          </>
        ) : (
          <ValueView v={f.value} link={f.link} />
        )}
        {f.evidence.sourceIds.length > 0 && (
          <div className="src-ref">fontes: {f.evidence.sourceIds.join(', ')}</div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- painel
export default function ResultPanel({ run }: { run: ToolRun }) {
  const toast = useToast();
  const [tab, setTab] = useState<'achados' | 'fontes' | 'grafo'>('achados');
  const groups = [...new Set(run.findings.map((f) => f.group))];
  const graph = (() => {
    const gf = run.findings.find((f) => f.group === 'grafo-completo');
    if (gf?.value) { try { return JSON.parse(String(gf.value)) as Graph; } catch { return null; } }
    return null;
  })();

  const ok = run.sources.filter((s) => s.status === 'ok').length;
  const problems = run.sources.filter((s) => s.status === 'error' || s.status === 'timeout' || s.status === 'needs_key').length;
  const empty = run.sources.filter((s) => s.status === 'empty').length;
  const cached = run.sources.filter((s) => (s.note ?? '').includes('cache')).length;
  const semFonte = run.sources.filter((s) => s.status === 'skipped').length;

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
      toast('ok', 'Resultado copiado como JSON (com proveniência).');
    } catch {
      toast('err', 'O navegador não deixou copiar. Usa "exportar".');
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `argus-${run.toolId}-${run.at.replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="card" aria-live="polite">
      <div className="card-head">
        Resultado
        <span className="grow" />
        <div className="card-head-actions">
          <button className="icon-btn" onClick={copyJson} title="Copiar JSON" aria-label="Copiar JSON" type="button"><Icon.copy /></button>
          <button className="icon-btn" onClick={download} title="Exportar JSON" aria-label="Exportar JSON" type="button"><Icon.download /></button>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: run.notes.length ? 12 : 14 }}>
        <div><div className="v num">{run.ms}<span style={{ fontSize: 11, color: 'var(--t-4)' }}> ms</span></div><div className="l">tempo</div></div>
        <div><div className="v num">{run.findings.length}</div><div className="l">achados</div></div>
        <div><div className="v num">{ok}</div><div className="l">fontes ok</div></div>
        <div><div className="v num" style={{ color: problems ? 'var(--red-hi)' : undefined }}>{problems}</div><div className="l">com problema</div></div>
        <div><div className="v num">{empty}</div><div className="l">sem dados</div></div>
      </div>

      {run.notes.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {run.notes.map((n, i) => (
            <Note key={i} kind={/truncado|não foi gravado|falhou/i.test(n) ? 'warn' : 'info'}>{n}</Note>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={tab === 'achados'} onClick={() => setTab('achados')}>
          Achados{run.findings.length ? ` (${run.findings.length})` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'fontes'} onClick={() => setTab('fontes')}>
          Fontes{run.sources.length ? ` (${run.sources.length})` : ''}
        </button>
        {graph && <button role="tab" aria-selected={tab === 'grafo'} onClick={() => setTab('grafo')}>Grafo</button>}
      </div>

      {tab === 'achados' && (
        run.findings.length === 0 ? (
          <Empty icon={Icon.alert} title="Nenhum achado">
            As fontes foram consultadas mas nenhuma devolveu dados. Abre a matriz de fontes para ver
            exatamente o que respondeu e o que falhou.
          </Empty>
        ) : (
          <div>
            {groups.map((g) => (
              <div className="res-group" key={g}>
                <h4>{g}<span className="n">({run.findings.filter((f) => f.group === g).length})</span></h4>
                {run.findings.filter((f) => f.group === g).map((f) => <FindingRow key={f.id} f={f} />)}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'fontes' && (
        <SourceMatrix run={run} cached={cached} skipped={semFonte} />
      )}

      {tab === 'grafo' && graph && <GraphView graph={graph} />}
    </section>
  );
}

function SourceMatrix({ run, cached, skipped }: { run: ToolRun; cached: number; skipped: number }) {
  if (!run.sources.length) {
    return (
      <Empty icon={Icon.database} title="Sem fontes externas">
        Esta ferramenta é cálculo local: não consultou nenhuma fonte remota. O que vê nos achados
        foi calculado aqui, a partir do que você forneceu.
      </Empty>
    );
  }
  return (
    <div>
      <Note kind="info">
        Esta é a prova de que nada foi inventado. Cada linha é uma fonte realmente consultada,
        com o estado em que respondeu. Fonte com problema aparece como problema — nunca
        escondida atrás de um resultado parcial.
      </Note>
      <div className="tbl-wrap" style={{ marginTop: 12 }}>
        <table className="tbl">
          <thead>
            <tr><th>Fonte</th><th>Estado</th><th>Dados</th><th>Tempo</th><th>Nota</th></tr>
          </thead>
          <tbody>
            {run.sources.map((s, i) => (
              <tr key={`${s.id}-${i}`}>
                <td data-l="fonte">
                  <div style={{ fontWeight: 600 }}>{s.label}</div>
                  <div className="t-xs mono dim" style={{ overflowWrap: 'anywhere', maxWidth: 300, marginTop: 2 }}>{s.url}</div>
                </td>
                <td data-l="estado"><span className={`st st-${s.status}`}>● {STATUS_LABEL[s.status]}</span></td>
                <td data-l="dados" className="num">{s.count ?? '—'}</td>
                <td data-l="tempo" className="dim num">{s.ms != null ? `${s.ms} ms` : '—'}</td>
                <td data-l="nota" className="t-sm muted">{s.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="t-xs dim" style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>{cached ? `${cached} do cache local (o TTL de cada fonte está na nota)` : 'sem respostas do cache'}</span>
        {skipped > 0 && <span>{skipped} fonte(s) não consultada(s), com o motivo indicado</span>}
      </div>
    </div>
  );
}

export { ValueView };
export type { ReactNode };
