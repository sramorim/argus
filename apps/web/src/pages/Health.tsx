/**
 * System Health — o estado real do sistema, lido do servidor.
 *
 * Este ecrã existe para responder a uma pergunta que o "está a correr" não
 * responde: **com o quê** está a correr, e o que falta. Daí três decisões:
 *
 * 1. **Nada é estimado.** Estado geral, nota, resumo e cada linha vêm tal e
 *    qual de `GET /api/health`. Se o servidor diz `NOT_CONFIGURED` e cita
 *    `APIFY_API_TOKEN`, é isso que aparece — não um "funciona na maior parte".
 * 2. **O 503 é dado, não escondido.** Um relatório com a base de dados sem
 *    escrita vem em HTTP 503; tratar isso como erro de rede seria esconder
 *    exactamente o caso que interessa. O corpo é mostrado e o código fica à
 *    vista.
 * 3. **O detalhe é um pedido novo, não um revelar.** `?detalhe=sim` faz o
 *    servidor verificar versões e, se houver token, o serviço — custa tempo de
 *    processo, por isso é o utilizador que o pede.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type EstadoSaude, type RelatorioSaude } from '../api';
import { Icon } from '../components/Icons';
import { Empty, Note, Skeleton } from '../components/ui';

/** O que cada estado significa — com as palavras do servidor, sem suavizar. */
export const SIGNIFICADO: Record<EstadoSaude, string> = {
  READY: 'instalado, configurado e verificado',
  NOT_INSTALLED: 'falta o binário ou o ficheiro',
  NOT_CONFIGURED: 'falta configuração — o nome da variável está na verificação',
  MISSING_SECRET: 'falta um segredo (BYOK); o valor nunca é mostrado',
  INCOMPATIBLE: 'não serve para este contexto',
  ERROR: 'verificado e falhou — o erro está na coluna',
  RATE_LIMITED: 'limitado pelo serviço externo',
  DISABLED: 'desativado de propósito',
};

const CLASSE_ESTADO: Record<EstadoSaude, string> = {
  READY: 'estado-ready',
  NOT_INSTALLED: 'estado-not-installed',
  NOT_CONFIGURED: 'estado-not-configured',
  MISSING_SECRET: 'estado-missing-secret',
  INCOMPATIBLE: 'estado-incompatible',
  ERROR: 'estado-error',
  RATE_LIMITED: 'estado-rate-limited',
  DISABLED: 'estado-disabled',
};

/** Ordem de leitura: do que funciona para o que falta. */
const ORDEM: EstadoSaude[] = [
  'READY', 'NOT_CONFIGURED', 'MISSING_SECRET', 'NOT_INSTALLED',
  'INCOMPATIBLE', 'DISABLED', 'RATE_LIMITED', 'ERROR',
];

export function BadgeEstado({ estado }: { estado: string }) {
  const conhecido = Object.prototype.hasOwnProperty.call(CLASSE_ESTADO, estado);
  const classe = conhecido ? CLASSE_ESTADO[estado as EstadoSaude] : 'estado-desconhecido';
  const titulo = conhecido ? SIGNIFICADO[estado as EstadoSaude] : 'estado devolvido pelo servidor e fora da lista esperada';
  return <span className={`tag ${classe}`} title={titulo}>{estado}</span>;
}

