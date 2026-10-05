/**
 * Plano de investigação — o planeador (FASE F).
 *
 * Ficheiro **puro**: não abre base de dados, não faz rede, não lê ficheiros e
 * não toca em `process.env`. Tudo o que precisa chega como entrada — `Factos` e
 * `catalogo` —, recolhido por quem tem de o recolher. É isso que permite testar
 * o estado sem token, sem CLI, plano Free ou sem nós sem primeiro o criar.
 *
 * O que o planeador decide, e só isto:
 *
 *   1. Que das 8 fases entram no modo (QUICK mostra o que ficou de fora, não
 *      esconde);
 *   2. Que ferramentas do catálogo se aplicam ao tipo de alvo desta
 *      investigação — as que não se aplicam ficam de fora com contagem, não
 *      fingem que vão correr;
 *   3. Para cada ferramenta que entra: `PRONTO` ou `BLOQUEADA` com um motivo
 *      concreto (plano, CLI, token), nunca um "indisponível" vago;
 *   4. O input com que cada ferramenta correria, derivado do alvo — para o
 *      utilizador ver exactamente o que ia ser executado.
 *
 * O que NÃO decide: nada é executado aqui. A execução é de `exec.ts`, e é ela
 * que grava o que correu.
 */
import { PLANS, TOOL_LOCKS, meetsPlan, type PlanId, type MinPlan } from '../plans.ts';

// ---------------------------------------------------------------- tipos

export type Modo = 'QUICK' | 'FULL' | 'CUSTOM';
export const MODOS: readonly Modo[] = ['QUICK', 'FULL', 'CUSTOM'] as const;

export type FaseNome =
  | 'Discovery' | 'OSINT' | 'Social' | 'Apify'
  | 'Normalization' | 'Correlation' | 'Intelligence' | 'Snapshots';

export const FASES: readonly FaseNome[] = [
  'Discovery', 'OSINT', 'Social', 'Apify',
  'Normalization', 'Correlation', 'Intelligence', 'Snapshots',
] as const;

export type EstadoFase = 'PENDENTE' | 'PRONTO' | 'BLOQUEADA';
export type EstadoFerramenta = 'PRONTO' | 'BLOQUEADA';

export interface ItemCatalogo {
  id: string;
  nome: string;
  minPlan: MinPlan;
}

/** O que só se sabe ao vivo e por isso vem de fora: instalação, chave, nós. */
export interface Factos {
  plano: PlanId;
  seed: string;
  seedType: string;
  nos: number;
  /**
   * Binários de terceiros. Cada entrada traz o motivo escrito por quem verificou
   * (falta a variável, o CLI não está no PATH…) — o planeador não adivinha.
   */
  clis: {
    ferramenta: 'osint-engine' | 'username-intel';
    id: string;
    rotulo: string;
    tipos: string[];
    ok: boolean;
    motivo: string;
  }[];
  apifyToken: boolean;
  /**
   * `DATALIKERS_API_KEY` está no ambiente do servidor. Opcional de propósito:
   * quem monta factos sem este campo (testes, scripts) não pode afirmar por
   * engano que a chave existe — `undefined` conta como ausente.
   */
  datalikersChave?: boolean;
}

export interface FerramentaPlano {
  id: string;
  rotulo: string;
  kind: 'ferramenta' | 'etapa';
  estado: EstadoFerramenta;
  motivo?: string;
  nota?: string;
  input?: Record<string, string>;
}

export interface FasePlano {
  fase: FaseNome;
  descricao: string;
  estado: EstadoFase;
  motivo?: string;
  pulada: boolean;
  ferramentas: FerramentaPlano[];
}

export interface ResumoPlano {
  fases: number;
  prontas: number;
  bloqueadas: number;
  puladas: number;
  ferramentas: number;
  catalogo: number;
  fora: number;
}

export interface Plano {
  modo: Modo;
  seedType: string;
  fases: FasePlano[];
  resumo: ResumoPlano;
  geradoEm: string;
}

// --------------------------------------------------------------- progresso

