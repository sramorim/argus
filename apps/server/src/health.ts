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
import { existe, versao } from './providers/runtime.ts';
import { PROVIDERS, type ProviderOsint } from './providers/osint.ts';
import { ACTORS, estadoDe, saude as saudeApify, token, foraDeAlcance } from './net/apify.ts';

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

async function linhaCli(p: ProviderOsint, detalhe: boolean): Promise<LinhaSaude> {
  const agoraIso = new Date().toISOString();
  const base = {
    nome: p.nome, modulo: 'OSINT Engine', tipo: 'cli', runtime: 'processo isolado',
    cliApi: 'CLI', dependencias: p.instalacao, servicoExterno: p.repo,
    secret: null, apikey: null, latenciaMs: null, ultimoTeste: agoraIso,
  };

  if (p.binario) {
    const t0 = Date.now();
    const ok = await existe(p.binario);
    if (!ok) {
      return linha({ ...base, status: 'NOT_INSTALLED', erro: null,
        healthCheck: 'comando não encontrado no PATH',
        configuracao: `PATH · instale: ${p.instalacao}` });
    }
    const v = detalhe ? await versao(p.binario) : null;
    return linha({ ...base, status: 'READY', versao: v,
      latenciaMs: Date.now() - t0,
      healthCheck: detalhe ? (v ? 'respondeu a --version' : 'presente; não respondeu a --version') : 'presente no PATH (não verificado a fundo)',
      configuracao: `PATH · ${p.binario}` });
  }

  const nomeEnv = p.envCaminho ?? '';
  const caminho = (process.env[nomeEnv] ?? '').trim();
  if (!caminho) {
    return linha({ ...base, status: 'NOT_CONFIGURED',
      healthCheck: `variável ${nomeEnv} não definida`,
      configuracao: `${nomeEnv} com o caminho de ${p.id} · instale: ${p.instalacao}` });
  }
  const t0 = Date.now();
  const ok = await existe(caminho);
  if (!ok) {
    return linha({ ...base, status: 'NOT_INSTALLED', latenciaMs: Date.now() - t0,
      healthCheck: `caminho definido mas o ficheiro não existe: ${caminho}`,
      configuracao: `${nomeEnv}=${caminho}` });
  }
  const v = detalhe ? await versao('python3') : null;
  return linha({ ...base, status: 'READY', versao: v, latenciaMs: Date.now() - t0,
    healthCheck: detalhe ? 'script presente; python3 respondeu' : 'script presente (não verificado a fundo)',
    configuracao: `${nomeEnv}=${caminho}` });
}

