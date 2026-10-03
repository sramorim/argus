/**
 * Execução do plano de investigação (FASE F) — a parte que corre e grava.
 *
 * Duas responsabilidades, separadas do planeador (`plan.ts`, puro):
 *
 *   1. **Recolher factos**: o que só se sabe ao vivo — que CLIs existem no
 *      PATH, se `APIFY_API_TOKEN` está no ambiente, quantos nós a investigação
 *      tem. É aqui que se olha para o disco e para o env, e o resultado é o
 *      que o planeador transforma em `PRONTO` ou `BLOQUEADA`.
 *   2. **Executar**: fase a fase, ferramenta a ferramenta, sempre pelo
 *      `executeTool()` (quota, tranca e concorrência do plano valem aqui), com
 *      as quatro etapas do Intelligence Engine a correrem o motor sobre os nós
 *      reais. O progresso é gravado DEPOIS de cada fase — se o processo cair a
 *      meio, o que já correu não se perde.
 *
 * Nada aqui inventa resultado: `EXECUTADA` só quando houve execução real,
 * `TRANCADA`/`QUOTA` quando o próprio plano recusou, `NAO_EXECUTADA` quando a
 * ferramenta nem chegou a ser chamada (bloqueada no plano, custo sem
 * confirmar), `ERRO` com a mensagem que veio da ferramenta.
 */
import { q } from '../db.ts';
import { executeTool, LockedError, QuotaError, type ToolCtx } from '../registry.ts';
import { PROVIDERS, TIPOS_DE_ALVO, planejar, type TipoAlvo } from '../providers/osint.ts';
import { existe } from '../providers/runtime.ts';
import { carregar as lerRegisto, type ProviderId } from '../tools/username-intel.ts';
import { token as tokenApify } from '../net/apify.ts';
import { token as tokenDataLikers } from '../net/datalikers.ts';
import { calcular } from '../intel/routes.ts';
import { capturar, carregar as lerSnapshot, guardar, presencaDe } from '../intel/snapshots.ts';
import { radar as radarDe } from '../intel/radar.ts';
import type { PlanId } from '../plans.ts';
import {
  estadoDaFase, progressoInicial,
  type Factos, type FaseNome, type Plano, type Progresso,
} from './plan.ts';

/** Linha de `investigations` com o que o executor precisa. */
export interface InvAlvo {
  id: string; user_id: string; seed: string; seed_type: string;
  title: string; created_at: string; updated_at: string;
}

const SEM_NOS = 'SELECT COUNT(*) c FROM nodes WHERE inv_id = ?';

function contarNos(invId: string): number {
  const r = q(SEM_NOS).get(invId) as { c: number } | undefined;
  return r?.c ?? 0;
}

// ------------------------------------------------------------------ factos

/** OSINT Engine: o que falta a cada provider que aceita este tipo de alvo. */
async function clisOsintEngine(inv: InvAlvo, tipo: string): Promise<Factos['clis']> {
  const out: Factos['clis'] = [];
  if (!(TIPOS_DE_ALVO as ReadonlySet<string>).has(tipo)) return out;
  for (const p of PROVIDERS) {
    if (!p.tipos.includes(tipo as TipoAlvo)) continue;
    const planejo = planejar(p, inv.seed, tipo as TipoAlvo, '');
    if (planejo.estado === 'INCOMPATIBLE') continue;

    let motivo = '';
    if (planejo.estado === 'NOT_CONFIGURED') {
      motivo = p.envCaminho
        ? `\`${p.envCaminho}\` em falta — defina o caminho de ${p.nome} (${p.instalacao})`
        : planejo.nota;
    } else if (!(await existe(planejo.executavel))) {
      motivo = planejo.executavel.includes('/')
        ? `caminho inexistente: ${planejo.executavel}`
        : planejo.executavel === 'python3'
          ? 'python3 não instalado'
          : `CLI \`${planejo.executavel}\` não instalado`;
    } else if (p.python && p.envCaminho) {
      const script = (process.env[p.envCaminho] ?? '').trim();
      if (script && !(await existe(script))) motivo = `caminho inexistente: ${script}`;
    }
    out.push({
      ferramenta: 'osint-engine', id: p.id, rotulo: p.nome,
      tipos: p.tipos, ok: !motivo, motivo,
    });
  }
  return out;
}

