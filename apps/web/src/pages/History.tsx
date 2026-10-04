/**
 * Histórico de execuções.
 *
 * Cada corrida fica guardada com o resultado completo — incluindo a matriz de
 * fontes. Reler uma investigação de ontem tem de ser possível sem gastar cota
 * nem voltar a pedir nada a ninguém.
 *
 * A apresentação é uma linha vertical de eventos, não uma tabela: o que se
 * procura aqui é "quando foi que corri isto", e uma tabela obriga a ler a
 * coluna para obter a resposta. O filtro é pela ferramenta — que é a única
 * dimensão que os dados têm.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type ToolRun, ApiError } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Modal, Note, Skeleton, useToast } from '../components/ui';
import ResultPanel from '../components/ResultPanel';
import type { View } from './AppShell';

interface Row { id: string; tool_id: string; input: string; created_at: string; bytes: number }

/** Data e hora em pt-BR, com a granularidade que a lista usa. */
const quando = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return mesmoDia
    ? `hoje · ${hora}`
    : `${d.toLocaleDateString('pt-BR')} · ${hora}`;
};

export default function History({ setView }: { setView: (v: View) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<{ run: ToolRun; at: string } | null>(null);
  const [err, setErr] = useState('');
  const [filtro, setFiltro] = useState('');
  const toast = useToast();

  useEffect(() => { api.history().then((r) => setRows(r.runs)).catch((e) => setErr((e as ApiError).message)); }, []);

  const show = async (id: string) => {
    try { const r = await api.historyItem(id); setOpen({ run: r.run, at: r.at }); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  /* O filtro é a lista de ferramentas que existem no histórico — nada mais. */
  const ferramentas = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.tool_id))].sort(),
    [rows],
  );
  const visiveis = useMemo(
    () => (rows ?? []).filter((r) => !filtro || r.tool_id === filtro),
    [rows, filtro],
  );

  return (
    <div className="page page-wide">
      <header className="card">
        <div className="regra"><span className="micro">Histórico</span></div>
        <h1 className="t-h1">As tuas execuções</h1>
        <p className="t-sm muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
          {rows?.length ?? 0} execuções guardadas, com o resultado e a proveniência intactos.
          Reler não gasta cota.
        </p>
      </header>

      {err && <Note kind="err">{err}</Note>}

      {rows === null ? (
        <div className="card"><Skeleton lines={5} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty icon={Icon.history} title="Ainda não há execuções"
            action={<button className="btn btn-primary" type="button" onClick={() => setView({ k: 'nova' })}>começar uma investigação</button>}>
            Quando correres uma ferramenta, o resultado completo fica aqui — com as fontes que o
            sustentam, mesmo dias depois.
          </Empty>
        </div>
      ) : ferramentas.length > 1 && (
        <div className="chip-row">
          <button className="chip" type="button" aria-pressed={!filtro} onClick={() => setFiltro('')}>
            todas
          </button>
          {ferramentas.map((f) => (
            <button key={f} className="chip" type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
              {f}
            </button>
          ))}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <section className="card">
          <div className="regra">
            <span className="micro">{visiveis.length} de {rows.length}</span>
          </div>
          <div className="timeline">
            {visiveis.map((r, i) => (
              <div className="tl-item" key={r.id}>
                <div className="tl-marca" aria-hidden>
                  <span className="tl-ponto" />
                  {i < visiveis.length - 1 && <span className="tl-linha" />}
                </div>
                <div className="tl-corpo">
                  <div className="tl-quando">{quando(r.created_at)}</div>
                  <button
                    className="tl-ferramenta"
                    type="button"
                    onClick={() => show(r.id)}
                    style={{ textAlign: 'left', color: 'var(--blue-3)' }}
                  >
                    {r.tool_id}
                  </button>
                  <div className="tl-entrada">{r.input.slice(0, 140) || '—'}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="tag">{(r.bytes / 1024).toFixed(1)} KB</span>
                    <button className="btn btn-sm btn-quiet" type="button" onClick={() => show(r.id)}>
                      reabrir
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Resultado — ${open.run.toolId}` : ''}>
        {open && <ResultPanel run={open.run} />}
      </Modal>
    </div>
  );
}
