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

/* ------------------------------------------------------------------ saúde */
/** Os oito estados do `/api/health`, tal como o servidor os devolve. */
export type EstadoSaude =
  | 'READY' | 'NOT_INSTALLED' | 'NOT_CONFIGURED' | 'MISSING_SECRET'
  | 'INCOMPATIBLE' | 'ERROR' | 'RATE_LIMITED' | 'DISABLED';

/** Uma linha por dependência. O que falta vem no `healthCheck`/`configuracao`. */
export interface LinhaSaude {
  nome: string; modulo: string; tipo: string; runtime: string;
  versao: string | null; cliApi: string; dependencias: string;
  apikey: string | null; secret: string | null; servicoExterno: string | null;
  status: EstadoSaude; healthCheck: string; latenciaMs: number | null;
  ultimoTeste: string | null; erro: string | null; configuracao: string;
}

export interface RelatorioSaude {
  ok: boolean; tools: number; uptime: number; env: string;
  db: { path: string; writable: boolean; note?: string };
  estadoGeral: EstadoSaude;
  resumo: Partial<Record<EstadoSaude, number>>;
  providers: LinhaSaude[];
  nota: string; geradoEm: string; detalhe: boolean; erro: string | null;
}

/* ------------------------------------------------ intelligence engine */
export type ConfiancaInteligencia = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCONFIRMED';

export interface EvidenciaIntel {
  fonte: string; url: string | null; provider: string; timestamp: string; nota: string;
}
export interface FatorIntel { nome: string; peso: number; explica: string }

export interface CorrelacaoIntel {
  tipo: string; valor: string; entidades: string[]; confianca: ConfiancaInteligencia;
  total: number; fatores: FatorIntel[]; evidencias: EvidenciaIntel[]; nota: string;
}
export interface ResolucaoIntel {
  a: string; b: string; confianca: ConfiancaInteligencia; total: number;
  fatores: FatorIntel[]; evidencias: EvidenciaIntel[]; nota: string;
}
export interface ContaIntel { plataforma: string; username: string | null; url: string | null; entidade: string }
export interface IdentificadorIntel { tipo: string; valor: string; entidades: string[] }
export interface EntidadeIntel {
  id: string; rotulo: string; tipo: string; provider: string; plataformas: string[];
  atributos: Record<string, string>; evidencias: EvidenciaIntel[];
}
export interface PerfilUnificado {
  rotulo: string; principal: string; identificadores: IdentificadorIntel[];
  contas: ContaIntel[]; atributos: Record<string, string>;
  correlacoes: CorrelacaoIntel[]; resolucoes: ResolucaoIntel[];
  confiancaGeral: ConfiancaInteligencia; lacunas: string[];
  evidencias: EvidenciaIntel[]; entidades: EntidadeIntel[]; geradoEm: string;
}
export interface PresencaIntel {
  plataforma: string; username: string; url: string | null; entidade: string;
  mesmoIdentificador: boolean; confianca: ConfiancaInteligencia;
}
export interface CruzamentoIntel {
  identificador: string | null; presencas: PresencaIntel[]; totalPlataformas: number;
  iguais: number; confianca: ConfiancaInteligencia; nota: string;
}
export interface RelacaoIntel {
  de: string; para: string; tipo: string; rotulo: string; confianca: ConfiancaInteligencia;
  total: number; evidencias: EvidenciaIntel[]; nota: string;
}
export interface EventoIntel {
  quando: string; tipo: string; descricao: string;
  plataforma?: string; url?: string; entidade?: string;
}
export interface LinhaTempoIntel {
  eventos: EventoIntel[];
  intervalos: { inicio: string; fim: string; decorridoMs: number; dias: number; nota: string }[];
  primeiro: string | null; ultimo: string | null; semData: number; invalidos: number; nota: string;
}
export interface AtividadeIntel {
  total: number; comData: number; semData: number;
  porPlataforma: { plataforma: string; total: number }[];
  porDia: { dia: string; total: number }[];
  porTipo: { tipo: string; total: number }[];
  pico: { dia: string; total: number } | null;
  primeiro: string | null; ultimo: string | null; duracaoDias: number | null; nota: string;
}

export interface AlvoIntel { id: string; titulo: string; alvo: string; tipo?: string; atualizado?: string }

export interface RespostaPerfil {
  investigacao: AlvoIntel;
  perfil: PerfilUnificado;
  cruzamento: CruzamentoIntel;
  correlacoes: CorrelacaoIntel[];
  resolucoes: ResolucaoIntel[];
  relacoes: RelacaoIntel[];
  timeline: LinhaTempoIntel;
  atividade: AtividadeIntel;
  resumo: {
    entidades: number; nos: number; arestas: number; correlacoes: number;
    resolucoes: number; relacoes: number; eventos: number;
  };
}

