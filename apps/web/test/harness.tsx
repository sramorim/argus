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

export { useEffect, createElement as el, ToastHost };