export type EstadoFerramentaExec =
  | 'EXECUTADA' | 'TRANCADA' | 'QUOTA' | 'ERRO' | 'NAO_EXECUTADA' | 'PENDENTE';

export type EstadoFaseExec = 'CONCLUIDA' | 'PARCIAL' | 'BLOQUEADA' | 'ERRO' | 'PENDENTE';

export interface RegistoFerramenta {
  id: string;
  estado: EstadoFerramentaExec;
  ms: number;
  contagem?: number;
  erro?: string;
  nota?: string;
}

export interface RegistoFase {
  fase: FaseNome;
  estado: EstadoFaseExec;
  pulada: boolean;
  motivo?: string;
  executadoEm: string | null;
  ferramentas: RegistoFerramenta[];
}

export interface Progresso {
  modo: Modo;
  geradoEm: string;
  atualizadoEm: string;
  fases: RegistoFase[];
}

// ------------------------------------------------- etapas do motor de intel

/**
 * As fases 5–8 não têm ferramenta do catálogo: são etapas do Intelligence
 * Engine, calculadas pelo próprio servidor sobre os nós da investigação. Não
 * passam pelo `executeTool()` porque não são ferramentas de terceiros (não há
 * quota nem tranca a respeitar), mas a execução é real — código real sobre
 * dados reais, com contagem a contar o que saiu.
 */
export const ETAPAS: Record<string, { fase: FaseNome; rotulo: string }> = {
  'intel-normalizacao': { fase: 'Normalization', rotulo: 'Normalização das entidades' },
  'intel-correlacao': { fase: 'Correlation', rotulo: 'Correlações e relações' },
  'intel-perfil': { fase: 'Intelligence', rotulo: 'Perfil unificado' },
  'intel-snapshot': { fase: 'Snapshots', rotulo: 'Snapshot de presença' },
};
export const IDS_ETAPAS = Object.keys(ETAPAS);

/**
 * Ferramentas que ficaram de fora das 8 fases, com a fase onde cairiam se
 * pudessem correr aqui e por que é que não podem. Dizer "cai na fase X mas não
 * recebe o alvo" é mais honesto do que um 400 genérico.
 */
export const FORA_DO_PLANO: Record<string, { fase: FaseNome; motivo: string }> = {
  'graph-investigation': {
    fase: 'Discovery',
    motivo: 'cria a própria investigação — corra-a pelo catálogo, não por cima de uma já existente',
  },
};

const DESCRICOES: Record<FaseNome, string> = {
  Discovery: 'O que o próprio alvo revela: análise direta do alvo, sem chave nem serviço pago.',
  OSINT: 'Motores externos e registos de usernames — exige os CLIs instalados ou a pesquisa coberta pelo plano.',
  Social: 'Redes sociais: busca pública por nome e a Cache API da DataLikers (Instagram e TikTok), que exige DATALIKERS_API_KEY.',
  Apify: 'Actors do Apify, pagos por evento: exigem APIFY_API_TOKEN e a confirmação do custo antes de correr.',
  Normalization: 'Converte os nós do grafo em entidades canónicas e funde as que são a mesma coisa.',
  Correlation: 'Cruza as entidades: correlações, indicadores partilhados e relações derivadas.',
  Intelligence: 'Perfil unificado e cruzamento entre plataformas, sempre com a faixa de confiança.',
  Snapshots: 'Captura e guarda a presença atual para as próximas comparações do radar.',
};

// ------------------------------------------------------------- definições

interface DefFerramenta {
  id: string;
  tipos: readonly string[];
  input: (seed: string) => Record<string, string>;
  /** Entra no QUICK — o mínimo que corre sempre e é rápido. */
  quik?: boolean;
}

/**
 * As 8 fases e o que cada uma executa de facto.
 *
 * Os tipos são os do `detectSeedType` (é assim que a investigação guarda o
 * alvo). Uma ferramenta que não recebe este tipo de alvo não entra no plano —
 * em vez de aparecer como "vai correr" e depois falhar sem explicação.
 */
