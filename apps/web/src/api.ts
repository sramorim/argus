import { useEffect, useState } from 'react';

/**
 * Cliente da API + tipos partilhados com o servidor.
 *
 * Nota de desenho: o `fetch` leva sempre `credentials: 'same-origin'` e os
 * erros do servidor chegam como `{ error, msg }`. O que este ficheiro NÃO faz é
 * decidir nada sobre o utilizador — plano, trancas e cotas vêm sempre do
 * servidor, em cada resposta.
 */

export type PlanId = 'free' | 'pro' | 'pro_max';
export type Confidence = 'confirmed' | 'corroborated' | 'indicated' | 'weak';
export type SourceStatus = 'ok' | 'empty' | 'skipped' | 'error' | 'needs_key' | 'timeout';

export interface ToolField {
  name: string; label: string;
  type: 'text' | 'url' | 'email' | 'hash' | 'wallet' | 'cve' | 'package' | 'file';
  placeholder?: string; required: boolean; hint?: string;
}
export interface ToolPublic {
  id: string; name: string; category: string; summary: string; longDesc: string;
  minPlan: PlanId; fields: ToolField[]; freeTier: boolean; legalGate: string; tags: string[];
  lock: 'open' | 'locked'; dailyRuns: number; maxItems: number;
}
export interface Source {
  id: string; label: string; url: string; status: SourceStatus;
  ms?: number; note?: string; count?: number;
}
export interface Finding {
  id: string; group: string; label: string; value: unknown;
  evidence: { kind: 'fact' | 'inference' | 'claim'; confidence: Confidence; sourceIds: string[]; at: string };
  link?: string;
}
export interface ToolRun {
  id?: string; toolId: string; input: Record<string, string>; at: string; ms: number; ok: boolean;
  sources: Source[]; findings: Finding[]; notes: string[];
}
export interface Plan {
  id: PlanId; name: string; priceBRL: number; pricePeriod: string;
  dailyRuns: number; burstRuns: number; maxItems: number; graphHops: number;
  investigations: number; concurrent: number; highlight: string; perks: string[];
}
export interface User { userId: string; plan: PlanId; email: string; name: string; isAdmin: boolean; }
export interface Usage { today: number; daily: number; inflight?: number; concurrent?: number; maxItems?: number; graphHops?: number; investigations?: number; }

export interface GraphNode {
  id: string; type: string; label: string; value: string;
  confidence: Confidence; sourceIds: string[]; hop: number;
  attrs?: Record<string, unknown> | null;
}
export interface GraphEdge { from: string; to: string; rel: string; confidence: Confidence; sourceIds: string[]; }
export interface Graph {
  nodes: GraphNode[]; edges: GraphEdge[];
  runs: { toolId: string; ok: boolean; ms: number; findingCount: number; note?: string }[];
  seedType: string;
}

export interface Investigation {
  id: string; seed: string; seed_type: string; title: string;
  created_at: string; updated_at: string; node_count?: number; edge_count?: number;
  tools?: { toolId: string; ok: boolean; ms: number; findingCount: number }[] | null;
}
export interface InvestigationDetail {
  investigation: Investigation;
  nodes: GraphNode[]; edges: GraphEdge[];
}
export interface ByokProvider { id: string; label: string; usedBy: string; doc: string; }

export class ApiError extends Error {
  status: number; code: string; field?: string; kind?: string; minPlan?: string;
  constructor(status: number, code: string, msg: string) {
    super(msg);
    this.status = status; this.code = code;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'sem_rede', 'Sem ligação ao servidor. Verifique a rede.');
  }
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    const e = new ApiError(r.status, data?.error ?? `http_${r.status}`, data?.msg ?? data?.error ?? `HTTP ${r.status}`);
    e.field = data?.field; e.kind = data?.kind; e.minPlan = data?.minPlan;
    throw e;
  }
  return data as T;
}

export interface Contacto {
  whatsapp: string;
  label: string;
  link: string;
  autor: string;
  autorLink: string | null;
  copyright: string;
}

