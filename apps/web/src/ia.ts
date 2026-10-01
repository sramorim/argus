/**
 * Arquitetura de informação do ARGOS.
 *
 * Um único lugar decide **que ferramentas existem, a que grupo pertencem e por
 * que ordem aparecem**. A sidebar, o dashboard, a busca e os atalhos leem
 * tudo daqui — assim é impossível a navegação e o catálogo discordarem, que foi
 * sempre a fonte de "a ferramenta está no site mas não aparece no menu".
 *
 * Regra do projeto: **só entra o que existe e funciona.** Nada é listado por
 * parecer completo. Os grupos abaixo contêm as 32 ferramentas registadas e testadas
 * com alvos reais (`npm run test:audit`, 32/32), e nenhuma outra.
 */
import { Icon } from './components/Icons';
import type { PlanId, ToolPublic } from './api';
import type { ReactElement } from 'react';
import type { SVGProps } from 'react';

/** Um grupo de trabalho ("camada") da navegação. */
export interface Grupo {
  id: string;
  nome: string;
  resumo: string;
  icon: (p: SVGProps<SVGSVGElement>) => ReactElement;
  /** Ferramentas deste grupo, pela ordem em que aparecem no menu. */
  ferramentas: string[];
}

/**
 * Os grupos, pela ordem em que aparecem.
 *
 * A ordem responde à pergunta "o que é que estou a tentar fazer agora?", não a
 * uma taxonomia de tweaked: primeiro investigar, depois perceber quem é a pessoa,
 * depois onde está na web, depois a infraestrutura, depois a segurança.
 */
export const GRUPOS: Grupo[] = [
  {
    id: 'investigar',
    nome: 'Investigação',
    resumo: 'Correlaciona todas as ferramentas sobre um alvo e monta o grafo.',
    icon: Icon.network,
    ferramentas: ['graph-investigation'],
  },
  {
    id: 'identidade',
    nome: 'Identidade',
    resumo: 'Descobre quem está por trás de um username, e-mail ou telefone.',
    icon: Icon.user,
    ferramentas: ['username-finder', 'username-intel', 'email-analyzer', 'phone-analyzer', 'dorks-generator'],
  },
  {
    id: 'social',
    nome: 'Redes e Comunicação',
    resumo: 'Perfis públicos em plataformas onde a pessoa se identifica.',
    icon: Icon.globe,
    // Só entram ferramentas que leem dados públicos de uma rede. Não se lista
    // Instagram/TikTok/X/Reddit/YouTube como ferramentas próprias porque não há
    // nenhuma por trás — o `social-search` é que consulta o índice do motor de
    // busca por essas redes, e o `username-finder` sonda quais respondem.
    ferramentas: ['github-osint', 'telegram-osint', 'bluesky-osint', 'mastodon-osint', 'social-search'],
  },
  {
    id: 'osint',
    nome: 'OSINT Engine',
    resumo: 'Ferramentas externas (SpiderFoot, Photon, OpenOSINT, GHunt, Holehe) corridas isoladas.',
    icon: Icon.code,
    // Cada uma destas corre num processo próprio, sem shell e com env mínima.
    // Se não estiverem instaladas, reportam NOT_INSTALLED — o grupo mostra o
    // estado real das dependências, nunca um resultado simulado.
    ferramentas: ['osint-engine'],
  },
  {
    id: 'apify',
    nome: 'APIFY',
    resumo: 'Actors pagos do Apify (Instagram, TikTok, Facebook, X) com chave só no backend.',
    icon: Icon.link,
    // Engine separada do núcleo: sem APIFY_API_TOKEN devolve NOT_CONFIGURED e
    // não gasta nada; correr um actor custa dinheiro, por isso pede confirmação.
    ferramentas: ['apify'],
  },
  {
    id: 'web',
    nome: 'Web e Ficheiros',
    resumo: 'O que está publicado num endereço: páginas, headers, imagens.',
    icon: Icon.file,
    ferramentas: ['url-scanner', 'web-crawler', 'metadata-extractor', 'reverse-image'],
  },
  {
    id: 'infra',
    nome: 'Domínio e Infraestrutura',
    resumo: 'Domínio, IP, certificado e portas expostas de um alvo.',
    icon: Icon.server,
    ferramentas: ['domain-analyzer', 'ip-analyzer', 'tls-audit', 'port-scanner', 'asn-lookup'],
  },
  {
    id: 'seguranca',
    nome: 'Segurança',
    resumo: 'Reputação, hashes expostos, vulnerabilidades e dependências.',
    icon: Icon.shield,
    ferramentas: ['reputation-check', 'hash-analyzer', 'cve-lookup', 'package-audit', 'password-check', 'paste-search'],
  },
  {
    id: 'fontes',
    nome: 'Fontes Especiais',
    resumo: 'Cadeias de blocos, geolocalização e registos públicos do Brasil.',
    icon: Icon.coins,
    ferramentas: ['crypto-tracer', 'geo-lookup', 'zipcode-br', 'company-br'],
  },
];