const POR_FASE: Record<FaseNome, DefFerramenta[]> = {
  Discovery: [
    { id: 'username-finder', tipos: ['username'], input: (s) => ({ username: s }), quik: true },
    { id: 'domain-infra', tipos: ['dominio'], input: (s) => ({ domain: s }), quik: true },
  ],
  OSINT: [
    { id: 'osint-engine', tipos: ['username', 'email', 'dominio', 'ip'], input: (s) => ({ alvo: s }) },
    { id: 'username-intel', tipos: ['username'], input: (s) => ({ username: s }) },
    { id: 'paste-search', tipos: ['username', 'email', 'dominio', 'ip', 'telefone'], input: (s) => ({ term: s, exec: 'sim' }) },
  ],
  Social: [
    { id: 'social-search', tipos: ['username', 'dominio', 'email'], input: (s) => ({ name: s }) },
    { id: 'datalikers', tipos: ['username'], input: (s) => ({ plataforma: 'instagram', recurso: 'perfil', alvo: s }) },
  ],
  Apify: [
    { id: 'apify', tipos: ['username', 'servico'], input: (s) => ({ alvo: s }) },
  ],
  Normalization: [],
  Correlation: [],
  Intelligence: [],
  Snapshots: [],
};

const TIPO_OINT: Record<string, string> = {
  username: 'username', email: 'email', dominio: 'dominio', ip: 'ip',
};

// ------------------------------------------------------------- validação

export interface ErroValidacao {
  erro: 'modo_invalido' | 'custom_vazio' | 'ferramenta_desconhecida' | 'ferramenta_fora_do_plano';
  msg: string;
  id?: string;
  fase?: FaseNome;
  aceites?: string[];
}

export function ehModo(v: string): v is Modo {
  return (MODOS as readonly string[]).includes(v);
}

function idsQueExistem(catalogo: ItemCatalogo[]): string[] {
  const naFase = new Set<string>();
  for (const defs of Object.values(POR_FASE)) for (const d of defs) naFase.add(d.id);
  const conhecidos = catalogo.filter((c) => naFase.has(c.id)).map((c) => c.id);
  return [...conhecidos, ...IDS_ETAPAS];
}

/** Onde cairia uma ferramenta que existe mas não faz parte do plano. */
export function faseSugerida(id: string): { fase: FaseNome; motivo: string } | null {
  return FORA_DO_PLANO[id] ?? null;
}

/** Fase a que uma ferramenta do plano (ou uma etapa) pertence. */
export function faseDe(id: string): FaseNome | null {
  for (const [fase, defs] of Object.entries(POR_FASE)) {
    if (defs.some((d) => d.id === id)) return fase as FaseNome;
  }
  return ETAPAS[id]?.fase ?? null;
}

/**
 * Valida as escolhas ANTES de montar o plano. Devolve o erro que a rota torna
 * num 400, ou `null` quando se pode seguir.
 */
export function validarEscolhas(modo: string, ids: string[] | undefined, catalogo: ItemCatalogo[]): ErroValidacao | null {
  if (!ehModo(modo)) {
    return {
      erro: 'modo_invalido',
      msg: `Modo desconhecido "${modo}". Aceites: ${MODOS.join(', ')}.`,
      aceites: [...MODOS],
    };
  }
  if (modo !== 'CUSTOM') return null;
  if (!ids || !ids.length) {
    return { erro: 'custom_vazio', msg: 'O modo CUSTOM precisa da lista de ferramentas em `ferramentas`.' };
  }
  const conhecidos = new Set(idsQueExistem(catalogo));
  for (const id of ids) {
    if (!conhecidos.has(id)) {
      if (faseSugerida(id)) {
        const s = faseSugerida(id)!;
        return {
          erro: 'ferramenta_fora_do_plano',
          id,
          fase: s.fase,
          msg: `"${id}" não faz parte das 8 fases — cairia na fase ${s.fase}, mas ${s.motivo}.`,
        };
      }
      return {
        erro: 'ferramenta_desconhecida',
        id,
        msg: `Ferramenta desconhecida "${id}".`,
        aceites: [...conhecidos].sort(),
      };
    }
  }
  return null;
}

