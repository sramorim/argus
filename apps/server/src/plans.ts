/** Planos, limites e cadeados. Precos em BRL. */
export type PlanId = 'free' | 'pro' | 'pro_max';
export type LockState = 'open' | 'locked';

export interface Plan {
  id: PlanId;
  name: string;
  priceBRL: number;
  pricePeriod: 'mensal' | 'anual';
  dailyRuns: number;
  burstRuns: number;
  maxItems: number;
  graphHops: number;
  investigations: number;
  concurrent: number;
  highlight: string;
  perks: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceBRL: 0,
    pricePeriod: 'mensal',
    dailyRuns: 15,
    burstRuns: 3,
    maxItems: 25,
    graphHops: 1,
    investigations: 3,
    concurrent: 1,
    highlight: 'Sem cartao, sem trial que expira.',
    perks: [
      '15 execucoes por dia',
      '3 execucoes seguidas (burst)',
      '25 itens por resultado',
      'Grafo com 1 salto',
      '3 investigacoes guardadas',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceBRL: 39.9,
    pricePeriod: 'mensal',
    dailyRuns: 300,
    burstRuns: 8,
    maxItems: 500,
    graphHops: 3,
    investigations: 50,
    concurrent: 3,
    highlight: 'Para quem investiga a serio.',
    perks: [
      '300 execucoes por dia',
      '8 execucoes seguidas (burst)',
      '500 itens por resultado',
      'Grafo com 3 saltos',
      '50 investigacoes guardadas',
      '3 execucoes em paralelo',
    ],
  },
  pro_max: {
    id: 'pro_max',
    name: 'Pro Max',
    priceBRL: 79.9,
    pricePeriod: 'mensal',
    dailyRuns: 1500,
    burstRuns: 20,
    maxItems: 2000,
    graphHops: 5,
    investigations: 500,
    concurrent: 6,
    highlight: 'Volume alto e saltos profundos.',
    perks: [
      '1.500 execucoes por dia',
      '20 execucoes seguidas (burst)',
      '2.000 itens por resultado',
      'Grafo com 5 saltos',
      '500 investigacoes guardadas',
      '6 execucoes em paralelo',
    ],
  },
};

export const PLAN_LIST = [PLANS.free, PLANS.pro, PLANS.pro_max];

/** Qual plano e o minimo para usar uma ferramenta. */
export type MinPlan = 'free' | 'pro' | 'pro_max';

export function planRank(p: PlanId): number {
  return p === 'free' ? 0 : p === 'pro' ? 1 : 2;
}
export function isPlanId(v: string): v is PlanId {
  return v === 'free' || v === 'pro' || v === 'pro_max';
}
export function meetsPlan(userPlan: PlanId, min: MinPlan): boolean {
  return planRank(userPlan) >= planRank(min);
}

export interface LockedTool {
  id: string;
  minPlan: MinPlan;
  reason?: string;
}

/**
 * Trancas de plano. O bloqueio é por CAPACIDADE, nunca por "fazer a app parecer
 * mais premium": o que custa recursos partilhados (blocklists, pesquisa web,
 * scraping, quotas de terceiros) é Pro; o que é cálculo local ou uma única
 * chamada leve é Free.
 *
 * Um bloco importante: `leak-check` saiu daqui. A ferramenta foi removida por
 * não entregar nada sem chave (ver o comentário em tools/identity.ts).
 */
export const TOOL_LOCKS: Record<string, LockedTool['minPlan']> = {
  // Free — fontes leves, sem custo para terceiros, ou cálculo local
  'graph-investigation': 'free',
  'username-finder': 'free',
  'email-analyzer': 'free',
  'domain-analyzer': 'free',
  'ip-analyzer': 'free',
  'url-scanner': 'free',
  'web-crawler': 'free',
  'hash-analyzer': 'free',
  'dorks-generator': 'free',
  'crypto-tracer': 'free',
  'github-osint': 'free',
  'metadata-extractor': 'free',
  'cve-lookup': 'free',
  'package-audit': 'free',
  'asn-lookup': 'free',
  'company-br': 'free',
  'zipcode-br': 'free',
  'password-check': 'free',
  'phone-analyzer': 'free',
  'geo-lookup': 'free',
  'tls-audit': 'free',        // 1 handshake ao alvo, sem API de terceiros

  // Pro — blocklists grandes, pesquisa web, scraping, quotas de terceiros
  'port-scanner': 'pro',      // quota do Shodan InternetDB
  'reputation-check': 'pro',   // 4 feeds de blocklist (centenas de mil de IOCs)
  'telegram-osint': 'pro',     // scraping público, com política de 1 pedido/utilizador
  'paste-search': 'pro',       // pesquisa web real (Bing RSS)
  'reverse-image': 'pro',      // descarrega e descodifica imagens
};
