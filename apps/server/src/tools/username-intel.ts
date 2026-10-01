/**
 * Inteligência de username — quatro providers independentes sobre o mesmo alvo.
 *
 * Cada provider traz o SEU registo de sites (ver `src/data/registries/THIRD-PARTY.md`),
 * a SUA forma de decidir "existe / não existe" e o SEU estado honesto:
 *
 *   sherlock      READY         registo MIT vendurado, 481 sites
 *   whatsmyname   READY         registo CC BY-SA vendurado, 717 sites
 *   maigret       READY         registo MIT vendurado, 6206 sites (698 desativados ficam de fora)
 *   blackbird     NOT_INSTALLED CLI isolado: só corre se o binário existir no PATH
 *
 * Três regras de decisão, por ordem de solidez:
 *
 *   1. As cadeias do próprio registo (`errorMsg`, `m_string`, `absenceStrs`) dizem
 *      "a página do inexistente tem este texto" — quem não o mostra existe.
 *   2. O status HTTP (404/410/código de erro do registo) diz o mesmo sem texto.
 *   3. Quando nenhum dos dois decide, compara-se a resposta do alvo com a de um
 *      username de controlo pedido ao MESMO site (o `usernameUnclaimed` do
 *      registo, ou um aleatório que passe o `regexCheck` do site). Se os dois
 *      devolverem a mesma coisa, não há sinal — `UNKNOWN`, nunca `FOUND`.
 *
 * O ponto 3 é a metodologia de baseline já provada no `username-finder`, e é o
 * que impede o erro mais caro disto tudo: um SPA que devolve 200 a qualquer
 * nome parecer um perfil que existe.
 *
 * `FOUND` é "existe uma conta pública com este nome NESTE site". Nunca é
 * "é a mesma pessoa" — isso é correlação, e pertence ao grafo.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding, type Confidence } from '../net/provenance.ts';
import { safeFetch } from '../net/ssrf.ts';

// --------------------------------------------------------------------- tipos

export type Estado = 'FOUND' | 'NOT_FOUND' | 'UNKNOWN' | 'ERROR' | 'BLOCKED';
export type ProviderId = 'sherlock' | 'whatsmyname' | 'maigret' | 'blackbird';
export type Regra = 'status' | 'message' | 'response_url' | 'baseline';

/** Um site do registo, já normalizado para o formato comum. */
export interface Registo {
  provider: ProviderId;
  site: string;
  /** URL com `{}` / `{account}` / `{username}` por preencher. */
  tpl: string;
  metodo: 'GET' | 'POST';
  headers?: Record<string, string>;
  payload?: string;
  /** `regexCheck` do registo: username que o site aceita. */
  re?: RegExp;
  regra: Regra;
  /** Status que significam "existe". */
  ok?: number[];
  /** Status que significam "não existe" (só conta se não houver cadeias). */
  faltaStatus?: number[];
  /** Strings que significam "existe". */
  tem?: string[];
  /**
   * `true` quando a string de existência é OBRIGATÓRIA (WhatsMyName: o `e_string`
   * é a condição de existência, não um indício). Sem ela, a resposta não prova
   * nada — e responder `200` também não prova nada (há APIs de username que
   * devolvem 200 a qualquer nome, como a de disponibilidade do X).
   */
  temObrigatorio?: boolean;
  /** Strings que significam "não existe". */
  falta?: string[];
  /** `response_url`: para onde vai quem não existe. */
  erroUrl?: string;
  /** Username sabido NÃO existir neste site — controlo negativo do próprio registo. */
  naoReclamado?: string;
}

export interface Resposta {
  status: number;
  body: string;
  url: string;
  truncado: boolean;
}

/** `PRECISA_CONTROLO`: o veredito depende da resposta ao username de controlo. */
export type Veredito = { estado: Estado | 'PRECISA_CONTROLO'; via: string };

interface EstadoProvider {
  estado: 'READY' | 'NOT_INSTALLED' | 'NOT_CONFIGURED' | 'ERROR' | 'NOT_EXECUTED';
  nota: string;
}

// ------------------------------------------------------------------ regissistos

const DIR = join(import.meta.dirname, '..', 'data', 'registries');
const ORIGEM: Record<Exclude<ProviderId, 'blackbird'>, string> = {
  sherlock: 'https://raw.githubusercontent.com/sherlock-project/sherlock/e40a45ec2a074b90703b3b4b842c8a3adbd6ada3/sherlock_project/resources/data.json',
  whatsmyname: 'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/062bcfe48df79fa618e96edc79dc9673f3fe5643/wmn-data.json',
  maigret: 'https://raw.githubusercontent.com/soxoj/maigret/b6642744988e7e6c2d21f75db60ec3093019ba25/maigret/resources/data.json',
};

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v) return [v];
  return [];
}

