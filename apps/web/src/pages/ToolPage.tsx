/**
 * Página de ferramenta.
 *
 * A ordem é a mesma em todas as ferramentas, e é essa ordem que ensina o
 * utilizador a usar o produto:
 *
 *   título → o que faz e quando usar → limitações → campo → analisar →
 *   resultados → matriz de fontes
 *
 * A secção "quando usar / o que finds / limitações" não é decoração: é o que
 * separa um produto de um formulário. E as limitações estão escritas porque
 * esconder que `phone-analyzer` não descobre a operadora seria pior que
 * descobrir isso no resultado.
 *
 * Telemóvel: o formulário vem primeiro e a acção principal é fácil de alcançar.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SVGProps } from 'react';
import { motion } from 'framer-motion';
import { api, type ToolPublic, type ToolRun, type Usage, ApiError } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Field, Note, PlanTag, Skeleton, useToast } from '../components/ui';
import ModalLimite from '../components/ModalLimite';
import { GRUPOS } from '../ia';
import ResultPanel from '../components/ResultPanel';
import OmniDork from './OmniDork';

/**
 * Identificadores que a página não resolve contra o catálogo do servidor.
 *
 * O OmniDork Builder é cliente puro: monta a consulta no browser e entrega-a
 * ao motor de busca numa separador nova, sem `api.run`, sem cota e sem
 * proveniência a inventar. Por isso não pode ser uma `ToolPublic` — não há
 * nada para o servidor executar. Vive na mesma rota `/ferramenta/:id` para
 * abrir na mesma janela que as ferramentas, e é deste mapa que o AppShell
 * tira o título e o ícone da barra de título.
 */
export const MODULOS: Record<string, {
  titulo: string;
  icone: (p: SVGProps<SVGSVGElement>) => ReactElement;
  render: () => ReactElement;
}> = {
  omnidork: {
    titulo: 'OmniDork Builder',
    icone: Icon.search,
    render: () => <OmniDork />,
  },
};

const INPUT_MODE: Record<string, string> = {
  email: 'email', url: 'url', wallet: 'text', hash: 'text',
  cve: 'text', package: 'text', text: 'text', file: 'text',
};
const AUTOCOMPLETE: Record<string, string> = { email: 'email', url: 'url', text: 'off' };

/**
 * Os tipos de alvo que o detector do servidor reconhece.
 *
 * Esta lista não é uma invenção da interface: é a transcrição das expressões
 * regulares de `detectSeedType()` (`apps/server/src/tools/graph.ts`). O
 * servidor é que decide o tipo — o ecrã só mostra o que o servidor aceita, e
 * o exemplo é genérico (`alvo_demo`, `exemplo.com`) para não meter o nome de
 * uma pessoa real como demonstração.
 */
const TIPOS_ALVO: { tipo: string; exemplo: string; icone: (p: SVGProps<SVGSVGElement>) => ReactElement }[] = [
  { tipo: 'username', exemplo: 'alvo_demo', icone: Icon.user },
  { tipo: 'domínio', exemplo: 'exemplo.com', icone: Icon.globe },
  { tipo: 'e-mail', exemplo: 'pessoa@exemplo.com', icone: Icon.mail },
  { tipo: 'telefone', exemplo: '+55 11 99999-9999', icone: Icon.phone },
  { tipo: 'IP', exemplo: '8.8.8.8', icone: Icon.server },
  { tipo: 'URL', exemplo: 'https://exemplo.com/pagina', icone: Icon.link },
  { tipo: 'carteira', exemplo: 'bc1qexemplo', icone: Icon.coins },
  { tipo: 'CVE', exemplo: 'CVE-2021-44228', icone: Icon.shield },
  { tipo: 'empresa (CNPJ)', exemplo: '12.345.678/0001-90', icone: Icon.building },
  { tipo: 'CEP', exemplo: '01310-100', icone: Icon.target },
];

/** Etiqueta do campo, para o texto de "quando usar" não ficar genérico. */
const VERBO: Record<string, string> = {
  Analisar: 'Analisar', Verificar: 'Verificar', Auditar: 'Auditar',
  Gerar: 'Gerar', Localizar: 'Localizar', Consulta: 'Consultar',
  Rastrear: 'Rastrear', Exposição: 'Verificar', Scanner: 'Analisar',
  Rastreador: 'Rastrear', Investigação: 'Investigar', Extrator: 'Extrair',
};

