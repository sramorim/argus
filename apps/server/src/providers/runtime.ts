/**
 * Runner de CLI isolado — a única porta por onde o ARGOS executa código de
 * terceiros, e por isso a mais focada do backend.
 *
 * Regras, todas elas cumpridas aqui e não à chamada:
 *
 *  - **Sem shell.** `execFile` com argv em array: o que o utilizador escreve
 *    nunca chega a uma linha de comando, por isso não há injeção que valha a
 *    pena tentar.
 *  - **Executável declarado.** Quem chama diz qual é; o nome tem de ser um
 *    identificador simples (`[A-Za-z0-9._-]`) ou um caminho absoluto. Não há
 *    resolução a partir do input do utilizador.
 *  - **Env mínima.** Só PATH/HOME/LANG: sem chaves, sem tokens, sem variáveis
 *    do servidor a serem passadas a um processo de terceiros.
 *  - **Tempo e saída limitados.** `timeout` no processo e `maxBuffer` na
 *    memória; o que não coube fica `truncado`, e truncado é dito, não escondido.
 *  - **Nunca exceção por baixo.** Falhou, estourou tempo ou devolveu lixo →
 *    estado estruturado com nota. Quem consome decide o que mostrar.
 *
 * Nada disto executa sozinho: é chamado pela definição de um provider, que
 * também declara licença, instalação e o que falta para ficar `READY`.
 */
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

export interface CliPedido {
  /** Nome no PATH ou caminho absoluto. Vem da definição do provider. */
  executavel: string;
  /** argv. O primeiro elemento é o script, quando o executável é o interpretador. */
  args: string[];
  timeoutMs?: number;
  maxBytes?: number;
}

export type CliEstado = 'ok' | 'nao-instalado' | 'timeout' | 'erro' | 'sem-saida';

export interface CliSaida {
  estado: CliEstado;
  stdout: string;
  stderr: string;
  ms: number;
  codigo: number | null;
  truncado: boolean;
  nota: string;
}

export const TIMEOUT_CLI_MS = 90_000;
export const MAX_SAIDA_BYTES = 1_500_000;

/** Sem chaves do servidor num processo de terceiros. */
const ENV_MINIMO = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? '/data/data/com.termux/files/home',
  LANG: 'C.UTF-8',
};

const NOME_VALIDO = /^[A-Za-z0-9._-]{1,120}$/;

/** Caminho absoluto existe e é ficheiro? */
function caminhoValido(p: string): boolean {
  if (!p.startsWith('/')) return false;
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
}

/** Está disponível? Caminho absoluto (tem de existir) ou nome no PATH. */
export async function existe(executavel: string): Promise<boolean> {
  if (!executavel) return false;
  if (executavel.includes('/')) return caminhoValido(executavel);
  if (!NOME_VALIDO.test(executavel)) return false;
  return new Promise((res) => {
    // `command -v` é builtin do sh: não há caminho do utilizador a entrar no argv.
    execFile('sh', ['-c', `command -v ${executavel}`], { timeout: 4000, env: ENV_MINIMO }, (err) => res(!err));
  });
}

/** Versão, se o programa responder a `--version` sem partir. `null` = não sei. */
export async function versao(executavel: string): Promise<string | null> {
  if (!NOME_VALIDO.test(executavel)) return null;
  return new Promise((res) => {
    execFile(executavel, ['--version'], { timeout: 5000, env: ENV_MINIMO, maxBuffer: 64_000 }, (err, stdout) => {
      const t = String(stdout ?? '').trim().split('\n')[0] ?? '';
      res(!err && t ? t.slice(0, 120) : null);
    });
  });
}

function corta(s: string, max: number): { texto: string; truncado: boolean } {
  if (s.length <= max) return { texto: s, truncado: false };
  return { texto: s.slice(0, max) + '\n… [saída cortada]', truncado: true };
}

/** Executa. Nunca lança: tudo o que corre mal vira estado com nota. */
export async function executarCli(p: CliPedido): Promise<CliSaida> {
  const t0 = Date.now();
  const timeout = Math.max(1000, Math.min(p.timeoutMs ?? TIMEOUT_CLI_MS, TIMEOUT_CLI_MS));
  const max = Math.max(16_384, Math.min(p.maxBytes ?? MAX_SAIDA_BYTES, MAX_SAIDA_BYTES));
  if (!p.executavel || (!p.executavel.includes('/') && !NOME_VALIDO.test(p.executavel))) {
    return { estado: 'nao-instalado', stdout: '', stderr: '', ms: 0, codigo: null, truncado: false, nota: 'executável inválido' };
  }
  if (p.executavel.includes('/') && !caminhoValido(p.executavel)) {
    return { estado: 'nao-instalado', stdout: '', stderr: '', ms: Date.now() - t0, codigo: null, truncado: false, nota: `caminho não encontrado: ${p.executavel}` };
  }
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((res, rej) => {
      execFile(p.executavel, p.args, {
        timeout, maxBuffer: max * 2, env: ENV_MINIMO, shell: false, windowsHide: true,
      }, (err, so, se) => {
        if (err && !so && !se) rej(err);
        else res({ stdout: String(so ?? ''), stderr: String(se ?? '') });
      });
    });
    const a = corta(stdout, max);
    const b = corta(stderr, max);
    const ms = Date.now() - t0;
    const erro = ms >= timeout || /ETIMEDOUT|killed/i.test(b.texto);
    if (erro && !a.texto.trim()) {
      return { estado: 'timeout', stdout: a.texto, stderr: b.texto, ms, codigo: null, truncado: a.truncado, nota: `sem saída dentro de ${Math.round(timeout / 1000)}s` };
    }
    if (!a.texto.trim() && !b.texto.trim()) {
      return { estado: 'sem-saida', stdout: '', stderr: '', ms, codigo: null, truncado: false, nota: 'o programa terminou sem escrever nada' };
    }
    return {
      estado: a.texto.trim() ? 'ok' : 'erro', stdout: a.texto, stderr: b.texto, ms,
      codigo: null, truncado: a.truncado || b.truncado,
      nota: a.texto.trim() ? '' : `sem stdout; stderr: ${b.texto.trim().slice(0, 200)}`,
    };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const matou = /ETIMEDOUT|timed out|killed/i.test(msg);
    return {
      estado: matou ? 'timeout' : 'erro', stdout: '', stderr: msg, ms: Date.now() - t0,
      codigo: null, truncado: false,
      nota: matou ? `processo terminado por tempo (${Math.round(timeout / 1000)}s)` : msg.slice(0, 300),
    };
  }
}

/** Lê um ficheiro de saída temporário e limpa-o. */
export async function lerESair(caminho: string, max = MAX_SAIDA_BYTES): Promise<{ texto: string; truncado: boolean } | null> {
  const { readFileSync, unlinkSync } = await import('node:fs');
  try {
    const t = readFileSync(caminho, 'utf8');
    unlinkSync(caminho);
    return corta(t, max);
  } catch {
    return null;
  }
}
