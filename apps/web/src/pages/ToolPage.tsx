/**
 * Página de ferramenta: formulário à esquerda (fixo em desktop), resultado à
 * direita. No telemóvel o formulário vem primeiro, com a acção principal fixa
 * no fundo — o botão "Investigar" tem de estar sempre ao alcance do polegar.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type ToolPublic, type ToolRun, type Usage, ApiError } from '../api';
import { Icon, CATEGORY_ICON } from '../components/Icons';
import { Empty, Field, Note, PlanTag, Skeleton, useToast, Modal } from '../components/ui';
import ResultPanel from '../components/ResultPanel';

const INPUT_MODE: Record<string, string> = {
  email: 'email', url: 'url', wallet: 'text', hash: 'text', cve: 'text', package: 'text', text: 'text', file: 'text',
};
const AUTOCOMPLETE: Record<string, string> = { email: 'email', url: 'url', text: 'off' };

export default function ToolPage({ id, tools, onUsage }: {
  id: string; tools: ToolPublic[]; onUsage: () => void;
}) {
  const t = tools.find((x) => x.id === id);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, { data: string; name: string; bytes: number }>>({});
  const [run, setRun] = useState<ToolRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const toast = useToast();
  const resRef = useRef<HTMLDivElement>(null);
  const busyFor = useRef<string | null>(null);

  useEffect(() => { setVals({}); setFiles({}); setRun(null); setErr(''); }, [id]);
  useEffect(() => { if (busy) resRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [busy]);

  if (!t) {
    return (
      <div className="page">
        <Empty icon={Icon.alert} title="Ferramenta não encontrada" action={
          <button className="btn btn-quiet btn-sm" type="button" onClick={() => history.back()}>voltar</button>
        }>
          O identificador “{id}” não corresponde a nenhuma ferramenta do catálogo.
        </Empty>
      </div>
    );
  }

  const locked = t.lock === 'locked';
  const Ico = CATEGORY_ICON[t.category] ?? Icon.grid;
  const restantes = usage ? Math.max(0, usage.daily - usage.today) : null;
  const semEspaco = restantes !== null && restantes === 0;

  const readFile = (field: string, file: File) => {
    if (file.size > 12 * 1024 * 1024) { toast('err', 'Ficheiro acima de 12 MB.'); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('err', 'Não foi possível ler o ficheiro.');
    fr.onload = () => {
      const data = String(fr.result ?? '');
      setFiles((f) => ({ ...f, [field]: { data, name: file.name, bytes: file.size } }));
      setVals((v) => ({ ...v, [field]: data }));
    };
    fr.readAsDataURL(file);
  };

  const go = async () => {
    if (busyFor.current) return;
    setErr(''); setBusy(true); busyFor.current = t.id;
    try {
      const r = await api.run(t.id, vals);
      setRun(r.run);
      setUsage(r.usage);
      onUsage();
    } catch (e) {
      const a = e as ApiError;
      let msg = a.message;
      if (a.code === 'bloqueada') msg = `Esta ferramenta exige o plano ${a.minPlan === 'pro_max' ? 'Pro Max' : 'Pro'}.`;
      else if (a.code === 'limite') msg = a.message;
      else if (a.code === 'campo_obrigatorio') msg = `Falta preencher “${t.fields.find((f) => f.name === a.field)?.label ?? a.field}”.`;
      else if (a.code === 'demasiadas_execucoes' || a.code === 'demasiados_pedidos') msg = `${a.message}`;
      else if (a.code === 'sem_rede') msg = 'Sem ligação ao servidor.';
      setErr(msg);
    } finally { setBusy(false); busyFor.current = null; }
  };

  const faltam = t.fields.filter((f) => f.required && !(vals[f.name] ?? '').trim() && f.type !== 'file');

  return (
    <div className="page page-wide">
      <div className="tool-layout">
        <div className="tool-form-col">
          <header className="card">
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <span className="tool-glyph" style={{ width: 36, height: 36, flex: '0 0 36px' }}><Ico width={18} height={18} /></span>
              <div style={{ minWidth: 0 }}>
                <h1 className="t-h2">{t.name}</h1>
                <p className="t-sm muted" style={{ marginTop: 4 }}>{t.summary}</p>
              </div>
            </div>
            <details style={{ marginTop: 12 }}>
              <summary className="t-sm" style={{ color: 'var(--t-4)', cursor: 'pointer', listStyle: 'none' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon.chevronRight width={13} height={13} style={{ transform: 'rotate(90deg)' }} /> como funciona
                </span>
              </summary>
              <p className="t-sm muted" style={{ marginTop: 8, lineHeight: 1.6 }}>{t.longDesc}</p>
            </details>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {locked ? <PlanTag minPlan={t.minPlan} /> : <span className="tag tag-free">GRÁTIS NO TEU PLANO</span>}
              {t.legalGate === 'lgpd' && <span className="tag tag-legal">LGPD · uso defensivo</span>}
              {t.legalGate === 'restricted' && <span className="tag">uso restrito</span>}
            </div>
          </header>

          {locked ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="empty-ico" style={{ margin: '0 auto 12px' }}><Icon.lock /></div>
              <h2 className="t-h3">Trancada no teu plano</h2>
              <p className="t-sm muted" style={{ margin: '8px 0 16px' }}>
                Precisa do plano {t.minPlan === 'pro_max' ? 'Pro Max' : 'Pro'}. O plano Free nunca expira
                e não pede cartão — o desbloqueio é só se quiseres mais volume.
              </p>
              <button className="btn btn-primary btn-block" type="button" onClick={() => { location.href = '#planos'; }}>
                ver planos
              </button>
            </div>
          ) : (
            <div className="card">
              <div className="card-head">Alvo</div>
              {err && <div style={{ marginBottom: 12 }}><Note kind="err">{err}</Note></div>}

              {t.fields.map((f) => (
                <Field key={f.name} label={f.label} hint={f.hint} required={f.required}>
                  {f.type === 'file' ? (
                    <>
                      <label className="drop" data-over={over === f.name}>
                        <span className="drop-ico"><Icon.upload /></span>
                        <span className="drop-txt">
                          <b>{files[f.name]?.name ?? 'Escolher ficheiro'}</b>
                          <span>
                            {files[f.name]
                              ? `${(files[f.name]!.bytes / 1024).toFixed(0)} KB · pronto`
                              : 'do dispositivo · não fica guardado no servidor'}
                          </span>
                        </span>
                        <input
                          type="file" accept="image/*,application/pdf"
                          onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) readFile(f.name, f0); }}
                          onDragOver={(e) => { e.preventDefault(); setOver(f.name); }}
                          onDragLeave={() => setOver(null)}
                          onDrop={(e) => { e.preventDefault(); setOver(null); const f0 = e.dataTransfer.files?.[0]; if (f0) readFile(f.name, f0); }}
                        />
                      </label>
                      {files[f.name] && (
                        <button className="btn btn-sm btn-quiet" style={{ marginTop: 6 }} type="button"
                          onClick={() => { setFiles((s) => { const c = { ...s }; delete c[f.name]; return c; }); setVals((v) => ({ ...v, [f.name]: '' })); }}>
                          remover ficheiro
                        </button>
                      )}
                    </>
                  ) : (
                    <input
                      className="input"
                      value={vals[f.name] ?? ''}
                      inputMode={INPUT_MODE[f.type] as 'text'}
                      autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      autoComplete={AUTOCOMPLETE[f.type] ?? 'off'}
                      enterKeyHint="go"
                      placeholder={f.placeholder ?? ''}
                      onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !busy && !semEspaco) { e.preventDefault(); go(); } }}
                    />
                  )}
                </Field>
              ))}

              <button
                className="btn btn-primary btn-lg btn-block" type="button"
                onClick={go} disabled={busy || semEspaco}
              >
                {busy ? <><span className="spin" /> a consultar fontes…</> : <><Icon.target /> investigar</>}
              </button>
              {semEspaco && <Note kind="warn">A cota de hoje acabou. Volta amanhã, ou sobe de plano.</Note>}
              {restantes !== null && restantes > 0 && (
                <div className="t-xs dim" style={{ marginTop: 9, textAlign: 'center' }}>
                  {restantes} {restantes === 1 ? 'execução restante' : 'execuções restantes'} hoje
                </div>
              )}
              <p className="t-xs dim" style={{ marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
                Só são consultados fontes públicas. Nada é inventado: o que falhar aparece como falhou.
              </p>
            </div>
          )}
        </div>

        <div ref={resRef} style={{ minWidth: 0 }}>
          {busy && (
            <div className="card">
              <div className="card-head">A consultar fontes</div>
              <div className="progress" style={{ marginBottom: 14 }}><i /></div>
              <Skeleton lines={5} />
              <p className="t-sm muted" style={{ marginTop: 12 }}>
                Cada fonte é contactada em tempo real. O resultado só aparece quando todos os
                pedidos responderam (ou falharam de forma explícita).
              </p>
            </div>
          )}
          {!busy && !run && !locked && (
            <div className="card">
              <Empty icon={Icon.layers} title="Ainda não corriste esta ferramenta">
                Preenche o alvo e carrega em <b style={{ color: 'var(--t-2)' }}>investigar</b>.
                Vais ver os achados, a matriz de fontes que os sustenta e, quando houver,
                o grafo.
              </Empty>
            </div>
          )}
          {run && <ResultPanel run={run} />}
        </div>
      </div>
    </div>
  );
}