export default function ToolPage({
  id, tools, onUsage, comoAlvo, onLimites,
}: {
  id: string; tools: ToolPublic[]; onUsage: () => void; comoAlvo?: boolean;
  /** Abre Conta > Gerenciar limites. E o unico caminho que o modal oferece. */
  onLimites?: () => void;
}) {
  const t = tools.find((x) => x.id === id);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, { data: string; name: string; bytes: number }>>({});
  const [run, setRun] = useState<ToolRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /* Limite de créditos do plano. O servidor recusa o pedido e manda o Y; aqui
     só se mostra o modal — não há contagem no cliente que possa divergir. */
  const [limite, setLimite] = useState<{ abertos: boolean; total: number }>({ abertos: false, total: 0 });
  /* O formato do exemplo escolhido nos chips de tipo de alvo. */
  const [exemplo, setExemplo] = useState('');
  const toast = useToast();
  const resRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const busyFor = useRef<string | null>(null);

  useEffect(() => { setVals({}); setFiles({}); setRun(null); setErr(''); setExemplo(''); }, [id]);
  useEffect(() => { if (busy) resRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [busy]);

  /* Módulos independentes: existem mesmo sem estarem no catálogo, por isso
     entram antes da procura que levaria a "Ferramenta não encontrada". */
  const modulo = MODULOS[id];
  if (modulo) return modulo.render();

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
  const grupo = GRUPOS.find((g) => g.ferramentas.includes(t.id));
  const restantes = usage ? Math.max(0, usage.daily - usage.today) : null;
  const semEspaco = restantes !== null && restantes === 0;
  const primeiro = t.fields[0];
  const verbo = (VERBO[Object.keys(VERBO).find((k) => t.name.startsWith(k)) ?? ''] ?? 'Analisar').toLowerCase();

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
    setExemplo('');
    try {
      const r = await api.run(t.id, vals);
      setRun(r.run);
      setUsage(r.usage);
      onUsage();
    } catch (e) {
      const a = e as ApiError;
      let msg = a.message;
      if (a.code === 'limite_plano') {
        // Sem resultado e sem nota: o pedido nem saiu. O que se mostra é o
        // limite, não um erro dentro de uma tabela vazia.
        setRun(null);
        setLimite({ abertos: true, total: Number(a.limite ?? 0) });
        return;
      }
      if (a.code === 'bloqueada') msg = `Esta ferramenta exige o plano ${a.minPlan === 'pro_max' ? 'Pro Max' : 'Pro'}.`;
      else if (a.code === 'limite') msg = a.message;
      else if (a.code === 'campo_obrigatorio') msg = `Falta preencher “${t.fields.find((f) => f.name === a.field)?.label ?? a.field}”.`;
      else if (a.code === 'demasiadas_execucoes' || a.code === 'demasiados_pedidos') msg = a.message;
      else if (a.code === 'sem_rede') msg = 'Sem ligação ao servidor.';
      setErr(msg);
    } finally { setBusy(false); busyFor.current = null; }
  };

  return (
    <div className="page page-wide">
      {!comoAlvo && grupo && (
        <div className="t-xs dim" style={{ marginBottom: 'var(--s-3)', lineHeight: 1.58 }}>
          {grupo.nome} · {grupo.resumo}
        </div>
      )}

      <div className="tool-layout">
        {/* ---------------- coluna do formulário ---------------- */}
        <div className="tool-form-col">
          <header className="card">
            <h1 className="t-h1">{t.name}</h1>
            <p className="t-sm muted" style={{ marginTop: 8, lineHeight: 1.7 }}>{t.longDesc}</p>
            <div className="row" style={{ marginTop: 13, gap: 6 }}>
              {locked
                ? <PlanTag minPlan={t.minPlan} locked />
                : <span className="tag tag-free">Disponível no teu plano</span>}
              {t.legalGate === 'lgpd' && <span className="tag tag-legal">LGPD · uso defensivo</span>}
              {t.legalGate === 'restricted' && <span className="tag">uso restrito</span>}
            </div>
          </header>

          {locked ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="empty-ico" style={{ margin: '0 auto 12px' }}><Icon.lock /></div>
              <h2 className="t-h3">Precisa de um plano superior</h2>
              <p className="t-sm muted" style={{ margin: '9px 0 16px', lineHeight: 1.64 }}>
                Esta ferramenta está no plano {t.minPlan === 'pro_max' ? 'Pro Max' : 'Pro'}.
                O plano Free nunca expira e não pede cartão — o desbloqueio é só se
                precisares de mais volume.
              </p>
              <motion.button
                className="btn btn-primary btn-block"
                type="button"
                onClick={() => { location.hash = '#planos'; }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.995 }}
                transition={{ type: 'spring', stiffness: 420, damping: 24 }}
              >
                ver planos
              </motion.button>
            </div>
          ) : (
            <div className="card">
              <div className="card-head">{t.fields.length > 1 ? 'Alvo' : 'Alvo a analisar'}</div>
              {err && <div style={{ marginBottom: 13 }}><Note kind="err">{err}</Note></div>}

              {comoAlvo && t.fields.length === 1 && (
                <>
                  <p className="t-sm muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
                    O tipo é detectado pelo servidor. Escolhe um para ver o formato, ou escreve
                    directamente — tanto faz a ordem.
                  </p>
                  <div className="chip-row" style={{ marginBottom: 16 }}>
                    {TIPOS_ALVO.map((t2) => (
                      <button
                        key={t2.tipo}
                        className="chip"
                        type="button"
                        onClick={() => {
                          setVals((v) => ({ ...v, [primeiro.name]: '' }));
                          setExemplo(`${t2.exemplo}  ·  ${t2.tipo}`);
                          campoRef.current?.focus();
                        }}
                      >
                        <t2.icone width={15} height={15} />
                        {t2.tipo}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {t.fields.map((f) => (
                <Field key={f.name} label={f.label} hint={f.hint ?? (exemplo || undefined)} required={f.required}>
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
                      ref={f === primeiro ? campoRef : undefined}
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

              <div className="cta-sticky">
                <motion.button
                  className="btn btn-primary btn-block" type="button"
                  onClick={go} disabled={busy || semEspaco}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                >
                  {busy ? <><span className="spin" /> a analisar…</> : <><Icon.target /> {verbo}</>}
                </motion.button>
              </div>

              {semEspaco && (
                <div style={{ marginTop: 12 }}>
                  <Note kind="warn">A cota de hoje acabou. Volta amanhã, ou sobe de plano.</Note>
                </div>
              )}
              {restantes !== null && restantes > 0 && (
                <div className="t-xs dim" style={{ marginTop: 10, textAlign: 'center' }}>
                  {restantes} {restantes === 1 ? 'execução restante' : 'execuções restantes'} hoje
                </div>
              )}

              <p className="t-xs dim" style={{ marginTop: 11, textAlign: 'center', lineHeight: 1.64 }}>
                Só fontes públicas. O que não responder aparece como não respondeu —
                nada é preenchido com um resultado plausível inventado.
              </p>
            </div>
          )}
        </div>

        {/* ---------------- coluna do resultado ---------------- */}
        <div ref={resRef} style={{ minWidth: 0 }}>
          {busy && (
            <div className="card">
              <div className="card-head">A consultar fontes</div>
              <div className="progress" style={{ marginBottom: 15 }}><i /></div>
              <Skeleton lines={5} />
              <p className="t-sm muted" style={{ marginTop: 13, lineHeight: 1.68 }}>
                Cada fonte é contactada em tempo real, em paralelo. O resultado só
                aparece quando todas responderam — ou falharam de forma explícita.
              </p>
            </div>
          )}

          {!busy && !run && !locked && (
            <div className="card">
              <Empty icon={Icon.layers} title="Ainda não correste esta ferramenta">
                {primeiro
                  ? <>Escreve {primeiro.label.toLowerCase()} no campo ao lado e carrega em <b style={{ color: 'var(--t-2)' }}>{verbo}</b>. Vais ver os achados e a matriz de fontes que os sustenta.</>
                  : <>Preenche o alvo e carrega em <b style={{ color: 'var(--t-2)' }}>{verbo}</b>.</>}
              </Empty>
            </div>
          )}

          {run && <ResultPanel run={run} />}
        </div>
      </div>

      {/* Limite do plano. O botão não pede conta externa nem chave: leva à
          página onde a pessoa escolhe o que fazer. */}
      <ModalLimite
        abertos={limite.abertos}
        limite={limite.total}
        onFechar={() => setLimite({ abertos: false, total: 0 })}
        onGerenciar={() => {
          setLimite({ abertos: false, total: 0 });
          onLimites?.();
        }}
      />
    </div>
  );
}