/** Username Intel: três registos vendurados + o CLI do Blackbird. */
async function clisUsernameIntel(inv: InvAlvo): Promise<Factos['clis']> {
  const out: Factos['clis'] = [];
  if (inv.seed_type !== 'username') return out;
  const registos: { id: Exclude<ProviderId, 'blackbird'>; rotulo: string }[] = [
    { id: 'sherlock', rotulo: 'Sherlock' },
    { id: 'whatsmyname', rotulo: 'WhatsMyName' },
    { id: 'maigret', rotulo: 'Maigret' },
  ];
  for (const r of registos) {
    const c = lerRegisto(r.id);
    out.push({
      ferramenta: 'username-intel', id: r.id, rotulo: r.rotulo, tipos: ['username'],
      ok: !c.erro, motivo: c.erro ? `registo ${r.rotulo} não lido: ${c.erro}` : '',
    });
  }
  const tem = await existe('blackbird');
  out.push({
    ferramenta: 'username-intel', id: 'blackbird', rotulo: 'Blackbird (CLI)', tipos: ['username'],
    ok: tem, motivo: tem ? '' : 'CLI `blackbird` não instalado',
  });
  return out;
}

/** Tudo o que só se sabe ao vivo. É a entrada honesta do planeador. */
export async function recolherFactos(inv: InvAlvo, plano: PlanId): Promise<Factos> {
  const clis = [...await clisOsintEngine(inv, inv.seed_type), ...await clisUsernameIntel(inv)];
  return {
    plano,
    seed: inv.seed,
    seedType: inv.seed_type,
    nos: contarNos(inv.id),
    clis,
    apifyToken: !!tokenApify().token,
    datalikersChave: !!tokenDataLikers().token,
  };
}

// ------------------------------------------------------------------ etapas

export interface ResultadoEtapa { contagem: number; nota: string }

/**
 * As etapas do Intelligence Engine (fases 5–8): código real do servidor sobre
 * os nós reais da investigação. Não passam pelo `executeTool()` porque não são
 * ferramentas de terceiros — não há quota nem tranca a respeitar, mas há
 * trabalho verdadeiro a fazer e o que sai daqui é contado.
 */
async function executarEtapa(id: string, inv: InvAlvo, userId: string): Promise<ResultadoEtapa> {
  const r = calcular(inv);
  if (!r.nodes.length) throw new Error('esta investigação já não tem nós: nada para calcular');

  switch (id) {
    case 'intel-normalizacao': {
      return {
        contagem: r.entidades.length,
        nota: `${r.resolucoes.length} pares fundidos como a mesma entidade · ${r.nodes.length} nós lidos`,
      };
    }
    case 'intel-correlacao': {
      return {
        contagem: r.correlacoes.length,
        nota: `${r.relacoes.length} relações derivadas de ${r.entidades.length} entidades`,
      };
    }
    case 'intel-perfil': {
      return {
        contagem: r.perfil.contas.length,
        nota: `confiança ${r.perfil.confiancaGeral} · ${r.perfil.identificadores.length} identificadores · `
          + `${r.cruzamento.totalPlataformas} plataformas cruzadas · ${r.perfil.lacunas.length} lacunas`,
      };
    }
    case 'intel-snapshot': {
      const presenca = presencaDe(r.perfil);
      // O anterior é lido ANTES de guardar: trocar a ordem apagaria a comparação.
      const anterior = lerSnapshot(userId, inv.seed);
      const atual = capturar(inv.seed, presenca);
      const res = radarDe(anterior, atual);
      guardar(userId, inv.seed, atual);
      return {
        contagem: presenca.plataformas.length,
        nota: res.temAnterior
          ? `${res.resumo.alteracoes} mudança(s) face ao snapshot anterior · ${presenca.perfis.length} perfis guardados`
          : `primeiro snapshot deste alvo · ${presenca.perfis.length} perfis guardados`,
      };
    }
    default:
      throw new Error(`etapa desconhecida: ${id}`);
  }
}

// --------------------------------------------------------------- execução

export interface PedidoExecucao {
  plano: Plano;
  progresso: Progresso | null;
  inv: InvAlvo;
  ctx: ToolCtx;
  confirmarCusto: boolean;
  reexecutar: boolean;
  agora: () => string;
}

