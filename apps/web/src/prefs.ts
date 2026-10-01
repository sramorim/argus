/**
 * Preferências locais — guardadas APENAS neste navegador.
 *
 * A regra do produto: **tudo o que é local tem de estar rotulado como local.**
 * Estas opções nunca saem daqui (localStorage, sem cookie, sem pedido à rede)
 * e por isso a interface tem de as marcar como "guardado neste navegador" —
 * um utilizador tem de poder distinguir o que o servidor sabe do que é só
 * disposição deste aparelho.
 *
 * O valor é escrito no `<html>` como atributo `data-*`, que é onde o CSS lê.
 * Assim a preferência continua a valer depois de recarregar a página, sem que
 * nenhum componente precise de a repassar por props.
 */

export type Densidade = 'confortavel' | 'compacta';
export type Alternado = 'sim' | 'nao';

export interface Preferencias {
  /** Altura das linhas das tabelas. */
  densidade: Densidade;
  /** Linhas alternadas nas tabelas. */
  zebra: Alternado;
}

const CHAVE = 'argos.preferencias';

export const PRE_DEFINIDAS: Preferencias = { densidade: 'confortavel', zebra: 'nao' };

const DENSIDADES: Densidade[] = ['confortavel', 'compacta'];
const ALTERNADOS: Alternado[] = ['sim', 'nao'];

function ler(): Preferencias {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return { ...PRE_DEFINIDAS };
    const o = JSON.parse(bruto) as Partial<Preferencias>;
    return {
      densidade: DENSIDADES.includes(o.densidade as Densidade) ? (o.densidade as Densidade) : PRE_DEFINIDAS.densidade,
      zebra: ALTERNADOS.includes(o.zebra as Alternado) ? (o.zebra as Alternado) : PRE_DEFINIDAS.zebra,
    };
  } catch {
    // Sem localStorage (modo privado, corrida fora do browser): o padrão vale.
    return { ...PRE_DEFINIDAS };
  }
}

let cache: Preferencias = ler();

/** As preferências atuais. */
export function preferencias(): Preferencias {
  return cache;
}

/** Escreve uma preferência em localStorage e no `<html>`. */
export function guardar<K extends keyof Preferencias>(chave: K, valor: Preferencias[K]): Preferencias {
  cache = { ...cache, [chave]: valor };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cache));
  } catch {
    // Só memória: a preferência vale até fechar a aba, e a interface assume-o.
  }
  aplicar();
  return cache;
}

/** Copia as preferências para atributos `data-*` do documento. */
export function aplicar(): void {
  try {
    const raiz = document.documentElement;
    raiz.dataset.densidade = cache.densidade;
    raiz.dataset.zebra = cache.zebra;
  } catch {
    // Sem DOM: nada a aplicar (o módulo continua utilizável noutro contexto).
  }
}

// Aplica-se no arranque: quem importa este módulo já fica com o ecrã no estado
// guardado, sem precisar de um efeito por componente.
aplicar();
