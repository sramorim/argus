/**
 * Observabilidade de erros — reporter Sentry sem dependências.
 *
 * Porque não `@sentry/node`: o ARGOS é deliberadamente enxuto (poucas deps, sem
 * p-limit, sem frameworks de mais). O SDK oficial traz dezenas de pacotes
 * transitivos para o que, aqui, é um POST de um envelope JSON. Este módulo faz
 * esse POST pelo cliente HTTP seguro que já existe (safeFetch), e nada mais.
 *
 * Duas garantias que não se abrem mão:
 *
 *  1. **Sem DSN é no-op absoluto.** Nenhuma chamada de rede, nenhum custo. A
 *     telemetria é opt-in por `SENTRY_DSN`.
 *  2. **Nada de dados sensíveis sai daqui.** Antes de enviar, cada string passa
 *     pelo `limpar()`: e-mails, tokens, cookies, chaves e segredos conhecidos
 *     viram `[REMOVIDO]`. É o `beforeSend` do SDK, feito à mão e por omissão
 *     agressivo — numa ferramenta OSINT o corpo de um pedido pode ser o alvo de
 *     uma investigação, e isso nunca deve viajar para um terceiro.
 *
 * O reporter nunca lança: se o envio falha, falha em silêncio (um erro no
 * telemetria não pode derrubar o pedido que o originou).
 */
import { randomUUID } from 'node:crypto';
import { safeFetch } from './net/ssrf.ts';
import { config } from './config.ts';

interface DsnPartes { store: string; chave: string }

/** Decompõe o DSN `https://CHAVE@HOST/PROJETO` no URL de ingestão + chave. */
function parseDsn(dsn: string): DsnPartes | null {
  try {
    const u = new URL(dsn);
    const projeto = u.pathname.replace(/^\/+/, '').split('/').pop();
    if (!u.username || !projeto) return null;
    return {
      store: `${u.protocol}//${u.host}/api/${projeto}/store/`,
      chave: u.username,
    };
  } catch { return null; }
}

let destino: DsnPartes | null = null;
let ligado = false;

/**
 * Remove dados sensíveis de uma string antes de ela sair do processo.
 *
 * Agressivo de propósito: prefere apagar de mais a deixar escapar um e-mail, um
 * token ou o alvo de uma investigação. Aplica-se a TUDO o que se envia.
 */
export function limpar(s: string): string {
  if (!s) return s;
  return s
    // e-mails
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    // Authorization / Bearer / chaves de API conhecidas
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REMOVIDO]')
    .replace(/\b(sk|ghp|xox[baprs]|apify_api)[-_][A-Za-z0-9-]{10,}/g, '[TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[JWT]')
    // cookies de sessão do próprio ARGOS
    .replace(/(__Host-)?argus_session=[^;\s]+/g, 'argus_session=[REMOVIDO]')
    .replace(/\bx-access-key["':=\s]+[^\s"',}]+/gi, 'x-access-key=[REMOVIDO]')
    // nomes de variáveis de ambiente sensíveis, com o valor ao lado
    .replace(/\b(ARGUS_SECRET|PIX_KEY|APIFY_API_TOKEN|APIFY_TOKEN|SENTRY_DSN)["':=\s]+[^\s"',}]+/g, '$1=[REMOVIDO]')
    // blobs longos de alta entropia (prováveis segredos)
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[BLOB]');
}

interface Frame { filename?: string; function?: string; lineno?: number; colno?: number }

/** Converte o stack em frames, mantendo só caminho/função/linha (sem PII). */
function framesDe(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const linha of stack.split('\n').slice(1, 31)) {
    const m = /at\s+(.*?)\s+\(?(.+?):(\d+):(\d+)\)?$/.exec(linha.trim());
    if (m) out.push({ function: m[1], filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  // o Sentry espera os frames do mais antigo para o mais recente
  return out.reverse();
}

/**
 * Liga o reporter a partir da config. Chamar uma vez no arranque.
 * Diz se ficou ligado — sem nunca imprimir o DSN.
 */
export function initObservability(): boolean {
  if (!config.sentryDsn) { ligado = false; return false; }
  destino = parseDsn(config.sentryDsn);
  ligado = !!destino;
  if (!destino) console.error('[ARGUS] SENTRY_DSN presente mas inválido: observabilidade desligada.');
  return ligado;
}

export function observabilidadeLigada(): boolean { return ligado; }

/**
 * Reporta um erro ao Sentry, já higienizado. Fire-and-forget: nunca espera, nunca lança.
 * `contexto` é opcional e também é limpo antes de ir.
 */
export function reportar(err: unknown, contexto?: Record<string, unknown>): void {
  if (!ligado || !destino) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const extra: Record<string, string> = {};
    if (contexto) for (const [k, v] of Object.entries(contexto)) extra[k] = limpar(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 500);

    const evento = {
      event_id: randomUUID().replace(/-/g, ''),
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      environment: config.env,
      release: 'argus@1.0.0',
      exception: {
        values: [{
          type: e.name || 'Error',
          value: limpar(e.message || '').slice(0, 1000),
          stacktrace: { frames: framesDe(e.stack) },
        }],
      },
      extra,
    };

    // Fire-and-forget: a promessa é intencionalmente não aguardada.
    void safeFetch(destino.store, {
      method: 'POST',
      body: JSON.stringify(evento),
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${destino.chave}, sentry_client=argus/1.0`,
      },
      timeoutMs: 4000,
      maxBytes: 100_000,
    }).catch(() => { /* telemetria nunca derruba o processo */ });
  } catch { /* idem */ }
}
