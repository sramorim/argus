/** Contrato de ferramenta + executor. Ferramentas sao dados, nao codigo espalhado. */
import { SourceLog, type Finding, type ToolRun } from './net/provenance.ts';
import { db, q } from './db.ts';
import { PLANS, type PlanId, type MinPlan, TOOL_LOCKS, meetsPlan, type LockState } from './plans.ts';

export type ToolCategory = 'pessoa' | 'infra' | 'ameaca' | 'web' | 'arquivo' | 'financeiro' | 'dev' | 'br' | 'geo';

export interface ToolField {
  name: string;
  label: string;
  type: 'text' | 'url' | 'email' | 'hash' | 'wallet' | 'cve' | 'package' | 'file';
  placeholder?: string;
  required: boolean;
  hint?: string;
}

export interface ToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  summary: string;
  longDesc: string;
  minPlan: MinPlan;
  fields: ToolField[];
  freeTier: boolean;
  legalGate?: 'none' | 'lgpd' | 'restricted';
  tags: string[];
  /** Executa a ferramenta. Devolve findings + log de fontes. */
  run(input: Record<string, string>, ctx: ToolCtx): Promise<{ findings: Finding[]; log: SourceLog; notes?: string[] }>;
}

export interface ToolCtx {
  userId: string;
  plan: PlanId;
}

const registry = new Map<string, ToolDef>();
export function registerTool(t: ToolDef): void { registry.set(t.id, t); }
export function getTool(id: string): ToolDef | undefined { return registry.get(id); }
export function allTools(): ToolDef[] { return [...registry.values()]; }

export function lockState(toolId: string, plan: PlanId): LockState {
  const min = TOOL_LOCKS[toolId] ?? toolIdDefMin(toolId);
  return meetsPlan(plan, min) ? 'open' : 'locked';
}
function toolIdDefMin(id: string): MinPlan {
  return (registry.get(id)?.minPlan ?? 'free') as MinPlan;
}

/** Metadados publicos (sem run) para o catalogo. */
export interface ToolPublic {
  id: string; name: string; category: ToolCategory; summary: string; longDesc: string;
  minPlan: MinPlan; fields: ToolField[]; freeTier: boolean; legalGate: string; tags: string[];
  lock: LockState; dailyRuns: number; maxItems: number;
}

export function publicTool(t: ToolDef, plan: PlanId): ToolPublic {
  return {
    id: t.id, name: t.name, category: t.category, summary: t.summary, longDesc: t.longDesc,
    minPlan: t.minPlan, fields: t.fields, freeTier: t.freeTier, legalGate: t.legalGate ?? 'none',
    tags: t.tags, lock: lockState(t.id, plan),
    dailyRuns: PLANS[plan].dailyRuns, maxItems: PLANS[plan].maxItems,
  };
}

/** Quotas: burst em janela deslizante + contador diário + execuções em curso. */
export function todayKey(): string { return new Date().toISOString().slice(0, 10); }
export function dailyCount(userId: string): number {
  const row = q('SELECT COUNT(*) c FROM usage WHERE user_id = ? AND at >= ?').get(userId, todayKey()) as { c: number };
  return row?.c ?? 0;
}
export function recordUsage(userId: string, toolId: string): void {
  q('INSERT INTO usage(user_id, tool_id, at) VALUES(?,?,?)').run(userId, toolId, new Date().toISOString());
}

/**
 * Execuções em curso por utilizador.
 *
 * O plano promete "3 execuções em paralelo" / "6 em paralelo". Prometer e não
 * cumprir é pior do que não ter: sem isto, um script podia disparar 50 pedidos
 * ao mesmo tempo e o que se limitaria era o servidor, não o plano.
 */
const inflightRuns = new Map<string, number>();
export function inflightCount(userId: string): number { return inflightRuns.get(userId) ?? 0; }
function beginRun(userId: string): void { inflightRuns.set(userId, inflightCount(userId) + 1); }
function endRun(userId: string): void {
  const n = inflightRuns.get(userId);
  if (n === undefined) return;
  if (n <= 1) inflightRuns.delete(userId); else inflightRuns.set(userId, n - 1);
}

export class QuotaError extends Error {
  kind: 'daily' | 'burst' | 'concorrente';
  constructor(kind: 'daily' | 'burst' | 'concorrente', msg: string) {
    super(msg);
    this.name = 'QuotaError';
    this.kind = kind;
  }
}
export class LockedError extends Error {
  minPlan: MinPlan;
  constructor(minPlan: MinPlan) {
    super('Ferramenta bloqueada no seu plano');
    this.name = 'LockedError';
    this.minPlan = minPlan;
  }
}

export async function executeTool(
  toolId: string,
  input: Record<string, string>,
  ctx: ToolCtx,
): Promise<ToolRun> {
  const tool = registry.get(toolId);
  if (!tool) throw new Error(`Ferramenta desconhecida: ${toolId}`);
  if (lockState(toolId, ctx.plan) === 'locked') throw new LockedError(tool.minPlan);

  const plan = PLANS[ctx.plan];
  if (dailyCount(ctx.userId) >= plan.dailyRuns) {
    throw new QuotaError('daily', `Limite diário atingido (${plan.dailyRuns}/dia no plano ${plan.name}).`);
  }
  const recent = q('SELECT COUNT(*) c FROM usage WHERE user_id = ? AND at > ?')
    .get(ctx.userId, new Date(Date.now() - 60_000).toISOString()) as { c: number };
  if ((recent?.c ?? 0) >= plan.burstRuns) {
    throw new QuotaError('burst', `Demasiadas execuções seguidas. Máximo ${plan.burstRuns}/min no plano ${plan.name}.`);
  }
  if (inflightCount(ctx.userId) >= plan.concurrent) {
    throw new QuotaError('concorrente', `Já tem ${plan.concurrent} execuções em curso (limite do plano ${plan.name}). Espere que terminem.`);
  }

  const t0 = Date.now();
  beginRun(ctx.userId);
  let raw: Finding[];
  let log: SourceLog;
  let notes: string[];
  try {
    ({ findings: raw, log, notes = [] } = await tool.run(input, ctx));
  } finally {
    endRun(ctx.userId);
  }
  recordUsage(ctx.userId, toolId);

  // Truncar por plano: honesto, com nota explicita
  let findings = raw;
  const cap = plan.maxItems;
  if (findings.length > cap) {
    findings = findings.slice(0, cap);
    notes.push(`Resultado truncado para ${cap} itens (limite do plano ${plan.name}). Total encontrado: ${raw.length}.`);
  }

  const run: ToolRun = {
    toolId,
    input,
    at: new Date().toISOString(),
    ms: Date.now() - t0,
    ok: findings.length > 0 || log.sources.some((s) => s.status === 'ok'),
    sources: log.sources,
    findings,
    notes,
  };
  const runId = crypto.randomUUID();
  q('INSERT INTO runs(id,user_id,tool_id,input,output,created_at) VALUES(?,?,?,?,?,?)')
    .run(runId, ctx.userId, toolId, JSON.stringify(input), JSON.stringify(run), run.at);
  run.id = runId;
  return run;
}