// ------------------------------------------------------------- montagem

function nomePlano(p: PlanId): string {
  return PLANS[p]?.name ?? String(p);
}

/** Motivo de tranca, no formato que o spec pede: diz o plano e o que falta. */
function motivoTranca(id: string, f: Factos, cat: ItemCatalogo | undefined): string | null {
  const min = (TOOL_LOCKS[id] ?? cat?.minPlan ?? 'free') as MinPlan;
  if (meetsPlan(f.plano, min)) return null;
  return `plano ${nomePlano(f.plano).toLowerCase()} não inclui esta ferramenta — exige ${nomePlano(min)}`;
}

/** O que os binários de terceiros permitem (ou não) para este alvo. */
function dependencia(id: string, f: Factos): { ok: boolean; motivo?: string; nota?: string } {
  const tipo = TIPO_OINT[f.seedType];

  if (id === 'osint-engine') {
    const verificados = f.clis.filter((c) => c.ferramenta === 'osint-engine');
    if (!verificados.length) return { ok: false, motivo: 'verificação dos CLIs do OSINT Engine em falta' };
    const aplicaveis = verificados.filter((c) => c.tipos.includes(tipo ?? ''));
    const prontos = aplicaveis.filter((c) => c.ok);
    const emFalta = aplicaveis.filter((c) => !c.ok);
    if (!aplicaveis.length) return { ok: false, motivo: `nenhum dos CLIs do OSINT Engine aceita alvos do tipo "${f.seedType}"` };
    if (!prontos.length) {
      return { ok: false, motivo: emFalta.slice(0, 3).map((c) => c.motivo).join(' · ') };
    }
    return {
      ok: true,
      nota: emFalta.length
        ? `${prontos.length} de ${aplicaveis.length} prontos · falta: ${emFalta.slice(0, 2).map((c) => c.motivo).join(', ')}`
        : `${prontos.length} providers prontos`,
    };
  }

  if (id === 'username-intel') {
    const clis = f.clis.filter((c) => c.ferramenta === 'username-intel');
    // Sem verificação não se afirma que os registos estão cá: dizer "pronto"
    // a partir do nada é exactamente o fabrico que este plano proíbe.
    if (!clis.length) return { ok: false, motivo: 'verificação dos registos do Username Intel em falta' };
    const emFalta = clis.filter((c) => !c.ok);
    return {
      ok: true,
      nota: emFalta.length
        ? `${clis.length - emFalta.length} de ${clis.length} registos locais · falta: ${emFalta[0]!.motivo}`
        : `${clis.length} registos disponíveis`,
    };
  }

  if (id === 'apify') {
    if (!f.apifyToken) return { ok: false, motivo: '`APIFY_API_TOKEN` em falta' };
    return { ok: true, nota: 'actors pay-per-event: na execução é pedida a confirmação do custo' };
  }

  if (id === 'datalikers') {
    if (!f.datalikersChave) return { ok: false, motivo: '`DATALIKERS_API_KEY` em falta' };
    return { ok: true, nota: 'Cache API: um pedido por recurso, com o saldo da conta a descontar' };
  }

  return { ok: true };
}

function ferramentaOuBloqueada(
  def: DefFerramenta, cat: ItemCatalogo | undefined, f: Factos, modo: Modo,
): FerramentaPlano {
  const rotulo = cat?.nome ?? def.id;
  const tranca = motivoTranca(def.id, f, cat);
  if (tranca) return { id: def.id, rotulo, kind: 'ferramenta', estado: 'BLOQUEADA', motivo: tranca };

  const dep = dependencia(def.id, f);
  if (!dep.ok) return { id: def.id, rotulo, kind: 'ferramenta', estado: 'BLOQUEADA', motivo: dep.motivo };

  const input = def.input(f.seed);
  if (def.id === 'username-intel') input.modo = modo;
  return {
    id: def.id, rotulo, kind: 'ferramenta', estado: 'PRONTO', nota: dep.nota, input,
  };
}

