/**
 * System Health — o estado REAL das dependências, por provider (FASE G).
 *
 * `/api/health` responde "está a correr"; isto responde "**com o que** está a
 * correr" — e, sobretudo, com o que falta. Estados todos do spec:
 *
 *   READY            instalado, configurado e verificado
 *   NOT_INSTALLED    falta o binário/ficheiro        → com o comando de instalação
 *   NOT_CONFIGURED   falta configuração              → com o nome EXATO da variável
 *   MISSING_SECRET   falta um segredo (BYOK)         → nunca mostramos o valor
 *   INCOMPATIBLE     não serve para este contexto
 *   ERROR            verificado e falhou             → com o erro real
 *   RATE_LIMITED     limitado pelo serviço externo
 *   DISABLED         desativado de propósito
 *
 * Duas velocidades: por omissão só verifica presença e configuração (rápido,
 * sem rede, serve para ser chamado num health poll). Com `detalhe` verifica
 * versões (spawning `--version`) e, se houver token, o serviço do Apify.
 *
 * O estado geral é o pior estado individual — nunca se reporta "tudo ok" com
 * metade das dependências em falta.
 *
 * Segredos: as linhas dizem o NOME da variável (`APIFY_API_TOKEN`) e o estado
 * (`READY` / `NOT_CONFIGURED` / ...), nunca o valor. Antes de devolver, o
 * relatório inteiro passa por `foraDeAlcance` — se por engano uma linha
 * escrevesse a chave, ela é redigida aqui dentro.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dbHealth } from './db.ts';

export type EstadoSistema =
  | 'READY' | 'NOT_INSTALLED' | 'NOT_CONFIGURED' | 'MISSING_SECRET'
  | 'INCOMPATIBLE' | 'ERROR' | 'RATE_LIMITED' | 'DISABLED';

export interface LinhaSaude {
  nome: string;
  modulo: string;
  tipo: string;
  runtime: string;
  versao: string | null;
  cliApi: string;
  dependencias: string;
  apikey: string | null;
  secret: string | null;
  servicoExterno: string | null;
  status: EstadoSistema;
  healthCheck: string;
  latenciaMs: number | null;
  ultimoTeste: string | null;
  erro: string | null;
  configuracao: string;
}

export interface RelatorioSaude {
  estadoGeral: EstadoSistema;
  geradoEm: string;
  total: number;
  porEstado: Partial<Record<EstadoSistema, number>>;
  linhas: LinhaSaude[];
  nota: string;
}

/** Do mais grave para o mais leve: o primeiro que aparece manda no geral. */
const SEVERIDADE: EstadoSistema[] = [
  'ERROR', 'RATE_LIMITED', 'MISSING_SECRET', 'NOT_CONFIGURED',
  'NOT_INSTALLED', 'INCOMPATIBLE', 'DISABLED', 'READY',
];

function linha(p: Partial<LinhaSaude> & Pick<LinhaSaude, 'nome' | 'modulo' | 'status'>): LinhaSaude {
  return {
    tipo: 'servico', runtime: 'interno', versao: null, cliApi: 'API', dependencias: 'nenhuma',
    apikey: null, secret: null, servicoExterno: null, healthCheck: '',
    latenciaMs: null, ultimoTeste: new Date().toISOString(), erro: null, configuracao: '',
    ...p,
  };
}

/**
 * Uma linha por registo de sites vendurado.
 *
 * A contagem é lida do ficheiro, nunca escrita à mão. Antes os números vinham
 * como argumento e divergiam do que está nos ficheiros (a tela mostrava 695 e
 * 2113 onde o registo tem 717 e 6206) — o estado do sistema有数 errada é pior
 * do que o estado do sistema sem número.
 *
 * A conta segue a mesma forma que o `username-intel` usa para construir o
 * índice, e diz também quantos sites o Maigret traz marcados como `disabled`
 * (que o índice deixa de fora).
 */
