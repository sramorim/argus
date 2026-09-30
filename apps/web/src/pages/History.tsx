/**
 * Histórico de execuções.
 *
 * Cada corrida fica guardada com o resultado completo — incluindo a matriz de
 * fontes. Reler uma investigação de ontem tem de ser possível sem gastar cota
 * nem voltar a pedir nada a ninguém.
 */
import { useEffect, useState } from 'react';
import { api, type ToolRun, ApiError } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Modal, Note, Skeleton, useToast } from '../components/ui';
import ResultPanel from '../components/ResultPanel';
import type { View } from './AppShell';

interface Row { id: string; tool_id: string; input: string; created_at: string; bytes: number }

export default function History({ setView }: { setView: (v: View) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<{ run: ToolRun; at: string } | null>(null);
  const [err, setErr] = useState('');
  const toast = useToast();

  useEffect(() => { api.history().then((r) => setRows(r.runs)).catch((e) => setErr((e as ApiError).message)); }, []);

  const show = async (id: string) => {
    try { const r = await api.historyItem(id); setOpen({ run: r.run, at: r.at }); }
    catch (e) { toast('err', (e as ApiError).message); }
  };

  const tools = new Set((rows ?? []).map((r) => r.tool_id));

  return (
    <div className="page page-wide">
      <header className="card">
        <h1 className="t-h1">Histórico</h1>
        <p className="t-sm muted" style={{ marginTop: 6 }}>
          As suas últimas {rows?.length ?? 0} execuções, com o resultado e a proveniência intactos.
          Reler não gasta cota.
        </p>
      </header>

      {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}

      {rows === null ? <div className="card"><Skeleton lines={5} /></div> : rows.length === 0 ? (
        <div className="card">
          <Empty icon={Icon.history} title="Ainda não há execuções"
            action={<button className="btn btn-primary btn-sm" type="button" onClick={() => setView({ k: 'catalog' })}>ver ferramentas</button>}>
            Quando correres uma ferramenta, o resultado completo fica aqui — com as fontes que o
            sustentam, mesmo dias depois.
          </Empty>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">{tools.size} ferramenta(s) distinta(s) no histórico</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Quando</th><th>Ferramenta</th><th>Entrada</th><th>Tamanho</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td data-l="quando" className="t-xs dim" style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                      <td data-l="ferramenta" className="mono">{r.tool_id}</td>
                      <td data-l="entrada" className="mono t-xs" style={{ overflowWrap: 'anywhere', maxWidth: 260 }}>{r.input.slice(0, 120)}</td>
                      <td data-l="tamanho" className="num t-xs dim">{(r.bytes / 1024).toFixed(1)} KB</td>
                      <td data-l="">
                        <button className="btn btn-sm btn-quiet" type="button" onClick={() => show(r.id)}>reabrir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Resultado — ${open.run.toolId}` : ''}>
            {open && <ResultPanel run={open.run} />}
          </Modal>
        </>
      )}
    </div>
  );
}