function etapaDaFase(fase: FaseNome, f: Factos): FerramentaPlano | null {
  const id = Object.keys(ETAPAS).find((k) => ETAPAS[k]!.fase === fase);
  if (!id) return null;
  const rotulo = ETAPAS[id]!.rotulo;
  if (f.nos <= 0) {
    return {
      id, rotulo, kind: 'etapa', estado: 'BLOQUEADA',
      motivo: 'esta investigação ainda não tem nós: nada para calcular',
    };
  }
  return { id, rotulo, kind: 'etapa', estado: 'PRONTO', nota: `${f.nos} nós no grafo` };
}

export interface EntradaPlano {
  modo: string;
  ferramentas?: string[];
  catalogo: ItemCatalogo[];
  factos: Factos;
  agora: string;
}

/**
 * Monta o plano. Lança só se as escolhas forem inválidas — quem chama valida
 * primeiro com `validarEscolhas` e transforma o erro em 400.
 */
export function montarPlano(entrada: EntradaPlano): Plano {
  const modo = entrada.modo as Modo;
  const { catalogo, factos, agora } = entrada;
  const cat = new Map(catalogo.map((c) => [c.id, c]));
  const escolhidas = modo === 'CUSTOM' ? new Set(entrada.ferramentas ?? []) : null;

  const fases: FasePlano[] = [];
  let ferramentasTotal = 0;

  for (const fase of FASES) {
    const defs = POR_FASE[fase];
    const etapa = etapaDaFase(fase, factos);

    if (modo === 'QUICK' && fase !== 'Discovery') {
      fases.push({
        fase, descricao: DESCRICOES[fase], estado: 'PENDENTE',
        pulada: true, motivo: 'pulada no modo QUICK', ferramentas: [],
      });
      continue;
    }

    const entradas: FerramentaPlano[] = [];

    for (const def of defs) {
      const noPlano = modo === 'CUSTOM'
        ? escolhidas!.has(def.id)
        : modo === 'QUICK' ? (def.quik ?? false) : true;
      if (!noPlano) continue;
      const aplicavel = !factos.seedType || def.tipos.includes(factos.seedType);
      if (aplicavel) {
        entradas.push(ferramentaOuBloqueada(def, cat.get(def.id), factos, modo));
      } else if (modo === 'CUSTOM') {
        // O utilizador pediu: fica no plano e diz porque é que não pode correr.
        entradas.push({
          id: def.id, rotulo: cat.get(def.id)?.nome ?? def.id, kind: 'ferramenta',
          estado: 'BLOQUEADA',
          motivo: `não se aplica a alvos do tipo "${factos.seedType}"`,
        });
      }
    }

    if (etapa) {
      const querEtapa = modo !== 'CUSTOM' || escolhidas!.has(etapa.id);
      if (querEtapa) entradas.push(etapa);
    }

    if (modo === 'CUSTOM' && !entradas.length) {
      fases.push({
        fase, descricao: DESCRICOES[fase], estado: 'PENDENTE',
        pulada: true, motivo: 'fora do plano personalizado', ferramentas: [],
      });
      continue;
    }

    ferramentasTotal += entradas.length;
    const prontas = entradas.filter((e) => e.estado === 'PRONTO').length;
    let estado: EstadoFase = 'PRONTO';
    let motivo: string | undefined;
    if (!entradas.length) {
      estado = 'BLOQUEADA';
      motivo = `sem ferramentas do catálogo aplicáveis a alvos do tipo "${factos.seedType}"`;
    } else if (!prontas) {
      estado = 'BLOQUEADA';
      const motivos = [...new Set(entradas.map((e) => e.motivo).filter(Boolean))] as string[];
      motivo = motivos.slice(0, 2).join(' · ') || undefined;
    }
    fases.push({ fase, descricao: DESCRICOES[fase], estado, motivo, pulada: false, ferramentas: entradas });
  }

  const catalogoNoPlano = new Set<string>();
  for (const f of fases) for (const e of f.ferramentas) if (e.kind === 'ferramenta') catalogoNoPlano.add(e.id);

  return {
    modo,
    seedType: factos.seedType,
    fases,
    resumo: {
      fases: fases.length,
      prontas: fases.filter((f) => f.estado === 'PRONTO').length,
      bloqueadas: fases.filter((f) => f.estado === 'BLOQUEADA').length,
      puladas: fases.filter((f) => f.pulada).length,
      ferramentas: ferramentasTotal,
      catalogo: catalogo.length,
      fora: Math.max(0, catalogo.length - catalogoNoPlano.size),
    },
    geradoEm: agora,
  };
}