function reSegura(s: unknown): RegExp | undefined {
  if (typeof s !== 'string' || !s || s.length > 240) return undefined;
  try { return new RegExp(s); } catch { return undefined; }
}

/** Põe o valor no lugar dos marcadores do registo, com o username codificado. */
export function substitui(tpl: string, valor: string): string {
  const enc = encodeURIComponent(valor);
  return tpl.split('{}').join(enc).split('{account}').join(enc).split('{username}').join(enc);
}

interface EtcSherlock {
  url?: string; urlProbe?: string; errorType?: string; errorMsg?: unknown;
  errorCode?: number; errorUrl?: string; regexCheck?: string;
  request_method?: string; request_payload?: string; headers?: Record<string, string>;
}

export function parseSherlock(dados: Record<string, unknown>): Registo[] {
  const out: Registo[] = [];
  for (const [site, bruto] of Object.entries(dados)) {
    if (site === '$schema') continue;
    const e = bruto as EtcSherlock;
    const tpl = e.urlProbe && e.urlProbe.includes('{}') ? e.urlProbe : e.url;
    if (!tpl || !tpl.includes('{}') || !/^https?:\/\//.test(tpl)) continue;
    const base: Registo = {
      provider: 'sherlock', site, tpl,
      metodo: (e.request_method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      headers: e.headers, payload: e.request_payload, re: reSegura(e.regexCheck), regra: 'baseline',
    };
    if (e.errorType === 'message' && asArray(e.errorMsg).length) {
      out.push({ ...base, regra: 'message', falta: asArray(e.errorMsg) });
    } else if (e.errorType === 'status_code') {
      out.push({ ...base, regra: 'status', ok: [200], faltaStatus: typeof e.errorCode === 'number' ? [e.errorCode] : undefined });
    } else if (e.errorType === 'response_url' && e.errorUrl) {
      out.push({ ...base, regra: 'response_url', erroUrl: e.errorUrl });
    } else {
      out.push(base);
    }
  }
  return out;
}

interface EtcWmn {
  name?: string; uri_check?: string; e_code?: number; e_string?: string;
  m_code?: number; m_string?: string; post_body?: string; headers?: Record<string, string>;
}

export function parseWmn(dados: { sites?: unknown[] }): Registo[] {
  const out: Registo[] = [];
  for (const bruto of dados.sites ?? []) {
    const e = bruto as EtcWmn;
    if (!e.name || !e.uri_check || !e.uri_check.includes('{account}') || !/^https?:\/\//.test(e.uri_check)) continue;
    const falta = (e.m_string ?? '').trim();
    out.push({
      provider: 'whatsmyname', site: e.name, tpl: e.uri_check, metodo: e.post_body ? 'POST' : 'GET',
      headers: e.headers, payload: e.post_body, regra: 'status',
      ok: [typeof e.e_code === 'number' ? e.e_code : 200],
      tem: (e.e_string ?? '').trim() ? [e.e_string!] : undefined,
      temObrigatorio: (e.e_string ?? '').trim() ? true : undefined,
      falta: falta ? [falta] : undefined,
      faltaStatus: falta ? undefined : typeof e.m_code === 'number' ? [e.m_code] : undefined,
    });
  }
  return out;
}

interface EtcMaigret {
  url?: string; urlProbe?: string; urlMain?: string; checkType?: string; regexCheck?: string;
  presenseStrs?: unknown; absenceStrs?: unknown; errors?: unknown;
  requestMethod?: string; requestPayload?: unknown; headers?: Record<string, string>;
  disabled?: boolean; usernameUnclaimed?: string;
}

export function parseMaigret(dados: { sites?: Record<string, unknown> }): { sites: Registo[]; desativados: number } {
  const sites: Registo[] = [];
  let desativados = 0;
  for (const [site, bruto] of Object.entries(dados.sites ?? {})) {
    const e = bruto as EtcMaigret;
    if (e.disabled) { desativados++; continue; }
    // Só se usa o urlProbe se ele mesmo levar o username; caso contrário a
    // URL do perfil. E há entradas do Maigret sem URL nenhuma — construídas
    // pelo motor dele (Discourse, MediaWiki…) — que não entram aqui: emular
    // esses motores seria adivinhar o padrão de cada site.
    let tpl = e.urlProbe && e.urlProbe.includes('{username}') ? e.urlProbe : e.url;
    if (tpl && tpl.includes('{urlMain}')) tpl = tpl.split('{urlMain}').join(e.urlMain ?? '');
    if (!tpl || !tpl.includes('{username}') || !/^https?:\/\//.test(tpl)) continue;
    const tem = asArray(e.presenseStrs);
    const falta = asArray(e.absenceStrs);
    const erros = asArray(e.errors);
    const errosNum = Array.isArray(e.errors) ? e.errors.filter((x): x is number => typeof x === 'number') : [];
    const base: Registo = {
      provider: 'maigret', site, tpl,
      metodo: (e.requestMethod ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      headers: e.headers,
      payload: typeof e.requestPayload === 'string' ? e.requestPayload
        : e.requestPayload ? JSON.stringify(e.requestPayload) : undefined,
      re: reSegura(e.regexCheck), regra: 'baseline',
      naoReclamado: e.usernameUnclaimed,
    };
    if (e.checkType === 'message') {
      sites.push({ ...base, regra: 'message', falta: falta.length ? falta : erros.length ? erros : undefined, tem: tem.length ? tem : undefined });
    } else if (e.checkType === 'status_code') {
      sites.push({ ...base, regra: 'status', ok: [200], faltaStatus: errosNum.length ? errosNum : undefined, tem: tem.length ? tem : undefined, falta: falta.length ? falta : undefined });
    } else if (e.checkType === 'response_url') {
      sites.push({ ...base, regra: 'response_url', tem: tem.length ? tem : undefined, falta: falta.length ? falta : undefined });
    } else {
      // Sem checkType: o motor do site (Discourse, MediaWiki...) decide. Aqui não
      // se adivinha a semântica de cada motor — fica `baseline` e o controlo decide.
      sites.push({ ...base, regra: 'baseline', tem: tem.length ? tem : undefined, falta: falta.length ? falta : undefined });
    }
  }
  return { sites, desativados };
}

const carga = new Map<ProviderId, { sites: Registo[]; desativados: number; brutos: number; erro?: string }>();

interface RegistoCarregado { sites: Registo[]; desativados: number; brutos: number; erro?: string }

export function carregar(provider: Exclude<ProviderId, 'blackbird'>): RegistoCarregado {
  const hit = carga.get(provider);
  if (hit) return hit;
  let res: RegistoCarregado;
  try {
    const f = provider === 'sherlock' ? 'sherlock.json' : provider === 'whatsmyname' ? 'whatsmyname.json' : 'maigret.json';
    const dados = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, unknown>;
    const brutos = provider === 'sherlock' ? Object.keys(dados).filter((k) => k !== '$schema').length
      : provider === 'whatsmyname' ? ((dados as { sites?: unknown[] }).sites ?? []).length
        : Object.keys((dados as { sites?: Record<string, unknown> }).sites ?? {}).length;
    res = provider === 'sherlock' ? { sites: parseSherlock(dados), desativados: 0, brutos }
      : provider === 'whatsmyname' ? { sites: parseWmn(dados as { sites?: unknown[] }), desativados: 0, brutos }
        : { ...parseMaigret(dados as { sites?: Record<string, unknown> }), brutos };
  } catch (e) {
    res = { sites: [], desativados: 0, brutos: 0, erro: String((e as Error).message) };
  }
  carga.set(provider, res);
  return res;
}

// ------------------------------------------------------------- controlo/baseline

const letras = 'abcdefghijklmnopqrstuvwxyz0123456789';
function aleatorio(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += letras[Math.floor(Math.random() * letras.length)];
  return s;
}

/**
 * Username de controlo para este site: o que o registo diz não existir
 * (`usernameUnclaimed` do Maigret), ou um aleatório que passe o `regexCheck`.
 * Se nada passar o regex, não há controlo — e sem controlo não se confirma nada.
 */
export function controlePara(reg: Registo): string | null {
  const cands = [
    reg.naoReclamado,
    'zz' + aleatorio(6) + 'q',
    'zz' + aleatorio(4) + 'q',
    'zz' + aleatorio(10) + 'q',
    'zz_' + aleatorio(6),
    'zz-' + aleatorio(6),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  for (const c of cands) {
    if (!reg.re || reg.re.test(c)) return c;
  }
  return null;
}

const GENERICO = /^(just a moment|attention required|redirecting|access denied|error|page not found|not found|cloudflare|checking your browser|404)/i;

/**
 * Marcador de conteúdo do que a página DIZ ao visitante (título, og:title, h1),
 * com o username tirado do meio e o ruído (ids, datas) apagado.
 *
 * Normalizar o username é o que fecha o falso positivo do Telegram: o título
 * "Contact @user" muda sempre — com o username marcado, o que muda é só o
 * que interessa (perfil vs. página genérica).
 */
export function marcador(body: string, user: string): string {
  const head = body.slice(0, 60_000);
  const bruto: string[] = [];
  const t = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(head);
  if (t) bruto.push('T:' + t[1].replace(/\s+/g, ' ').trim());
  const re = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:title|og:description|description|profile:username)["'][^>]*content\s*=\s*["']([^"']{0,400})["']/gi;
  for (const m of head.matchAll(re)) bruto.push('M:' + m[1].replace(/\s+/g, ' ').trim());
  const h1 = /<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i.exec(head);
  if (h1) bruto.push('H:' + h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  // Título de página de erro/challenge não é sinal de perfil nenhum.
  let s = bruto.filter((b) => !GENERICO.test(b.replace(/^[TMH]:/, ''))).join(' | ');
  if (user) {
    const esc = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(esc, 'gi'), ' ');
  }
  s = s.replace(/\s+/g, ' ').replace(/[0-9a-f]{16,}/gi, '').replace(/\d{4,}/g, '').trim().slice(0, 700);
  return s;
}

const BLOQUEIO = /(just a moment|attention required|cf-browser-verification|checking your browser|are you a robot|captcha|enable javascript and cookies|ddos protection|verifique que (e|é) humano|access denied)/i;

/**403/401/429 ou página de desafio: não dá para dizer nada sobre o alvo. */
export function bloqueado(r: Resposta): boolean {
  if (r.status === 401 || r.status === 403 || r.status === 429) return true;
  return BLOQUEIO.test(r.body.slice(0, 6000));
}

const curto = (s: string) => (s.length > 60 ? s.slice(0, 57) + '...' : s);
const mesmaUrl = (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '');

/**
 * Decisão pura: uma resposta (e opcionalmente a do controlo) -> estado.
 * Não faz I/O — tudo o que é rede já chegou aqui feito, para que os testes
 * possam exercitar cada ramo sem tocar a nenhum site.
 */
export function classificar(
  reg: Registo, alvo: Resposta | null, controlo?: Resposta | null,
  user = '', ctrlUser = '',
): Veredito {
  if (!alvo) return { estado: 'ERROR', via: 'falha de rede no pedido' };
  if (bloqueado(alvo)) return { estado: 'BLOCKED', via: `resposta bloqueada (status ${alvo.status})` };
  if (reg.re && user && !reg.re.test(user)) return { estado: 'NOT_FOUND', via: 'o site nem aceita este formato de username' };

  // 1) cadeias de ausência: o site diz explicitamente "não existe"
  const falta = (reg.falta ?? []).filter((s) => s && alvo.body.includes(s));
  if (falta.length) return { estado: 'NOT_FOUND', via: `marca de ausência: "${curto(falta[0])}"` };

  // 2) status de ausência — só decide sozinho quando o registo não traz texto
  if (!(reg.falta ?? []).length && reg.faltaStatus?.includes(alvo.status)) {
    return { estado: 'NOT_FOUND', via: `status ${alvo.status}` };
  }
  if (alvo.status === 404 || alvo.status === 410) return { estado: 'NOT_FOUND', via: `status ${alvo.status}` };
  if (reg.regra === 'response_url' && reg.erroUrl && mesmaUrl(alvo.url, reg.erroUrl)) {
    return { estado: 'NOT_FOUND', via: 'redirecionado para a página de erro do site' };
  }

  const statusOk = reg.ok ? reg.ok.includes(alvo.status) : alvo.status >= 200 && alvo.status < 300;

  // 3) presença obrigatória: sem a marca de existência do registo não há FOUND,
  //    mesmo com status 200 — a API de disponibilidade do X, por exemplo,
  //    devolve 200 a qualquer nome e o 200 não prova conta nenhuma.
  const tem = (reg.tem ?? []).filter((s) => s && alvo.body.includes(s));
  if (reg.temObrigatorio && !tem.length) {
    return statusOk
      ? { estado: 'UNKNOWN', via: `status ${alvo.status} sem a marca de existência do registo (não confirma nem infirma)` }
      : { estado: 'NOT_FOUND', via: `status ${alvo.status} sem a marca de existência do registo` };
  }

  // 4) cadeias de presença
  if ((reg.tem ?? []).length && tem.length) {
    if ((reg.falta ?? []).length && !alvo.truncado) {
      return { estado: 'FOUND', via: `presença: "${curto(tem[0])}" (sem a marca de ausência)` };
    }
    if (!controlo) return { estado: 'PRECISA_CONTROLO', via: 'presença sem cadeia de ausência: falta o controlo' };
    if ((reg.tem ?? []).some((s) => controlo.body.includes(s))) {
      return { estado: 'UNKNOWN', via: 'a string de presença aparece também no username de controlo' };
    }
    if (bloqueado(controlo)) return { estado: 'UNKNOWN', via: 'controle bloqueado — sem sinal' };
    return { estado: 'FOUND', via: `presença: "${curto(tem[0])}" (controle limpo)` };
  }

  // 5) status parece "existe": nunca se afirma sem o controlo. Um SPA devolve
  //    200 a qualquer nome, e é exactamente isso que o controlo separa.
  if (statusOk) {
    if (!controlo) return { estado: 'PRECISA_CONTROLO', via: `status ${alvo.status}: falta comparar com o controlo` };
    if (bloqueado(controlo)) return { estado: 'UNKNOWN', via: 'controle bloqueado — sem sinal' };
    const ctrlFalta = (reg.falta ?? []).filter((s) => s && controlo.body.includes(s));
    const ctrlOk = reg.ok ? reg.ok.includes(controlo.status) : controlo.status >= 200 && controlo.status < 300;
    if (ctrlFalta.length || controleNaoExiste(reg, controlo)) {
      return { estado: 'FOUND', via: `controlo não existe (status ${controlo.status}) e o alvo devolveu ${alvo.status}` };
    }
    if (ctrlOk) {
      const a = marcador(alvo.body, user);
      const b = marcador(controlo.body, ctrlUser);
      if (a && b) {
        return a === b
          ? { estado: 'UNKNOWN', via: 'conteúdo igual ao do controlo (soft-404: o site devolve 200 a qualquer nome)' }
          : { estado: 'FOUND', via: 'conteúdo do perfil difere do username de controlo' };
      }
      return { estado: 'UNKNOWN', via: 'sem marcadores comparáveis (títulos genéricos ou vazios)' };
    }
    return { estado: 'UNKNOWN', via: `status do controlo ${controlo.status} não diz nada` };
  }

  return { estado: 'UNKNOWN', via: `status ${alvo.status} sem sinal de existência` };
}

function controleNaoExiste(reg: Registo, c: Resposta): boolean {
  if (c.status === 404 || c.status === 410) return true;
  return !((reg.falta ?? []).length || (reg.tem ?? []).length) && reg.faltaStatus?.includes(c.status) === true;
}

// -------------------------------------------------------------------- execução

const CONC = 10;
const TIMEOUT = 8000;
const MAX_BYTES = 1_000_000;
const PRAZO_MS: Record<string, number> = { QUICK: 35_000, FULL: 90_000, CUSTOM: 60_000 };
const AMOSTRA: Record<string, number> = { QUICK: 25, FULL: 600, CUSTOM: 150 };

async function ir(reg: Registo, valor: string): Promise<Resposta> {
  const res = await safeFetch(substitui(reg.tpl, valor), {
    method: reg.metodo,
    headers: reg.headers,
    body: reg.payload ? substitui(reg.payload, valor) : undefined,
    timeoutMs: TIMEOUT,
    maxBytes: MAX_BYTES,
  });
  return { status: res.status, body: res.body, url: res.url, truncado: res.truncated };
}

/** Amostra determinística: espaçada pelo registo ordenado, para não ir tudo ao mesmo sítio. */
export function selecionar(sites: Registo[], n: number): Registo[] {
  const ordenados = [...sites].sort((a, b) => a.site.localeCompare(b.site));
  if (n <= 0) return [];
  if (n >= ordenados.length) return ordenados;
  const passo = ordenados.length / n;
  const out: Registo[] = [];
  for (let i = 0; i < n; i++) out.push(ordenados[Math.min(ordenados.length - 1, Math.floor(i * passo))!]);
  return out;
}

async function avaliar(reg: Registo, user: string, prazo: number): Promise<Veredito> {
  if (reg.re && !reg.re.test(user)) {
    return { estado: 'NOT_FOUND', via: 'o site nem aceita este formato de username' };
  }
  let alvo: Resposta | null = null;
  try { alvo = await ir(reg, user); } catch { alvo = null; }
  if (!alvo) return { estado: 'ERROR', via: 'pedido falhou (rede, DNS ou timeout)' };

  let v = classificar(reg, alvo, undefined, user, '');
  if (v.estado !== 'PRECISA_CONTROLO') return v;

  const ctrlUser = controlePara(reg);
  if (!ctrlUser) return { estado: 'UNKNOWN', via: 'sem username de controlo compatível com o regex do site' };
  if (ctrlUser === user) return { estado: 'UNKNOWN', via: 'o controlo colidiu com o alvo' };
  if (Date.now() > prazo) return { estado: 'UNKNOWN', via: 'orçamento de tempo esgotado antes do controlo' };
  let ctrl: Resposta | null = null;
  try { ctrl = await ir(reg, ctrlUser); } catch { ctrl = null; }
  v = classificar(reg, alvo, ctrl, user, ctrlUser);
  return v.estado === 'PRECISA_CONTROLO' ? { estado: 'UNKNOWN', via: v.via } : v;
}

// ------------------------------------------------------------------- blackbird

function binario(nome: string): Promise<boolean> {
  return new Promise((ok) => {
    // Sem shell do utilizador: nome fixo, sem interpolação de input.
    execFile('sh', ['-c', `command -v ${nome}`], { timeout: 4000 }, (err) => ok(!err));
  });
}

function executar(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((res, rej) => {
    execFile('blackbird', args, { timeout: 60_000, maxBuffer: 8_000_000 }, (err, stdout) => {
      if (err && !stdout) rej(err);
      else res({ stdout: String(stdout), code: err ? 1 : 0 });
    });
  });
}

/**
 * Provider 4: o Blackbird corre como CLI isolado.
 *
 * Não há dados dele para copiar (usa o registo do WhatsMyName e o repositório
 * não tem licença de raiz coerente), por isso só existe o binário — e se não
 * estiver instalado, o estado é `NOT_INSTALLED`, não "0 resultados".
 * Se a saída não for JSON, também não se interpreta: `ERROR` com o motivo.
 */
async function correrBlackbird(user: string, log: SourceLog): Promise<{ estado: EstadoProvider; encontrados: { site: string; url: string }[] }> {
  const origem = 'https://github.com/p1ngul1n0/blackbird';
  if (!(await binario('blackbird'))) {
    log.skipped('p-blackbird', 'Blackbird (CLI isolado)', origem,
      'não instalado — instale o executável `blackbird` no PATH para ativar este provider');
    return { estado: { estado: 'NOT_INSTALLED', nota: 'binário `blackbird` ausente do PATH (provider de CLI, sem dados próprios)' }, encontrados: [] };
  }
  try {
    const t0 = Date.now();
    const { stdout } = await executar(['--username', user, '--json']);
    let dados: unknown;
    try { dados = JSON.parse(stdout); } catch {
      log.error('p-blackbird', 'Blackbird (CLI isolado)', origem, 'saída não estruturada (não é JSON): não interpretada', Date.now() - t0);
      return { estado: { estado: 'ERROR', nota: 'o CLI respondeu com saída que não dá para ler sem adivinhar' }, encontrados: [] };
    }
    const encontrados = extrairSites(dados, user);
    log.ok('p-blackbird', 'Blackbird (CLI isolado)', origem, Date.now() - t0, encontrados.length,
      `executado isoladamente; ${encontrados.length} sites devolveram o username`);
    return { estado: { estado: 'READY', nota: 'CLI instalado e executado isoladamente' }, encontrados };
  } catch (e) {
    log.error('p-blackbird', 'Blackbird (CLI isolado)', origem, `falha ao executar: ${String((e as Error).message).slice(0, 140)}`);
    return { estado: { estado: 'ERROR', nota: 'o CLI não executou' }, encontrados: [] };
  }
}

/** Lê a saída JSON do Blackbird sem inventar formato: só objects com url/name. */
function extrairSites(dados: unknown, user: string): { site: string; url: string }[] {
  const out: { site: string; url: string }[] = [];
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) { for (const x of v) visitar(x); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : typeof o.uri === 'string' ? o.uri : null;
    const nome = typeof o.site === 'string' ? o.site : typeof o.name === 'string' ? o.name : null;
    const existe = o.exists === true || o.found === true || o.status === 'exists';
    if (url && existe) out.push({ site: nome ?? url, url: url.replace('{user}', encodeURIComponent(user)) });
    for (const x of Object.values(o)) if (x && typeof x === 'object') visitar(x);
  };
  visitar(dados);
  return out;
}

// ------------------------------------------------------------------- ferramenta

const ROTULO: Record<ProviderId, string> = {
  sherlock: 'Sherlock', whatsmyname: 'WhatsMyName', maigret: 'Maigret', blackbird: 'Blackbird',
};
const GRUPO_ESTADO: Record<Estado, string> = {
  FOUND: 'encontrado', NOT_FOUND: 'nao-encontrado', UNKNOWN: 'desconhecido',
  ERROR: 'erro', BLOCKED: 'bloqueado',
};
const ORDEM: Estado[] = ['FOUND', 'BLOCKED', 'UNKNOWN', 'ERROR', 'NOT_FOUND'];

/** Contagem honesta do registo: o que se pode usar e o que ficou de fora. */
function notaRegisto(c: { sites: Registo[]; desativados: number; brutos: number }): string {
  const fora = Math.max(0, c.brutos - c.desativados - c.sites.length);
  if (!fora && !c.desativados) return `${c.sites.length} sites no registo`;
  return `${c.sites.length} sites utilizáveis de ${c.brutos} no registo`
    + (c.desativados ? ` (${c.desativados} marcados disabled)` : '')
    + (fora ? `, ${fora} sem URL própria (dependem de motores do próprio registo, que aqui não se emulam)` : '');
}

function normalizaModo(v: unknown): string {
  const m = String(v ?? '').trim().toUpperCase();
  return m === 'FULL' || m === 'CUSTOM' ? m : 'QUICK';
}

function providersEscolhidos(txt: unknown, modo: string): ProviderId[] {
  const todos: ProviderId[] = ['sherlock', 'whatsmyname', 'maigret', 'blackbird'];
  if (modo !== 'CUSTOM') return todos;
  const raw = String(txt ?? '').toLowerCase();
  if (!raw.trim()) return todos;
  const ids = raw.split(/[,\s]+/).filter(Boolean);
  const fora: ProviderId[] = [];
  for (const id of ids) {
    const p = todos.find((t) => t === id || t.startsWith(id.slice(0, 6)));
    if (p && !fora.includes(p)) fora.push(p);
  }
  return fora.length ? fora : todos;
}

registerTool({
  id: 'username-intel',
  name: 'Inteligência de Username',
  category: 'pessoa',
  summary: 'Quatro registos independentes (Sherlock, WhatsMyName, Maigret, Blackbird) sobre o mesmo username.',
  longDesc: 'Cada provider tem o seu registo de sites e a sua forma de decidir: cadeias de ausência/presença do registo, status HTTP e, quando nada decide, comparação com um username de controlo pedido ao mesmo site (metodologia de baseline). Resultado por site com FOUND / NOT_FOUND / UNKNOWN / ERROR / BLOCKED, nunca "é a mesma pessoa". O Blackbird é CLI isolado e só corre se estiver instalado; sem ele o estado é NOT_INSTALLED.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['username', 'osint', 'perfis', 'presenca', 'redes'],
  fields: [
    { name: 'username', label: 'Username', type: 'text', placeholder: 'ex: torvalds', required: true, hint: 'Sem @ nem URL' },
    { name: 'modo', label: 'Modo', type: 'text', placeholder: 'QUICK | FULL | CUSTOM', required: false, hint: 'QUICK = 25 sites por registo; FULL = até 600; CUSTOM = usa os campos abaixo.' },
    { name: 'providers', label: 'Providers (CUSTOM)', type: 'text', placeholder: 'sherlock, whatsmyname, maigret, blackbird', required: false, hint: 'Por omissão, os quatro.' },
    { name: 'limite', label: 'Limite de sites (CUSTOM)', type: 'text', placeholder: 'ex: 120', required: false, hint: 'Máximo 600 sites por execução.' },
  ],
  async run(input) {
    const user = String(input.username ?? '').trim().replace(/^@/, '');
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];

    if (!user || !/^[A-Za-z0-9._-]{1,64}$/.test(user)) {
      out.push(finding('validacao', 'Username', user ? `inválido: "${user}"` : 'em falta',
        [], { kind: 'claim', confidence: 'confirmed' }));
      notes.push('Username aceita letras, números, ponto, hífen e sublinhado (até 64 caracteres). Sem @ nem URL.');
      return { findings: out, log, notes };
    }

    const modo = normalizaModo(input.modo);
    const escolhidos = providersEscolhidos(input.providers, modo);
    const limiteRaw = Number.parseInt(String(input.limite ?? ''), 10);
    const porRegisto = modo === 'CUSTOM'
      ? Number.isFinite(limiteRaw) && limiteRaw > 0 ? Math.min(limiteRaw, 600) : AMOSTRA.CUSTOM
      : AMOSTRA[modo];
    const prazo = Date.now() + PRAZO_MS[modo];

    const estados: Record<ProviderId, EstadoProvider> = {} as Record<ProviderId, EstadoProvider>;
    const contas: Record<string, number> = { FOUND: 0, NOT_FOUND: 0, UNKNOWN: 0, ERROR: 0, BLOCKED: 0 };
    const porEstado: Record<Estado, Finding[]> = { FOUND: [], NOT_FOUND: [], UNKNOWN: [], ERROR: [], BLOCKED: [] };
    let analisados = 0;
    let planeados = 0;
    let cortado = false;
    let desativados = 0;

    for (const prov of escolhidos) {
      if (prov === 'blackbird') {
        const r = await correrBlackbird(user, log);
        estados.blackbird = r.estado;
        for (const s of r.encontrados) {
          porEstado.FOUND.push(sintese('FOUND', s.site, s.url, user, 'p-blackbird', 'CLI instalado', 'confirmed'));
          contas.FOUND++;
        }
        analisados += 0; // o CLI não tem denominador conhecido: não se vende como "sites analisados"
        continue;
      }

      const carregado = carregar(prov);
      const origem = ORIGEM[prov];
      if (carregado.erro) {
        estados[prov] = { estado: 'NOT_CONFIGURED', nota: `registo em falta: ${carregado.erro}` };
        log.error(`p-${prov}`, ROTULO[prov], origem, `registo não lido: ${carregado.erro}`);
        continue;
      }
      desativados += carregado.desativados;
      const amostra = selecionar(carregado.sites, porRegisto);
      planeados += amostra.length;
      const t0 = Date.now();
      let i = 0;
      const conta: Record<Estado, number> = { FOUND: 0, NOT_FOUND: 0, UNKNOWN: 0, ERROR: 0, BLOCKED: 0 };

      const worker = async () => {
        for (;;) {
          if (Date.now() > prazo) { cortado = true; return; }
          const idx = i++;
          if (idx >= amostra.length) return;
          const reg = amostra[idx]!;
          const v = await avaliar(reg, user, prazo);
          const estado = v.estado as Estado;
          conta[estado]++;
          contas[estado]++;
          porEstado[estado].push(sintese(estado, reg.site, substitui(reg.tpl, user), user, `p-${prov}`, v.via,
            estado === 'FOUND' ? 'confirmed' : estado === 'UNKNOWN' ? 'weak' : 'indicated'));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONC, amostra.length) }, worker));

      const feitos = conta.FOUND + conta.NOT_FOUND + conta.UNKNOWN + conta.ERROR + conta.BLOCKED;
      analisados += feitos;
      const ms = Date.now() - t0;
      const resumo = `${feitos}/${amostra.length} sites · ${conta.FOUND} FOUND · ${conta.NOT_FOUND} NOT_FOUND · ${conta.UNKNOWN} UNKNOWN · ${conta.BLOCKED} BLOCKED · ${conta.ERROR} ERROR`;
      if (!feitos) {
        log.empty(`p-${prov}`, ROTULO[prov], origem, ms, cortado ? 'orçamento esgotado antes do primeiro site' : resumo);
        estados[prov] = { estado: 'NOT_EXECUTED', nota: 'nenhum site chegou a ser analisado nesta execução' };
      } else {
        log.ok(`p-${prov}`, ROTULO[prov], origem, ms, feitos, resumo);
        estados[prov] = { estado: 'READY', nota: notaRegisto(carregado) };
      }
      if (feitos < amostra.length) {
        notes.push(`${ROTULO[prov]}: analisados ${feitos} de ${amostra.length} sites da amostra — orçamento de ${Math.round(PRAZO_MS[modo] / 1000)}s esgotado.`);
      }
    }

    // ---------------------------------------------------------------- achados
    out.push(finding('resumo', 'Execução',
      `${modo}: ${analisados} de ${planeados} sites dos 3 registos · ${contas.FOUND} FOUND (registos + CLI) / ${contas.NOT_FOUND} NOT_FOUND / ${contas.UNKNOWN} UNKNOWN / ${contas.BLOCKED} BLOCKED / ${contas.ERROR} ERROR`,
      escolhidos.map((p) => `p-${p}`), { kind: 'fact', confidence: 'confirmed' }));

    for (const prov of escolhidos) {
      const e = estados[prov] ?? { estado: 'NOT_EXECUTED', nota: 'não executado' };
      out.push(finding('provider', ROTULO[prov],
        { provider: prov, estado: e.estado, nota: e.nota },
        [`p-${prov}`], { kind: 'fact', confidence: 'confirmed' }));
    }

    for (const estado of ORDEM) {
      for (const f of porEstado[estado]) out.push(f);
    }

    notes.push(`FOUND = existe uma conta pública com este nome no site indicado. Não significa que seja a mesma pessoa — isso é correlação e fica para o grafo.`);
    if (desativados) notes.push(`${desativados} sites vêm marcados como disabled no registo do Maigret e foram ignorados.`);
    if (escolhidos.includes('blackbird') && estados.blackbird?.estado === 'NOT_INSTALLED') {
      notes.push('Blackbird: não instalado — provider de CLI isolado, sem dados próprios para copiar (ver src/data/registries/THIRD-PARTY.md).');
    }
    notes.push(`Registos: Sherlock MIT, Maigret MIT, WhatsMyName CC BY-SA 4.0 — atribuição em src/data/registries/THIRD-PARTY.md.`);

    return { findings: out, log, notes };
  },
});

function sintese(estado: Estado, site: string, url: string, user: string, fonte: string, via: string, conf: Confidence): Finding {
  return finding(GRUPO_ESTADO[estado], site, {
    platform: site,
    username: user,
    url,
    status: estado,
    source: fonte,
    timestamp: new Date().toISOString(),
    confidence: estado === 'FOUND' ? 'alta' : estado === 'NOT_FOUND' ? 'alta' : estado === 'BLOCKED' ? 'média' : 'nenhuma',
    via,
  }, [fonte], { kind: 'fact', confidence: conf, link: url });
}
