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

export { useEffect, createElement as el, ToastHost, AppShell };
export const GRUPOS = ia.GRUPOS;
export const VISTAS = ia.VISTAS;
export const ATALHOS = ia.ATALHOS;
export const buscar = ia.buscar;
export const porGrupo = ia.porGrupo;

/**
 * Rede falsa com o catálogo real, para os testes de UI montarem a app sem
 * servidor. As 26 ferramentas e os 7 grupos vêm do próprio código: se a
 * arquitectura de informação mudar, os testes mudam com ela.
 */
export function stubApi(so: Record<string, unknown> = {}) {
  const ferramentas = [
    ['graph-investigation', 'Investigação (Grafo)', 'investigar', 'free', 'Correlaciona as ferramentas e monta o grafo.'],
    ['username-finder', 'Localizador de Username', 'identidade', 'free', 'Procura o username em várias plataformas.'],
    ['email-analyzer', 'Analisador de Email', 'identidade', 'free', 'Verifica MX, disposable e reputação.'],
    ['phone-analyzer', 'Analisador de Telefone', 'identidade', 'free', 'E.164, país, DDD e validação.'],
    ['dorks-generator', 'Gerador de Dorks', 'identidade', 'free', 'Gera consultas de pesquisa.'],
    ['github-osint', 'GitHub OSINT', 'social', 'free', 'Perfil, repositórios e atividade.'],
    ['telegram-osint', 'Telegram OSINT', 'social', 'pro', 'Canal, inscritos e descrição.'],
    ['url-scanner', 'Scanner de URL', 'web', 'free', 'Estado HTTP, headers e título.'],
    ['web-crawler', 'Rastreador Web', 'web', 'free', 'robots.txt e páginas.'],
    ['metadata-extractor', 'Extrator de Metadados', 'web', 'free', 'EXIF e metadados de PDF.'],
    ['reverse-image', 'Análise de Imagem', 'web', 'pro', 'pHash e distância de Hamming.'],
    ['domain-analyzer', 'Analisador de Domínio', 'infra', 'free', 'RDAP, DNS e subdomínios.'],
    ['ip-analyzer', 'Analisador de IP', 'infra', 'free', 'Geo, ASN e portas.'],
    ['tls-audit', 'Auditoria TLS', 'infra', 'free', 'Certificado e validade.'],
    ['port-scanner', 'Scanner de Portas', 'infra', 'pro', 'Passivo, via InternetDB.'],
    ['asn-lookup', 'Consulta de ASN', 'infra', 'free', 'Dados de ASN e WHOIS.'],
    ['reputation-check', 'Verificador de Reputação', 'seguranca', 'pro', 'Blocklists e feeds de ameaça.'],
    ['hash-analyzer', 'Analisador de Hash', 'seguranca', 'free', 'Algoritmo e exposição.'],
    ['cve-lookup', 'Consulta de CVE', 'seguranca', 'free', 'NVD e CIRCL.'],
    ['package-audit', 'Auditoria de Pacotes', 'seguranca', 'free', 'Vulns via OSV.'],
    ['password-check', 'Verificador de Password', 'seguranca', 'free', 'k-anonymity nos vazamentos.'],
    ['paste-search', 'Exposição Pública', 'seguranca', 'pro', 'Busca em sites de paste.'],
    ['crypto-tracer', 'Rastreador Crypto', 'fontes', 'free', 'Saldo e transações.'],
    ['geo-lookup', 'Geo Lookup', 'fontes', 'free', 'Geocode e reverse.'],
    ['zipcode-br', 'Consulta de CEP', 'fontes', 'free', 'CEP com duas fontes.'],
    ['company-br', 'Consulta de Empresa', 'fontes', 'free', 'CNPJ e QSA.'],
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
