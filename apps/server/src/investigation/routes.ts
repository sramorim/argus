/**
 * Rotas do plano de investigação (FASE F) — planejar, ler, executar.
 *
 *   POST /api/investigations/:id/plan            gere (ou recrie) o plano
 *   GET  /api/investigations/:id/plan            o plano + o progresso actual
 *   POST /api/investigations/:id/plan/executar   corra o que falta e devolva
 *                                                o progresso actualizado
 *
 * Todas exigem sessão e só mexem na investigação do próprio utilizador (404,
 * nunca 403: um 403 confirmaria que o id existe). Os erros do planeador saem
 * como 400 com o motivo concreto — modo, ferramenta desconhecida ou ferramenta
 * que existe mas não pertence às 8 fases.
 *
 * Aqui não se decide estado nenhum: quem decide é `plan.ts` (puro) e quem corre
 * é `exec.ts`. A rota só recolhe o corpo, valida, persiste e responde.
 */
import { Hono } from 'hono';
import { q } from '../db.ts';
import { requireAuth } from '../security.ts';
import { allTools } from '../registry.ts';
import { executarPlano, recolherFactos, type InvAlvo } from './exec.ts';
import {
  montarPlano, resumoProgresso, validarEscolhas,
  type ItemCatalogo, type Plano, type Progresso,
} from './plan.ts';

export interface DepsPlano {
  /** Chaves BYOK do utilizador, para as ferramentas que as precisam. */
  byokFor: (userId: string) => Record<string, string>;
  /** Limitador de execuções por minuto (o mesmo das rotas de run). */
  limite: (c: any, userId: string) => Response | null;
}

interface LinhaPlano { plano: string | null; progresso: string | null }

function parse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

function carregarInv(invId: string, userId: string): InvAlvo | null {
  const inv = q('SELECT id, user_id, seed, seed_type, title, created_at, updated_at FROM investigations WHERE id = ?')
    .get(invId) as InvAlvo | undefined;
  if (!inv || inv.user_id !== userId) return null;
  return inv;
}

function lerEstado(invId: string): { plano: Plano | null; progresso: Progresso | null } {
  const row = q('SELECT plano, progresso FROM investigations WHERE id = ?').get(invId) as LinhaPlano | undefined;
  return { plano: parse<Plano>(row?.plano), progresso: parse<Progresso>(row?.progresso) };
}

async function corpo(c: any): Promise<Record<string, unknown> | null> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function catalogo(): ItemCatalogo[] {
  return allTools().map((t) => ({ id: t.id, nome: t.name, minPlan: t.minPlan }));
}

/** Dois planos iguais são iguais também nas horas: só os factos é que mudam. */
function semHora(p: Plano): string {
  return JSON.stringify({ ...p, geradoEm: '' });
}

export function criarPlanoRouter(deps: DepsPlano): Hono {
  const r = new Hono();

  r.post('/:id/plan', async (c) => {
    const u = requireAuth(c);
    if (u instanceof Response) return u;
    const inv = carregarInv(c.req.param('id'), u.userId);
    if (!inv) return c.json({ error: 'nao_encontrada', msg: 'Investigação não existe.' }, 404);

    const b = (await corpo(c)) ?? {};
    const modo = typeof b.modo === 'string' ? b.modo.trim() : '';
    if (!modo) {
      return c.json({ error: 'modo_em_falta', msg: 'Indique "modo": QUICK, FULL ou CUSTOM.' }, 400);
    }
    const escolhidas = Array.isArray(b.ferramentas)
      ? b.ferramentas.filter((x): x is string => typeof x === 'string')
      : undefined;

    const cat = catalogo();
    const e = validarEscolhas(modo, escolhidas, cat);
    if (e) {
      return c.json({
        error: e.erro, msg: e.msg,
        ...(e.id ? { id: e.id } : {}),
        ...(e.fase ? { fase: e.fase } : {}),
        ...(e.aceites ? { aceites: e.aceites } : {}),
      }, 400);
    }

    const factos = await recolherFactos(inv, u.plan);
    const plano = montarPlano({ modo, ferramentas: escolhidas, catalogo: cat, factos, agora: new Date().toISOString() });

    // Um plano novo (modo ou ferramentas diferentes) invalida o que já se
    // tinha corrido — guardar um progresso que já não descreve o plano seria
    // mentir sobre o estado. O mesmo plano mantém o progresso.
    const { plano: antigo, progresso } = lerEstado(inv.id);
    const mudou = !antigo || semHora(antigo) !== semHora(plano);
    const proximo = mudou ? null : progresso;
    q('UPDATE investigations SET plano = ?, progresso = ? WHERE id = ?')
      .run(JSON.stringify(plano), proximo ? JSON.stringify(proximo) : null, inv.id);

    return c.json({ plano, progresso: proximo, resumo: proximo ? resumoProgresso(proximo) : null });
  });

  r.get('/:id/plan', (c) => {
    const u = requireAuth(c);
    if (u instanceof Response) return u;
    const inv = carregarInv(c.req.param('id'), u.userId);
    if (!inv) return c.json({ error: 'nao_encontrada', msg: 'Investigação não existe.' }, 404);
    const { plano, progresso } = lerEstado(inv.id);
    return c.json({ plano, progresso, resumo: progresso ? resumoProgresso(progresso) : null });
  });

  r.post('/:id/plan/executar', async (c) => {
    const u = requireAuth(c);
    if (u instanceof Response) return u;
    const inv = carregarInv(c.req.param('id'), u.userId);
    if (!inv) return c.json({ error: 'nao_encontrada', msg: 'Investigação não existe.' }, 404);

    const { plano, progresso } = lerEstado(inv.id);
    if (!plano) {
      return c.json({ error: 'sem_plano', msg: 'Esta investigação ainda não tem plano — gere-o com POST .../plan.' }, 404);
    }

    const den = deps.limite(c, u.userId);
    if (den) return den;

    const b = (await corpo(c)) ?? {};
    const pedido = {
      plano,
      progresso,
      inv,
      ctx: { userId: u.userId, plan: u.plan, byok: deps.byokFor(u.userId) },
      confirmarCusto: b.confirmarCusto === true,
      reexecutar: b.reexecutar === true,
      agora: () => new Date().toISOString(),
    };

    try {
      const p = await executarPlano(pedido);
      return c.json({ plano, progresso: p, resumo: resumoProgresso(p) });
    } catch (err: any) {
      // Falha inesperada: o progresso gravado a meio é a verdade que fica.
      const atual = lerEstado(inv.id).progresso;
      const msg = String(err?.message ?? err).slice(0, 300);
      if (atual) return c.json({ plano, progresso: atual, resumo: resumoProgresso(atual), erro: msg }, 200);
      return c.json({ error: 'erro_execucao', msg }, 500);
    }
  });

  return r;
}