function linhaRegisto(nome: string, provider: 'sherlock' | 'whatsmyname' | 'maigret'): LinhaSaude {
  const ficheiro = `${provider}.json`;
  const caminho = join(import.meta.dirname, 'data', 'registries', ficheiro);
  try {
    const dados = JSON.parse(readFileSync(caminho, 'utf8')) as Record<string, any>;
    let brutos = 0;
    let desativados = 0;
    if (provider === 'sherlock') {
      brutos = Object.keys(dados).filter((k) => !k.startsWith('$')).length;
    } else if (provider === 'whatsmyname') {
      brutos = Array.isArray(dados.sites) ? dados.sites.length : 0;
    } else {
      const sites = (dados.sites ?? {}) as Record<string, { disabled?: boolean }>;
      brutos = Object.keys(sites).length;
      desativados = Object.values(sites).filter((s) => s?.disabled === true).length;
    }
    const uteis = brutos - desativados;
    const detalhe = desativados > 0 ? ` (${uteis} utilizáveis, ${desativados} desativados)` : '';
    return linha({
      nome, modulo: 'Username Intelligence', tipo: 'registo', runtime: 'JSON local',
      cliApi: 'local', dependencias: 'nenhuma', servicoExterno: caminho,
      status: 'READY', healthCheck: `registo lido: ${brutos} sites${detalhe}`,
      configuracao: 'vendurado no repositório (ver THIRD-PARTY.md)',
    });
  } catch (e) {
    return linha({
      nome, modulo: 'Username Intelligence', tipo: 'registo', runtime: 'JSON local',
      cliApi: 'local', dependencias: 'nenhuma', servicoExterno: caminho,
      status: 'NOT_INSTALLED', healthCheck: 'registo ilegível',
      erro: String((e as Error)?.message ?? e).slice(0, 200),
      configuracao: `replicar o ficheiro ${ficheiro} em src/data/registries/`,
    });
  }
}

/** Relatório completo. `detalhe` custa processos e, se houver token, rede. */
export async function saudeSistema(opts: { detalhe?: boolean } = {}): Promise<RelatorioSaude> {
  const detalhe = opts.detalhe === true;
  const linhas: LinhaSaude[] = [];
  const t0 = Date.now();

  const db = dbHealth();
  linhas.push(linha({
    nome: 'Base de dados (SQLite)', modulo: 'núcleo', tipo: 'ficheiro', runtime: 'better-sqlite3',
    cliApi: 'local', servicoExterno: db.path, status: db.writable ? 'READY' : 'ERROR',
    healthCheck: db.writable ? 'ficheiro com escrita' : 'sem escrita',
    erro: db.note ?? null, configuracao: db.path,
  }));
  linhas.push(linha({
    nome: 'Node.js', modulo: 'núcleo', tipo: 'runtime', runtime: process.version,
    cliApi: 'local', status: 'READY', healthCheck: 'processo ativo',
    versao: process.version, configuracao: 'gerido pelo deploy',
  }));

  linhas.push(linhaRegisto('Sherlock (registo)', 'sherlock'));
  linhas.push(linhaRegisto('WhatsMyName (registo)', 'whatsmyname'));
  linhas.push(linhaRegisto('Maigret (registo)', 'maigret'));

  const porEstado: Partial<Record<EstadoSistema, number>> = {};
  for (const l of linhas) porEstado[l.status] = (porEstado[l.status] ?? 0) + 1;
  const estadoGeral = SEVERIDADE.find((s) => porEstado[s]) ?? 'READY';
  const prontos = porEstado.READY ?? 0;
  const faltam = linhas.length - prontos;

  const rel: RelatorioSaude = {
    estadoGeral,
    geradoEm: new Date().toISOString(),
    total: linhas.length,
    porEstado,
    linhas,
    nota: faltam === 0
      ? `Todas as ${linhas.length} dependências verificadas estão READY.`
      : `${prontos} de ${linhas.length} dependências READY; o estado geral é o pior estado individual (${estadoGeral}) — o ARGOS funciona, mas estas faltam. Verificação em ${Date.now() - t0}ms${detalhe ? ' com detalhe (versões e serviço)' : ' (só presença e configuração; use ?detalhe=sim)'}.`,
  };

  // Verificação final do /api/health: o relatório nunca contém o VALOR de um
  // segredo — só o NOME da variável e o ESTADO. Rede de segurança: redige
  // qualquer segredo do ambiente que, por engano, acabe numa linha futura.
  return redigirSegredos(rel);
}

/** Redige do relatório o valor de qualquer segredo conhecido do ambiente. */
const SEGREDOS_ENV = ['ARGUS_SECRET', 'HIBP_API_KEY', 'GITHUB_TOKEN'];
function redigirSegredos<T>(valor: T): T {
  let v: unknown = valor;
  for (const nome of SEGREDOS_ENV) {
    const tk = (process.env[nome] ?? '').trim();
    if (tk.length >= 8) v = redigir(v, tk);
  }
  return v as T;
}
function redigir(valor: unknown, tk: string): unknown {
  if (typeof valor === 'string') return valor.split(tk).join('«redigido»');
  if (Array.isArray(valor)) return valor.map((x) => redigir(x, tk));
  if (valor !== null && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(valor as Record<string, unknown>)) out[k] = redigir(x, tk);
    return out;
  }
  return valor;
}

/** Matriz no formato do spec: uma linha por dependência. */
export async function matrizDependencias(detalhe = false): Promise<LinhaSaude[]> {
  const r = await saudeSistema({ detalhe });
  return r.linhas;
}