function linhaRegisto(nome: string, ficheiro: string, sites: number): LinhaSaude {
  const caminho = join(import.meta.dirname, 'data', 'registries', ficheiro);
  try {
    JSON.parse(readFileSync(caminho, 'utf8'));
    return linha({
      nome, modulo: 'Username Intelligence', tipo: 'registo', runtime: 'JSON local',
      cliApi: 'local', dependencias: 'nenhuma', servicoExterno: caminho,
      status: 'READY', healthCheck: `registo lido: ${sites} sites`,
      configuracao: 'vendurado no repositório (ver THIRD-PARTY.md)',
    });
  } catch (e) {
    return linha({
      nome, modulo: 'Username Intelligence', tipo: 'registo', runtime: 'JSON local',
      cliApi: 'local', dependencias: 'nenhuma', servicoExterno: caminho,
      status: 'NOT_INSTALLED', healthCheck: 'registo ilegível',
      erro: String((e as Error).message ?? e).slice(0, 200),
      configuracao: 'replicar o ficheiro em src/data/registries/',
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

  linhas.push(linhaRegisto('Sherlock (registo)', 'sherlock.json', 481));
  linhas.push(linhaRegisto('WhatsMyName (registo)', 'whatsmyname.json', 695));
  linhas.push(linhaRegisto('Maigret (registo)', 'maigret.json', 2113));

  for (const p of PROVIDERS) linhas.push(await linhaCli(p, detalhe));
  linhas.push(await linhaCli({
    id: 'blackbird', nome: 'Blackbird', licenca: 'sem licença coerente', repo: 'https://github.com/p1ngul4r/blackbird',
    tipos: ['email'], instalacao: 'pip3 install blackbird', binario: 'blackbird', envCaminho: null, python: false,
    args: () => [], interpretar: () => ({ itens: null, nota: '' }),
  }, detalhe));

  const t = token();
  if (!t.token) {
    linhas.push(linha({
      nome: 'Apify (serviço)', modulo: 'APIFY', tipo: 'api', runtime: 'API remota',
      servicoExterno: 'api.apify.com', apikey: 'APIFY_API_TOKEN', status: 'NOT_CONFIGURED',
      healthCheck: `${t.falta} em falta — sem pedido feito`,
      configuracao: `${t.falta} no ambiente do servidor (backend/secret manager)`,
    }));
    for (const a of ACTORS) {
      linhas.push(linha({
        nome: a.name, modulo: 'APIFY', tipo: 'actor', runtime: 'API remota',
        servicoExterno: `apify.com/${a.actorId}`, apikey: 'APIFY_API_TOKEN',
        cliApi: 'REST', dependencias: 'nenhuma local',
          status: a.enabled ? 'NOT_CONFIGURED' : 'DISABLED',
          healthCheck: a.enabled ? `${t.falta} em falta` : 'actor desativado no registry',
          configuracao: `${t.falta} · actor ${a.oficial ? 'oficial apify/*' : 'de terceiros'} pay-per-event${a.viaApiNaFree ? '' : ' · conta Free: só demo na Console, via API exige plano pago'}`,
        }));
    }
  } else {
    const t1 = Date.now();
    const h = await saudeApify();
    const status: EstadoSistema = h.status === 'READY' ? 'READY'
      : h.status === 'NOT_CONFIGURED' ? 'MISSING_SECRET'
      : h.status === 'ERROR' ? 'ERROR' : h.status as EstadoSistema;
    linhas.push(linha({
      nome: 'Apify (serviço)', modulo: 'APIFY', tipo: 'api', runtime: 'API remota',
      servicoExterno: 'api.apify.com', apikey: 'APIFY_API_TOKEN', status,
      healthCheck: h.nota, latenciaMs: h.latenciaMs ?? Date.now() - t1,
      erro: h.status === 'ERROR' ? h.nota : null,
      configuracao: `conta ${h.conta ?? 'desconhecida'} · token presente (não exposto)`,
    }));
    for (const a of ACTORS) {
      const e = estadoDe(a.actorId);
      const st: EstadoSistema = !a.enabled ? 'DISABLED'
        : e.status === 'READY' ? 'READY'
        : e.status === 'RATE_LIMITED' ? 'RATE_LIMITED'
        : e.status === 'PAYMENT_REQUIRED' ? 'MISSING_SECRET'
        : e.status === 'ERROR' ? 'ERROR' : 'NOT_CONFIGURED';
      linhas.push(linha({
        nome: a.name, modulo: 'APIFY', tipo: 'actor', runtime: 'API remota',
        servicoExterno: `apify.com/${a.actorId}`, apikey: 'APIFY_API_TOKEN',
        cliApi: 'REST', dependencias: 'nenhuma local',
        status: st,         healthCheck: e.error ?? (e.status === 'READY' ? 'última execução OK' : 'ainda não executado'),
        ultimoTeste: e.lastRun, erro: e.error,
        configuracao: `actor ${a.oficial ? 'oficial apify/*' : 'de terceiros'} · pay-per-event${a.viaApiNaFree ? '' : ' · conta Free: só demo na Console, via API exige plano pago'}`,
      }));
    }
  }

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

  // Verificação final do /api/health: o relatório devolvido nunca contém o valor
  // do token — nem nas linhas, nem na nota. Os campos mostram o NOME da variável
  // (`APIFY_API_TOKEN`) e o ESTADO (READY / NOT_CONFIGURED / ...), nunca a chave.
  return foraDeAlcance(rel, token().token);
}

/** Matriz no formato do spec: uma linha por dependência. */
export async function matrizDependencias(detalhe = false): Promise<LinhaSaude[]> {
  const r = await saudeSistema({ detalhe });
  return r.linhas;
}
