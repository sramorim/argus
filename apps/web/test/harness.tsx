/**
 * Harness de UI: o que é montado pelos testes.
 *
 * Fica num ficheiro próprio porque o `node --test` não sabe compilar TSX. O
 * `ui.test.mts` compila este ficheiro com esbuild e importa o resultado, depois
 * de já ter instalado o DOM — o react-dom guarda uma referência ao `document`
 * no momento em que é avaliado, por isso a ordem importa.
 *
 * Reproduz o padrão de todas as páginas reais: `useToast()` + um botão que
 * dispara um aviso.
 */
import { useEffect } from 'react';
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ToastHost, useToast } from '../src/components/ui';
import AppShell from '../src/pages/AppShell';
import * as ia from '../src/ia';

type Aviso = (kind: 'info' | 'ok' | 'warn' | 'err', texto: string) => void;

/** O `useToast` da última `BotaoAviso` montada — é assim que o teste dispara. */
let atual: Aviso = () => {};

/**
 * Dispara o aviso dentro de `act()`: sem isto o React avisa que houve uma
 * atualização de estado fora do ciclo de render, e a asserção corre antes de o
 * DOM ter mudado.
 */
export function disparAviso(kind: 'info' | 'ok' | 'warn' | 'err' = 'ok') {
  act(() => { atual(kind, 'guardado'); });
}

export function monta(children: ReactNode) {
  const caixa = document.createElement('div');
  document.body.appendChild(caixa);
  const root = createRoot(caixa);
  act(() => { root.render(children); });
  return {
    caixa,
    html: () => caixa.innerHTML,
    texto: () => caixa.textContent ?? '',
    desmontar: () => act(() => { root.unmount(); caixa.remove(); }),
  };
}

/** Uma página mínima, igual ao que as 8 páginas fazem. */
export function BotaoAviso() {
  const toast = useToast() as unknown as Aviso;
  atual = toast;
  return createElement('button', { type: 'button' }, 'guardar');
}

/**
 * Monta a aplicação inteira (o mesmo `main.tsx`) para confirmar que o
 * `ToastHost` está lá dentro. Se alguém o tirar de lá, isto deixa de funcionar.
 */
export function montaApp() {
  const caixa = document.createElement('div');
  caixa.id = 'root';
  document.body.appendChild(caixa);
  const root = createRoot(caixa);
  act(() => { root.render(createElement(ToastHost, null, createElement(BotaoAviso))); });
  return {
    html: () => caixa.innerHTML,
    texto: () => caixa.textContent ?? '',
    desmontar: () => act(() => { root.unmount(); caixa.remove(); }),
  };
}

/**
 * Clica num elemento montado, dentro de `act()`: sem isto o estado não é
 * atualizado antes de o teste voltar a ler o HTML, e a asserção lê o ecrã
 * anterior ao clique.
 */
export function clica(raiz: { caixa: Element }, seletor: string) {
  const alvo = raiz.caixa.querySelector(seletor);
  if (!alvo) throw new Error(`não encontrei "${seletor}" no ecrã`);
  act(() => { (alvo as unknown as HTMLElement).click(); });
  return alvo;
}

export { useEffect, createElement as el, ToastHost, AppShell };
export const GRUPOS = ia.GRUPOS;
export const VISTAS = ia.VISTAS;
export const ATALHOS = ia.ATALHOS;
export const buscar = ia.buscar;
export const porGrupo = ia.porGrupo;

/**
 * Rede falsa com o catálogo real, para os testes de UI montarem a app sem
 * servidor. As 9 ferramentas e os 7 grupos vêm do próprio código: se a
 * arquitectura de informação mudar, os testes mudam com ela.
 */
export function stubApi(so: Record<string, unknown> = {}) {
  const ferramentas = [
    ['graph-investigation', 'Investigação (Grafo)', 'investigar', 'free', 'Correlaciona as ferramentas e monta o grafo.'],
    ['username-finder', 'Localizador de Username', 'identidade', 'free', 'Procura o username em várias plataformas.'],
    ['username-intel', 'Inteligência de Username', 'identidade', 'free', 'Quatro registos independentes sobre o mesmo username.'],
    ['social-search', 'Busca por Nome nas Redes', 'social', 'pro', 'Perfis públicos que mencionam um nome.'],
    ['datalikers', 'DataLikers', 'social', 'pro', 'Perfis, publicações e seguidores de Instagram e TikTok.'],
    ['osint-engine', 'OSINT Engine', 'osint', 'free', 'SpiderFoot, Photon, OpenOSINT, GHunt e Holehe isolados.'],
    ['apify', 'APIFY', 'apify', 'free', 'Actors do Apify (Instagram, TikTok, Facebook, X).'],
    ['paste-search', 'Exposição Pública', 'exposicao', 'pro', 'Busca em sites de paste.'],
    ['domain-infra', 'Infraestrutura de Domínio', 'infraestrutura', 'free', 'RDAP, DNS público e CT de um domínio.'],
  ] as const;

  const tools = ferramentas.map(([id, name, category, minPlan, summary]) => ({
    id, name, category, summary, longDesc: summary + ' Explicação mais longa da ferramenta.',
    minPlan, fields: [{ name: 'alvo', label: 'Alvo', type: 'text', required: true }],
    freeTier: minPlan === 'free', legalGate: 'none', tags: [category],
    lock: minPlan === 'free' ? 'open' : 'locked', dailyRuns: 15, maxItems: 25,
  }));

  const body = (url: string) => {
    if (url.includes('/api/contact')) {
      return { whatsapp: '5547997876098', label: 'WhatsApp (47) 99787-6098', link: 'https://wa.me/5547997876098', marca: 'SR. Amorim', autor: 'Daniel Senhor Amorim', autorLink: null, copyright: '© 2026 SR. Amorim' };
    }
    if (url.includes('/api/me')) {
      return { user: so.user ?? null, usage: so.user ? { today: 2, daily: 15, concurrent: 1, inflight: 0 } : undefined };
    }
    if (url.includes('/api/tools')) return { tools, plan: 'free', usage: null };
    if (url.includes('/api/plans')) return { plans: so.plans ?? [] };
    if (url.includes('/api/investigations')) return { investigations: so.investigations ?? [] };
    if (url.includes('/api/historico')) return { runs: so.runs ?? [] };
    return {};
  };

  (globalThis as any).fetch = async (url: string) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(body(String(url))),
    json: async () => body(String(url)),
    headers: { getSetCookie: () => [] },
  });
  return tools;
}