export type EstadoRadar = 'NEW' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
export interface DetetadoRadar {
  categoria: string; estado: EstadoRadar; valor: string;
  antes: string | null; depois: string | null; nota: string;
}
export interface RespostaRadar {
  investigacao: AlvoIntel;
  radar: {
    temAnterior: boolean; detetados: DetetadoRadar[];
    resumo: { NEW: number; REMOVED: number; CHANGED: number; UNCHANGED: number; alteracoes: number };
    nota: string; comparadoEm: string;
  };
  anterior: { capturadoEm: string } | null;
  atual: { capturadoEm: string };
  nota: string;
}

export type FormatoRelatorio = 'json' | 'csv' | 'html' | 'pdf';

/* ------------------------------------------------- plano de investigação */

/** Os três modos do planeador. O CUSTOM leva a lista de ferramentas escolhidas. */
export type ModoPlano = 'QUICK' | 'FULL' | 'CUSTOM';

/** Estado de uma fase AINDA POR CORRER: pronta, bloqueada ou pendente. */
export type EstadoFasePlano = 'PENDENTE' | 'PRONTO' | 'BLOQUEADA';

/** Estado de uma fase DEPOIS DE CORRER. `CONCLUIDA` exige tudo executado. */
export type EstadoFaseExec = 'CONCLUIDA' | 'PARCIAL' | 'BLOQUEADA' | 'ERRO' | 'PENDENTE';

/**
 * Estado de uma ferramenta na execução. `EXECUTADA` só quando correu de facto;
 * `TRANCADA`/`QUOTA` quando o plano recusou; `NAO_EXECUTADA` quando nem foi
 * chamada (bloqueada no plano, ou custo do Apify por confirmar).
 */
export type EstadoFerramentaExec = 'EXECUTADA' | 'TRANCADA' | 'QUOTA' | 'ERRO' | 'NAO_EXECUTADA' | 'PENDENTE';

export interface FerramentaPlano {
  id: string; rotulo: string; kind: 'ferramenta' | 'etapa';
  estado: EstadoFasePlano; motivo?: string; nota?: string;
  input?: Record<string, string>;
}
export interface FasePlano {
  fase: string; descricao: string; estado: EstadoFasePlano;
  motivo?: string; pulada: boolean; ferramentas: FerramentaPlano[];
}
export interface ResumoPlano {
  fases: number; prontas: number; bloqueadas: number; puladas: number;
  ferramentas: number; catalogo: number; fora: number;
}
export interface Plano {
  modo: ModoPlano; seedType: string; fases: FasePlano[];
  resumo: ResumoPlano; geradoEm: string;
}
export interface RegistoFerramenta {
  id: string; estado: EstadoFerramentaExec; ms: number;
  contagem?: number; erro?: string; nota?: string;
}
export interface RegistoFase {
  fase: string; estado: EstadoFaseExec; pulada: boolean;
  motivo?: string; executadoEm: string | null; ferramentas: RegistoFerramenta[];
}
export interface Progresso {
  modo: ModoPlano; geradoEm: string; atualizadoEm: string; fases: RegistoFase[];
}
export interface ResumoProgresso {
  fases: number; concluidas: number; parciais: number; bloqueadas: number;
  erros: number; pendentes: number; ferramentas: number; executadas: number;
}
export interface PlanoResposta {
  plano: Plano | null; progresso: Progresso | null; resumo?: ResumoProgresso | null;
}
export interface ExecutarResposta {
  plano: Plano; progresso: Progresso; resumo: ResumoProgresso;
  /** Falha inesperada do servidor: o progresso gravado continua a ser verdade. */
  erro?: string;
}

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

/**
 * Saúde do sistema.
 *
 * É o único pedido que NÃO trata 4xx/5xx como erro: quando o servidor
 * responde 503 é porque a base de dados não tem escrita ou a verificação de
 * dependências falhou — exactamente o relatório que este ecrã existe para
 * mostrar. O corpo vem na íntegra e o estado HTTP fica à vista, para a
 * interface dizer as duas coisas em vez de assegurar uma coisa e esconder a
 * outra.
 */