export const api = {
  health: () => req<{ ok: boolean; tools: number }>('/api/health'),
  contacto: () => req<Contacto>('/api/contact'),
  me: () => req<{ user: User | null; usage?: Usage }>('/api/me'),
  tools: () => req<{ tools: ToolPublic[]; plan: PlanId; usage: Usage | null }>('/api/tools'),
  tool: (id: string) => req<{ tool: ToolPublic }>(`/api/tools/${encodeURIComponent(id)}`),
  plans: () => req<{ plans: Plan[] }>('/api/plans'),
  byokProviders: () => req<{ providers: ByokProvider[] }>('/api/byok/providers'),

  register: (b: { email: string; name: string; password: string }) =>
    req<{ ok: boolean; user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    req<{ ok: boolean; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => req<{ ok: boolean }>('/api/auth/logout-all', { method: 'POST' }),
  changePassword: (current: string, next: string) =>
    req<{ ok: boolean; msg: string }>('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  deleteAccount: (password: string) =>
    req<{ ok: boolean; msg: string }>('/api/auth/delete-account', { method: 'POST', body: JSON.stringify({ password }) }),

  run: (id: string, input: Record<string, string>) =>
    req<{ run: ToolRun; usage: Usage }>(`/api/run/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(input) }),

  inspectFile: (b: { data?: string; url?: string; name?: string }) =>
    req<{ ok: boolean; tipo: string; bytes: number; origem: string; nome: string; contentType: string | null }>(
      '/api/arquivo/inspect', { method: 'POST', body: JSON.stringify(b) }),

  keys: () => req<{ keys: { provider: string; created_at: string; meta: ByokProvider | null }[] }>('/api/keys'),
  addKey: (provider: string, secret: string) =>
    req<{ ok: boolean }>('/api/keys', { method: 'POST', body: JSON.stringify({ provider, secret }) }),
  delKey: (provider: string) => req<{ ok: boolean }>(`/api/keys/${encodeURIComponent(provider)}`, { method: 'DELETE' }),

  investigations: () => req<{ investigations: Investigation[] }>('/api/investigations'),
  investigation: (id: string) => req<InvestigationDetail>(`/api/investigations/${encodeURIComponent(id)}`),
  renameInvestigation: (id: string, title: string) =>
    req<{ ok: boolean }>(`/api/investigations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  delInvestigation: (id: string) => req<{ ok: boolean }>(`/api/investigations/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  history: () => req<{ runs: { id: string; tool_id: string; input: string; created_at: string; bytes: number }[] }>('/api/historico'),
  historyItem: (id: string) => req<{ run: ToolRun; at: string; input: Record<string, string> }>(`/api/historico/${encodeURIComponent(id)}`),

  admin: () => req<{
    users: { id: string; email: string; name: string; plan: PlanId; is_admin: number; suspended: number; created_at: string }[];
    nUsers: number; nRuns: number; nInvs: number; hoje: number; plans: Plan[]; db: { path: string; writable: boolean };
  }>('/api/admin/estado'),
  adminSetPlan: (id: string, plan: PlanId, resetUsage?: boolean) =>
    req<{ ok: boolean }>(`/api/admin/user/${encodeURIComponent(id)}/plano`, { method: 'POST', body: JSON.stringify({ plan, resetUsage }) }),
  adminSetFlags: (id: string, flags: { isAdmin?: boolean; suspended?: boolean }) =>
    req<{ ok: boolean }>(`/api/admin/user/${encodeURIComponent(id)}/flags`, { method: 'POST', body: JSON.stringify(flags) }),
};

/**
 * Canal de contacto.
 *
 * O número **não é a fonte da verdade**: vem do servidor, de
 * `/api/contact`, que o lê de `ARGUS_CONTACTO_WHATSAPP`. Estava escrito aqui
 * e estava errado (faltava o 9 do celular brasileiro), e para corrigir um número
 * de telefone não devia ser preciso tocar em código nem reconstruir o frontend.
 * Mudar o número passa a ser uma variável de ambiente e um reinício.
 *
 * O valor de aqui é apenas o que se usa antes de o servidor responder (e se ele
 * não responder, a app mostra o botão de contacto indisponível em vez de um
 * número errado).
 */
export const CONTACTO = {
  whatsapp: '5547997876098',
  label: 'WhatsApp (47) 99787-6098',
} as const;

/** Link de WhatsApp com a mensagem já preenchida. */
export function pedidoPlanoLink(plan: Plan, user?: { email?: string; name?: string } | null, wa: string = CONTACTO.whatsapp): string {
  const preco = plan.priceBRL === 0 ? 'Grátis' : `R$ ${plan.priceBRL.toFixed(2).replace('.', ',')}/mês`;
  const linhas = [
    `Olá! Quero ativar o plano ${plan.name} (${preco}) no ARGUS.`,
    user?.name ? `Nome: ${user.name}` : '',
    user?.email ? `Conta no ARGUS: ${user.email}` : '',
  ].filter(Boolean);
  return `https://wa.me/${wa}?text=${encodeURIComponent(linhas.join('\n'))}`;
}

export const CONF_LABEL: Record<Confidence, string> = {
  confirmed: 'Confirmado', corroborated: 'Corroborado', indicated: 'Indicado', weak: 'Fraco',
};
export const CONF_HINT: Record<Confidence, string> = {
  confirmed: 'Fato verificado diretamente na fonte, sem ambiguidade.',
  corroborated: 'Duas ou mais fontes independentes concordam.',
  indicated: 'Sinal indireto. Pode ser falso positivo — leia a nota da fonte.',
  weak: 'Hipótese fraca ou cálculo local. Não trate como prova.',
};
export const KIND_LABEL: Record<string, string> = { fact: 'fato', inference: 'inferência', claim: 'alegação' };
export const STATUS_LABEL: Record<SourceStatus, string> = {
  ok: 'OK', empty: 'Vazio', skipped: 'Ignorada', error: 'Erro', needs_key: 'Precisa de chave', timeout: 'Timeout',
};
export const PLAN_NAME: Record<PlanId, string> = { free: 'Free', pro: 'Pro', pro_max: 'Pro Max' };

/**
 * Contacto e autoria, vindos do servidor.
 *
 * Fica num hook para haver **uma** fonte no frontend. Quando o número estava
 * escrito à mão aparecia em três sítios e divergia do que o dono usava; o hook
 * elimina a possibilidade de um sítio ficar com o número antigo.
 *
 * Devolve `null` enquanto o servidor não responde, para o botão aparecer
 * desligado em vez de com um número que não é o certo.
 */
let _contacto: Contacto | null = null;
let _contactoPromise: Promise<Contacto | null> | null = null;

export function useContacto(): Contacto | null {
  const [c, setC] = useState<Contacto | null>(_contacto);
  useEffect(() => {
    if (_contacto) return;
    if (!_contactoPromise) {
      _contactoPromise = api.contacto()
        .then((r) => { _contacto = r; return r; })
        .catch(() => null);
    }
    let vivo = true;
    _contactoPromise.then((r) => { if (vivo) setC(r); });
    return () => { vivo = false; };
  }, []);
  return c;
}
