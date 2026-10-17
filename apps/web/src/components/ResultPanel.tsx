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
      // Trava de segurança: um texto gigante (ex.: um blob de dados que escapou)
      // nunca deve inundar a tela. Acima de 2000 caracteres mostra-se o início
      // e manda-se o resto para Exportar/Copiar — sem "monte de código" cru.
      const LIMITE = 2000;
      const longo = v.length > LIMITE;
      const texto = longo ? `${v.slice(0, LIMITE)}…` : v;
      return (
        <span>
          <span className={link || isUrl ? 'mono' : ''} style={{ overflowWrap: 'anywhere' }}>{texto}</span>
          {longo && <span className="dim t-xs"> (texto longo cortado — use Exportar/Copiar para o conteúdo completo)</span>}
          {(link || isUrl) && !longo && (
            <> <a className="t-xs" style={{ color: 'var(--blue-3)' }} href={link || v} target="_blank" rel="noreferrer noopener">abrir ↗</a></>
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
                                ? <a href={String(cell)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--blue-3)', overflowWrap: 'anywhere' }}>{String(cell).replace(/^https?:\/\//, '').slice(0, 42)}</a>
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


// ------------------------------------------------------- perfis encontrados
/**
 * Os perfis que existem, em grelha: um azulejo por rede, com o nome e o link.
 * É o que a pessoa quer ver primeiro numa busca por username; a lista
 * completa (com os não encontrados e os bloqueados) continua nos achados.
 * Sem logótipos de terceiros: a inicial da rede num azulejo da marca.
 */
function PerfisEncontrados({ findings }: { findings: Finding[] }) {
  const perfis = findings
    .filter((f) => f.group === 'encontrado')
    .map((f) => {
      const v = (f.value ?? {}) as { platform?: string; url?: string; username?: string };
      return { id: f.id, nome: v.platform ?? f.label, url: v.url ?? f.link ?? '', user: v.username ?? '' };
    })
    .filter((p) => /^https?:\/\//.test(p.url));
  // Redes que bloqueiam servidores: link direto para conferir à mão.
  const conferir = findings
    .filter((f) => f.group === 'conferir')
    .map((f) => ({ id: f.id, nome: f.label, url: (f.link ?? (typeof f.value === 'string' ? f.value : '')) }))
    .filter((p) => /^https?:\/\//.test(p.url));
  if (!perfis.length && !conferir.length) return null;
  const user = perfis[0]?.user ?? '';
  return (
    <section className="perfis" aria-labelledby="perfis-titulo">
      <div className="perfis-head">
        <span className="perfis-avatar" aria-hidden="true"><Icon.user /></span>
        <div>
          {user && <div className="perfis-user">@{user}</div>}
          <h3 id="perfis-titulo" className="perfis-titulo">{perfis.length ? <>Perfis encontrados <span>({perfis.length})</span></> : 'Perfis'}</h3>
        </div>
      </div>
      {perfis.length > 0 && (
        <ul className="perfis-grade">
          {perfis.map((p) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.url}>
                <span className="perfis-ini" aria-hidden="true">{p.nome.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'}</span>
                <span className="perfis-nome">{p.nome}</span>
                <Icon.link className="perfis-link" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {conferir.length > 0 && (
        <div className="perfis-conferir">
          <div className="perfis-conferir-t">Conferir à mão <span>(bloqueiam verificação de servidor)</span></div>
          <ul className="perfis-chips">
            {conferir.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noopener noreferrer">{p.nome}<Icon.link width={12} height={12} /></a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- painel
export default function ResultPanel({ run }: { run: ToolRun }) {
  const toast = useToast();
  const [tab, setTab] = useState<'achados' | 'fontes' | 'grafo'>('achados');
  // 'grafo-completo' guarda o JSON que desenha o Grafo e 'grafo' o seu resumo:
  // os dois alimentam a aba Grafo e a barra de números — não são achados para
  // listar. Ficam fora da lista para não despejar código cru na tela.
  const OCULTOS = new Set(['grafo-completo', 'grafo']);
  const visiveis = run.findings.filter((f) => !OCULTOS.has(f.group));
  const groups = [...new Set(visiveis.map((f) => f.group))];
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
    a.download = `argos-${run.toolId}-${run.at.replace(/[:.]/g, '-')}.json`;
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

      <PerfisEncontrados findings={run.findings} />

      <div className="stat-row" style={{ marginBottom: run.notes.length ? 12 : 14 }}>
        <div><div className="v num">{run.ms}<span style={{ fontSize: 11, color: 'var(--t-4)' }}> ms</span></div><div className="l">tempo</div></div>
        <div><div className="v num">{visiveis.length}</div><div className="l">achados</div></div>
        <div><div className="v num">{ok}</div><div className="l">fontes ok</div></div>
        <div><div className="v num" style={{ color: problems ? 'var(--blue-3)' : undefined }}>{problems}</div><div className="l">com problema</div></div>
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
          Achados{visiveis.length ? ` (${visiveis.length})` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'fontes'} onClick={() => setTab('fontes')}>
          Fontes{run.sources.length ? ` (${run.sources.length})` : ''}
        </button>
        {graph && <button role="tab" aria-selected={tab === 'grafo'} onClick={() => setTab('grafo')}>Grafo</button>}
      </div>

      {tab === 'achados' && (
        visiveis.length === 0 ? (
          <Empty icon={Icon.alert} title="Nenhum achado">
            As fontes foram consultadas mas nenhuma devolveu dados. Abre a matriz de fontes para ver
            exatamente o que respondeu e o que falhou.
          </Empty>
        ) : (
          <div>
            {groups.map((g) => (
              <div className="res-group" key={g}>
                <h4>{g}<span className="n">({visiveis.filter((f) => f.group === g).length})</span></h4>
                {visiveis.filter((f) => f.group === g).map((f) => <FindingRow key={f.id} f={f} />)}
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
      <Empty icon={Icon.database} title="Cálculo local" />

    );
  }
  return (
    <div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Fonte</th><th>Estado</th><th>Dados</th><th>Tempo</th><th>Nota</th></tr>
          </thead>
          <tbody>
            {run.sources.map((s, i) => (
              <tr key={`${s.id}-${i}`}>
                <td data-l="fonte">
                  <div style={{ fontWeight: 600 }}>{s.label}</div>
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
    </div>
  );
}

export { ValueView };
export type { ReactNode };