/** Pré-visualização do que o modo FULL inclui — é dela que a UI monta o CUSTOM. */
export function candidatos(catalogo: ItemCatalogo[], factos: Factos, agora: string): FasePlano[] {
  return montarPlano({ modo: 'FULL', catalogo, factos, agora }).fases;
}

// ------------------------------------------------------------- progresso

export function progressoInicial(plano: Plano): Progresso {
  return {
    modo: plano.modo,
    geradoEm: plano.geradoEm,
    atualizadoEm: plano.geradoEm,
    fases: plano.fases.map((f) => ({
      fase: f.fase,
      estado: 'PENDENTE' as EstadoFaseExec,
      pulada: f.pulada,
      motivo: f.motivo,
      executadoEm: null,
      ferramentas: f.ferramentas.map((e) => ({
        id: e.id,
        estado: 'PENDENTE' as EstadoFerramentaExec,
        ms: 0,
      })),
    })),
  };
}

/**
 * Estado final de uma fase, a partir do que cada ferramenta fez.
 *
 * `CONCLUIDA` só quando toda a gente correu — uma fase com metade bloqueada é
 * `PARCIAL`, e `BLOQUEADA` quando não correu nada. Uma fase sem ferramenta
 * executável nunca pode ser `CONCLUIDA`.
 */
export function estadoDaFase(registo: RegistoFase): { estado: EstadoFaseExec; motivo?: string } {
  if (registo.pulada) return { estado: 'PENDENTE', motivo: 'pulada' };
  const rs = registo.ferramentas;
  if (!rs.length) return { estado: 'BLOQUEADA', motivo: 'sem ferramentas executáveis nesta fase' };

  const executadas = rs.filter((r) => r.estado === 'EXECUTADA').length;
  const erros = rs.filter((r) => r.estado === 'ERRO').length;
  const porCorrer = rs.filter((r) => r.estado === 'PENDENTE').length;

  if (executadas === rs.length) return { estado: 'CONCLUIDA' };
  if (porCorrer === rs.length) return { estado: 'PENDENTE' };
  if (executadas > 0) return { estado: 'PARCIAL' };
  if (erros === rs.length) return { estado: 'ERRO' };
  if (porCorrer > 0) return { estado: 'PENDENTE' };

  const motivos = rs.filter((r) => r.erro).map((r) => r.erro!);
  return { estado: 'BLOQUEADA', motivo: motivos.slice(0, 2).join(' · ') || undefined };
}

/** Progresso agregado, para a UI e para a resposta do executar. */
export function resumoProgresso(p: Progresso): {
  fases: number; concluidas: number; parciais: number; bloqueadas: number; erros: number; pendentes: number;
  ferramentas: number; executadas: number;
} {
  const contar = (e: EstadoFaseExec) => p.fases.filter((f) => f.estado === e).length;
  const ferramentas = p.fases.flatMap((f) => f.ferramentas);
  return {
    fases: p.fases.length,
    concluidas: contar('CONCLUIDA'),
    parciais: contar('PARCIAL'),
    bloqueadas: contar('BLOQUEADA'),
    erros: contar('ERRO'),
    pendentes: contar('PENDENTE'),
    ferramentas: ferramentas.length,
    executadas: ferramentas.filter((f) => f.estado === 'EXECUTADA').length,
  };
}