export async function pedidoSaude(detalhe: boolean): Promise<{
  relatorio: RelatorioSaude; http: number; aviso: string | null;
}> {
  let r: Response;
  try {
    r = await fetch(`/api/health${detalhe ? '?detalhe=sim' : ''}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'sem_rede', 'Sem ligação ao servidor. Verifique a rede.');
  }
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!data || typeof data !== 'object' || !('estadoGeral' in (data as Record<string, unknown>))) {
    throw new ApiError(r.status, `http_${r.status}`,
      `O servidor não devolveu um relatório de saúde legível (HTTP ${r.status}).`);
  }
  return {
    relatorio: data as RelatorioSaude,
    http: r.status,
    aviso: r.ok
      ? null
      : `O servidor respondeu HTTP ${r.status}. O relatório abaixo é o que ele conseguiu calcular — não é uma afirmação de que está tudo bem.`,
  };
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

  /** Plano e progresso actuais da investigação. `plano: null` = ainda não há. */
  plano: (id: string) =>
    req<PlanoResposta>(`/api/investigations/${encodeURIComponent(id)}/plan`),
  /** Gera o plano (QUICK, FULL ou CUSTOM com a lista escolhida) e reinicia o progresso. */
  gerarPlano: (id: string, corpo: { modo: ModoPlano; ferramentas?: string[] }) =>
    req<PlanoResposta>(`/api/investigations/${encodeURIComponent(id)}/plan`, {
      method: 'POST', body: JSON.stringify(corpo),
    }),
  /** Executa o plano passo a passo e devolve o progresso já gravado. */
  executarPlano: (id: string, corpo: { confirmarCusto?: boolean; reexecutar?: boolean }) =>
    req<ExecutarResposta>(`/api/investigations/${encodeURIComponent(id)}/plan/executar`, {
      method: 'POST', body: JSON.stringify(corpo),
    }),

  history: () => req<{ runs: { id: string; tool_id: string; input: string; created_at: string; bytes: number }[] }>('/api/historico'),
  historyItem: (id: string) => req<{ run: ToolRun; at: string; input: Record<string, string> }>(`/api/historico/${encodeURIComponent(id)}`),

  /** Saúde do sistema. `detalhe` acrescenta versões, latência e serviço externo. */
  saude: (detalhe: boolean) => pedidoSaude(detalhe),
  /** Presence Radar: compara com o snapshot anterior (pode não existir). */
  radar: (investigacao: string) =>
    req<RespostaRadar>(`/api/intel/radar?investigacao=${encodeURIComponent(investigacao)}`),
  /** Unified Profile: correlações, resoluções, timeline e atividade. */
  perfil: (investigacao: string) =>
    req<RespostaPerfil>(`/api/intel/perfil?investigacao=${encodeURIComponent(investigacao)}`),
  /**
   * Link direto do relatório. O servidor devolve `Content-Disposition:
   * attachment`, por isso o browser guarda o ficheiro com o mesmo conteúdo
   * nos quatro formatos — não é uma exportação reconstruída no cliente.
   */
  relatorioUrl: (investigacao: string, formato: FormatoRelatorio) =>
    `/api/intel/relatorio?investigacao=${encodeURIComponent(investigacao)}&formato=${formato}`,

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
    `Olá! Quero ativar o plano ${plan.name} (${preco}) no ARGOS.`,
    user?.name ? `Nome: ${user.name}` : '',
    user?.email ? `Conta no ARGOS: ${user.email}` : '',
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

/** O que se mostra ao utilizador para cada estado do plano e da execução. */
export const ROTULO_MODO: Record<ModoPlano, string> = { QUICK: 'QUICK', FULL: 'FULL', CUSTOM: 'CUSTOM' };
export const ROTULO_FASE: Record<EstadoFasePlano | EstadoFaseExec, string> = {
  PENDENTE: 'pendente', PRONTO: 'pronta', BLOQUEADA: 'bloqueada',
  CONCLUIDA: 'concluída', PARCIAL: 'parcial', ERRO: 'erro',
};
export const ROTULO_FERRAMENTA: Record<EstadoFerramentaExec, string> = {
  EXECUTADA: 'executada', TRANCADA: 'trancada', QUOTA: 'quota esgotada', ERRO: 'erro',
  NAO_EXECUTADA: 'não executada', PENDENTE: 'pendente',
};
/** Classes de cor para cada estado — sem verde inventado onde não há sucesso. */
export const CLASSE_FASE: Record<EstadoFasePlano | EstadoFaseExec, string> = {
  PENDENTE: 'tag', PRONTO: 'tag-ok', BLOQUEADA: 'tag-warn',
  CONCLUIDA: 'tag-ok', PARCIAL: 'tag-warn', ERRO: 'tag-err',
};
export const CLASSE_FERRAMENTA: Record<EstadoFerramentaExec, string> = {
  EXECUTADA: 'st st-ok', TRANCADA: 'st st-skipped', QUOTA: 'st st-needs_key',
  ERRO: 'st st-error', NAO_EXECUTADA: 'st st-skipped', PENDENTE: 'st st-empty',
};

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