/** Assinatura do que já foi corrido: se o plano mudar, o progresso não serve. */
function assinatura(fases: { fase: FaseNome; ferramentas: { id: string }[] }[]): string {
  return fases.map((f) => `${f.fase}:${f.ferramentas.map((r) => r.id).join(',')}`).join('|');
}

function mensagem(e: unknown): string {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  return m.slice(0, 300);
}

function guardarProgresso(invId: string, p: Progresso): void {
  q('UPDATE investigations SET progresso = ? WHERE id = ?').run(JSON.stringify(p), invId);
}

/**
 * Corre o plano deixa-a-fase e grava o progresso depois de cada uma.
 *
 * Re-executar só o que ainda não está `EXECUTADA` é o mecanismo de
 * "continuar": uma fase que falhou a meio volta a ser tentada sem repetir o
 * que já correu (`reexecutar` obriga a repetição de tudo).
 */
export async function executarPlano(p: PedidoExecucao): Promise<Progresso> {
  const { plano, inv, ctx } = p;
  const progresso: Progresso =
    p.progresso && assinatura(p.progresso.fases) === assinatura(plano.fases)
      ? p.progresso
      : progressoInicial(plano);

  const porFase = new Map(plano.fases.map((f) => [f.fase, f]));

  for (const rf of progresso.fases) {
    const fp = porFase.get(rf.fase);

    if (rf.pulada || !fp) {
      rf.estado = 'PENDENTE';
      rf.motivo ??= 'pulada';
      continue;
    }

    for (const reg of rf.ferramentas) {
      const entrada = fp.ferramentas.find((x) => x.id === reg.id);
      if (!entrada) continue;
      if (reg.estado === 'EXECUTADA' && !p.reexecutar) continue;

      const t0 = Date.now();
      reg.erro = undefined;
      reg.nota = entrada.nota;

      if (entrada.estado === 'BLOQUEADA') {
        // Bloqueada no plano: nem sequer é chamada. Diz-se porque não correu.
        reg.estado = 'NAO_EXECUTADA';
        reg.ms = 0;
        reg.contagem = undefined;
        reg.erro = entrada.motivo ?? 'bloqueada no plano';
        continue;
      }

      if (entrada.kind === 'etapa') {
        try {
          const res = await executarEtapa(entrada.id, inv, ctx.userId);
          reg.estado = 'EXECUTADA';
          reg.ms = Date.now() - t0;
          reg.contagem = res.contagem;
          reg.nota = res.nota;
          reg.erro = undefined;
        } catch (e) {
          reg.estado = 'ERRO';
          reg.ms = Date.now() - t0;
          reg.erro = mensagem(e);
        }
        continue;
      }

      if (entrada.id === 'apify' && !p.confirmarCusto) {
        // Pay-per-event: gastar dinheiro do utilizador sem perguntar é inaceitável.
        reg.estado = 'NAO_EXECUTADA';
        reg.ms = 0;
        reg.erro = 'custo pay-per-event não confirmado — repita com "confirmarCusto": true';
        continue;
      }

      try {
        const run = await executeTool(entrada.id, entrada.input ?? {}, ctx);
        reg.estado = 'EXECUTADA';
        reg.ms = run.ms;
        reg.contagem = run.findings.length;
        reg.nota = run.notes?.length
          ? run.notes.join(' · ')
          : (run.ok ? entrada.nota : 'correu sem resultados');
        reg.erro = undefined;
      } catch (e) {
        reg.ms = Date.now() - t0;
        if (e instanceof QuotaError || (e as { name?: string })?.name === 'QuotaError') {
          reg.estado = 'QUOTA';
        } else if (e instanceof LockedError || (e as { name?: string })?.name === 'LockedError') {
          reg.estado = 'TRANCADA';
        } else {
          reg.estado = 'ERRO';
        }
        reg.erro = mensagem(e);
      }
    }

    const estado = estadoDaFase(rf);
    rf.estado = estado.estado;
    rf.motivo = estado.motivo;
    rf.executadoEm = p.agora();
    progresso.atualizadoEm = rf.executadoEm;
    guardarProgresso(inv.id, progresso);
  }

  progresso.atualizadoEm = p.agora();
  guardarProgresso(inv.id, progresso);
  return progresso;
}