/**
 * Ferramentas que a app oferece como *vista*, não como ferramenta do catálogo.
 *
 * Não são grupos de ferramentas: são ecrãs próprios da aplicação (estado do
 * sistema, observação de presença, perfil unificado e definições) com
 * navegação própria, pelo mesmo mecanismo de sempre — ícone na área de
 * trabalho, item na gaveta e janela.
 */
export const VISTAS = [
  { id: 'dashboard', nome: 'Painel', icon: Icon.grid },
  { id: 'nova', nome: 'Nova investigação', icon: Icon.target },
  { id: 'inv', nome: 'Investigações', icon: Icon.network },
  { id: 'history', nome: 'Histórico', icon: Icon.history },
  { id: 'health', nome: 'System Health', icon: Icon.activity },
  { id: 'radar', nome: 'Presence Radar', icon: Icon.eye },
  { id: 'perfil', nome: 'Unified Profile', icon: Icon.layers },
  { id: 'plans', nome: 'Planos', icon: Icon.crown },
  { id: 'keys', nome: 'Chaves API', icon: Icon.key },
  { id: 'account', nome: 'Conta', icon: Icon.user },
  { id: 'definicoes', nome: 'Definições', icon: Icon.settings },
  { id: 'admin', nome: 'Administração', icon: Icon.shield },
] as const;

/** Todas as ferramentas declaradas na IA, por ordem, sem repetições. */
export const TODAS_AS_FERRAMENTAS = GRUPOS.flatMap((g) => g.ferramentas);

/**
 * Onde está cada ferramenta. Reconstroído a partir da lista, para a organização
 * nunca poder divergir dos grupos.
 */
export const FERRAMENTA_POR_ID: Record<string, { grupo: Grupo; posicao: number }> = (() => {
  const out: Record<string, { grupo: Grupo; posicao: number }> = {};
  GRUPOS.forEach((g) => g.ferramentas.forEach((id, i) => { out[id] = { grupo: g, posicao: i }; }));
  return out;
})();

/** As ferramentas que o utilizador não vê, resolvidas a partir do catálogo real. */
export function porGrupo(ferramentas: ToolPublic[], grupoId: string): ToolPublic[] {
  const g = GRUPOS.find((x) => x.id === grupoId);
  if (!g) return [];
  const porId = new Map(ferramentas.map((t) => [t.id, t]));
  return g.ferramentas.map((id) => porId.get(id)).filter((t): t is ToolPublic => !!t);
}

/**
 * Procura em nome, resumo, etiquetas e grupo. Serve para a busca do painel e
 * para o `Ctrl/Cmd+K`.
 */
export function buscar(ferramentas: ToolPublic[], termo: string): ToolPublic[] {
  const n = termo.trim().toLowerCase();
  if (!n) return ferramentas;
  return ferramentas.filter((t) => {
    const g = GRUPOS.find((x) => x.ferramentas.includes(t.id));
    return (
      t.name.toLowerCase().includes(n) ||
      t.summary.toLowerCase().includes(n) ||
      t.tags.some((tag) => tag.toLowerCase().includes(n)) ||
      (g?.nome ?? '').toLowerCase().includes(n) ||
      (g?.resumo ?? '').toLowerCase().includes(n)
    );
  });
}

/** Sugestões de atalho para o painel, por ordem de utilidade. */
export const ATALHOS: { id: string; nome: string; exemplo: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement }[] = [
  { id: 'graph-investigation', nome: 'Investigação completa', exemplo: 'github.com', icon: Icon.network },
  { id: 'username-finder', nome: 'Localizar username', exemplo: 'torvalds', icon: Icon.user },
  { id: 'domain-analyzer', nome: 'Analisar domínio', exemplo: 'github.com', icon: Icon.globe },
  { id: 'ip-analyzer', nome: 'Analisar IP', exemplo: '1.1.1.1', icon: Icon.server },
  { id: 'email-analyzer', nome: 'Analisar e-mail', exemplo: 'alguem@exemplo.com', icon: Icon.mail },
  { id: 'phone-analyzer', nome: 'Analisar telefone', exemplo: '+5511998877665', icon: Icon.phone },
];

/** Rótulo do plano, para mostrar o estado real sem inventar. */
export const NOME_PLANO: Record<PlanId, string> = { free: 'Free', pro: 'Pro', pro_max: 'Pro Max' };