/** Uptime em dias/horas/minutos, sem partir um número que não é um tempo. */
function tempo(seg: number): string {
  if (!Number.isFinite(seg) || seg < 0) return '—';
  let resto = Math.floor(seg);
  const d = Math.floor(resto / 86400); resto -= d * 86400;
  const h = Math.floor(resto / 3600); resto -= h * 3600;
  const m = Math.floor(resto / 60); const s = resto - m * 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d > 0 ? `${d}d ` : ''}${p(h)}h ${p(m)}m ${p(s)}s`;
}

export default function Health() {
  const [rel, setRel] = useState<RelatorioSaude | null>(null);
  const [http, setHttp] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState(false);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async (d: boolean) => {
    setBusy(true);
    setErro('');
    try {
      const r = await api.saude(d);
      setRel(r.relatorio);
      setHttp(r.http);
      setAviso(r.aviso);
    } catch (e) {
      setErro((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { carregar(detalhe); }, [detalhe, carregar]);

  const resumo = rel?.resumo ?? {};
  const estadosNoResumo = ORDEM.filter((e) => (resumo[e] ?? 0) > 0);
  const total = estadosNoResumo.reduce((n, e) => n + (resumo[e] ?? 0), 0);

  return (
    <div className="page page-wide">
      <header className="card">
        <h1 className="t-h1">System Health</h1>
        <p className="t-sm muted" style={{ marginTop: 6, maxWidth: '70ch' }}>
          Estado do servidor e das suas dependências, lido de <span className="mono">GET /api/health</span>.
          O que está em falta aparece com o nome exacto da variável ou do comando — este ecrã
          mostra o diagnóstico do servidor, não uma avaliação feita aqui.
        </p>
      </header>

      {erro && (
        <div className="card">
          <Note kind="err">{erro}</Note>
        </div>
      )}

      {!rel && !erro ? (
        <div className="card"><Skeleton lines={6} /></div>
      ) : rel && (
        <>
          {/* --------------------------------------------------- estado geral */}
          <div className="card">
            <div className="card-head">
              <span>Estado geral</span>
              <span className="grow" />
              <div className="card-head-actions">
                <button
                  className="chip"
                  type="button"
                  aria-pressed={detalhe}
                  disabled={busy}
                  onClick={() => setDetalhe((d) => !d)}
                  title="Pedir ao servidor a verificação com versões, latência e serviço externo (?detalhe=sim)"
                >
                  <Icon.activity width={14} height={14} /> detalhe{detalhe ? ' ligado' : ''}
                </button>
                <button className="btn btn-sm btn-quiet" type="button" disabled={busy} onClick={() => carregar(detalhe)}>
                  {busy ? <span className="spin" /> : 'voltar a pedir'}
                </button>
              </div>
            </div>

            {aviso && <div style={{ marginBottom: 12 }}><Note kind="warn">{aviso}</Note></div>}
            {rel.erro && <div style={{ marginBottom: 12 }}><Note kind="err">{rel.erro}</Note></div>}

            <div className="estado-card" data-estado={rel.estadoGeral}>
              <div className="estado-linha">
                <BadgeEstado estado={rel.estadoGeral} />
                <span className="t-xs dim">
                  {rel.detalhe
                    ? 'verificação com detalhe: versões, latência e serviço externo'
                    : 'verificação rápida: presença e configuração, sem rede'}
                </span>
                <span className="grow" />
                <span className="t-xs dim num">{http != null ? `HTTP ${http} · ` : ''}{new Date(rel.geradoEm).toLocaleString('pt-BR')}</span>
              </div>
              <p className="estado-nota">{rel.nota}</p>
            </div>

            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>servidor</dt>
              <dd>{rel.ok ? 'base de dados com escrita' : 'base de dados SEM escrita'} · activo há {tempo(rel.uptime)}</dd>
              <dt>ambiente</dt>
              <dd className="mono">{rel.env}</dd>
              <dt>ferramentas</dt>
              <dd>{rel.tools} registadas no catálogo</dd>
              <dt>base de dados</dt>
              <dd className="mono" style={{ overflowWrap: 'anywhere' }}>
                {rel.db?.path ?? '—'}{rel.db && !rel.db.writable ? ' · sem permissão de escrita' : ''}
                {rel.db?.note ? ` · ${rel.db.note}` : ''}
              </dd>
              <dt>dependências</dt>
              <dd>{rel.providers.length} linha(s) reportadas{total ? ` · ${total} no resumo` : ''}</dd>
            </dl>
          </div>

          {/* ------------------------------------------------- resumo por estado */}
          <div className="card">
            <div className="card-head">
              <span>Resumo por estado</span>
              <span className="grow" />
              <span className="t-xs dim">{detalhe ? 'com detalhe' : 'sem detalhe'}</span>
            </div>
            {estadosNoResumo.length === 0 ? (
              <p className="t-sm dim">
                O servidor não devolveu contagem por estado. Sem contagem, não se inventa um total.
              </p>
            ) : (
              <div className="stat-row">
                {estadosNoResumo.map((e) => (
                  <div key={e}>
                    <div className="v num">{resumo[e]}</div>
                    <div className="l"><BadgeEstado estado={e} /></div>
                  </div>
                ))}
              </div>
            )}
            <p className="t-xs dim" style={{ marginTop: 10 }}>
              O estado geral é o pior estado individual: nunca se reporta "tudo pronto" com
              metade das dependências em falta.
            </p>
          </div>

          {/* --------------------------------------------------- tabela densa */}
          <div className="card">
            <div className="card-head">Dependências · {rel.providers.length} linha(s)</div>
            {rel.providers.length === 0 ? (
              <Empty icon={Icon.server} title="Sem linhas de dependências">
                O relatório chegou sem a matriz de providers. Isto é um problema do servidor, não
                uma lista vazia de instalações.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Estado</th>
                      <th>Verificação</th>
                      <th>Versão</th>
                      <th>Latência</th>
                      <th>Último teste</th>
                      <th>Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rel.providers.map((p) => (
                      <tr key={`${p.modulo}:${p.nome}`}>
                        <td data-l="nome">
                          <div className="t-xs" style={{ color: 'var(--t-1)', fontWeight: 620 }}>{p.nome}</div>
                          <div className="t-xs dim">{p.modulo} · {p.tipo} · {p.runtime}</div>
                        </td>
                        <td data-l="estado"><BadgeEstado estado={p.status} /></td>
                        <td data-l="verificação">
                          <div className="t-xs">{p.healthCheck || 'sem verificação declarada'}</div>
                          {p.configuracao && <div className="t-xs dim mono" style={{ overflowWrap: 'anywhere' }}>{p.configuracao}</div>}
                        </td>
                        <td data-l="versão" className="t-xs mono">{p.versao ?? '—'}</td>
                        <td data-l="latência" className="t-xs num">{p.latenciaMs == null ? '—' : `${p.latenciaMs} ms`}</td>
                        <td data-l="teste" className="t-xs dim">{quandoSeguro(p.ultimoTeste)}</td>
                        <td data-l="erro" className="t-xs" style={{ color: p.erro ? 'var(--erro)' : undefined, overflowWrap: 'anywhere', maxWidth: 240 }}>
                          {p.erro ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* -------------------------------------------------------- legenda */}
          <div className="card">
            <div className="card-head">O que significa cada estado</div>
            <div className="legenda">
              {ORDEM.map((e) => (
                <div className="legenda-item" key={e}>
                  <BadgeEstado estado={e} />
                  <span className="t-xs muted">{SIGNIFICADO[e]}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <Note kind="info">
                Os campos nunca trazem segredos: escrevem o <b>nome</b> da variável em falta
                (por exemplo <span className="mono">APIFY_API_TOKEN</span>) e o caminho de
                instalação, nunca o valor.
              </Note>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function quandoSeguro(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR') : iso;
}
