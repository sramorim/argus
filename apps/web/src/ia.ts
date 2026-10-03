/**
 * Arquitetura de informação do ARGOS.
 *
 * Um único lugar decide **que ferramentas existem, a que grupo pertencem e por
 * que ordem aparecem**. A sidebar, o dashboard, a busca e os atalhos leem
 * tudo daqui — assim é impossível a navegação e o catálogo discordarem, que foi
 * sempre a fonte de "a ferramenta está no site mas não aparece no menu".
 *
 * Regra do projeto: **só entra o que existe e funciona.** Nada é listado por
 * parecer completo. Os grupos abaixo contêm as 8 ferramentas registadas no
 * servidor (Social Intelligence), e nenhuma outra — o catálogo real vem da API
 * e o teste `test/ui.test.mts` falha se um grupo prometer uma ferramenta que
 * não existe.
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
    resumo: 'Descobre quem está por trás de um username e o que os registos públicos dizem dele.',
    icon: Icon.user,
    ferramentas: ['username-finder', 'username-intel'],
  },
  {
    id: 'social',
    nome: 'Redes e Comunicação',
    resumo: 'Perfis e presença pública: busca por nome nas redes e a Cache API da DataLikers (Instagram, TikTok).',
    icon: Icon.globe,
    // Duas portas diferentes para o mesmo sítio: o `social-search` varre o
    // índice do motor de busca por perfis públicos, e o `datalikers` consulta
    // a Cache API oficial da DataLikers — perfil, publicações, seguidores,
    // comentários e hashtags. Ambas exigem chave no backend para responder.
    ferramentas: ['social-search', 'datalikers'],
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
    id: 'exposicao',
    nome: 'Exposição',
    resumo: 'O que está publicado à vista: pastes, segredos e menções públicas do alvo.',
    icon: Icon.shield,
    ferramentas: ['paste-search'],
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
  { id: 'social-search', nome: 'Perfis que mencionam um nome', exemplo: 'Albert Einstein', icon: Icon.globe },
  { id: 'datalikers', nome: 'Perfil de Instagram/TikTok', exemplo: 'natgeo', icon: Icon.layers },
  { id: 'paste-search', nome: 'Exposição pública', exemplo: 'example.com', icon: Icon.shield },
];

/** Rótulo do plano, para mostrar o estado real sem inventar. */
export const NOME_PLANO: Record<PlanId, string> = { free: 'Free', pro: 'Pro', pro_max: 'Pro Max' };
