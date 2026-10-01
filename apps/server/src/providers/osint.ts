/**
 * Providers do OSINT Engine (FASE C).
 *
 * Cinco ferramentas que o ARGOS NÃO escreveu, cada uma com a sua licença, o seu
 * método de instalação e a sua forma de invocação documentada no repositório
 * oficial. Este ficheiro é só declaração — quem executa é `runtime.ts`, que o
 * faz sem shell, com env mínima, tempo e saída limitados.
 *
 * Estados honestos, sem exceções:
 *
 *   NOT_INSTALLED   não há binário/caminho  → nota com o comando de instalação
 *   NOT_CONFIGURED  falta configuração      → nota com o nome EXATO do que falta
 *   INCOMPATIBLE    o alvo não é deste tipo → nota com os tipos que ele aceita
 *   ERROR           correu e falhou         → stderr real, truncado
 *   READY           correu e devolveu algo  → a saída é a evidência
 *
 * Nenhum destes cinco está instalado no ambiente do ARGOS e isso não é um
 * problema a esconder: é o estado normal, e é o que a ferramenta devolve.
 *
 * Licenças (execução como processo separado não incorpora o nosso código):
 *   SpiderFoot MIT · OpenOSINT MIT · Photon GPL-3.0 · Holehe GPL-3.0 · GHunt AGPL-3.0
 * O GHunt, por ser AGPL, é ainda mais sensível de nunca ser compilado/nem
 * importado — só invocado por argv.
 */
import type { CliSaida } from './runtime.ts';
import type { FindingValue } from '../net/provenance.ts';

export type TipoAlvo = 'email' | 'dominio' | 'ip' | 'username';
export type EstadoProvider = 'READY' | 'NOT_INSTALLED' | 'NOT_CONFIGURED' | 'INCOMPATIBLE' | 'ERROR';

export interface Item {
  rotulo: string;
  valor: FindingValue;
}

export interface ProviderOsint {
  id: string;
  nome: string;
  licenca: string;
  repo: string;
  /** Que alvos aceita. */
  tipos: TipoAlvo[];
  /** Comando oficial de instalação, copiado do repositório. */
  instalacao: string;
  /** Executável no PATH. `null` → o programa entra por `envCaminho`. */
  binario: string | null;
  /** Variável que guarda o caminho (script que não é instalado no PATH). */
  envCaminho: string | null;
  /** O caminho é um script Python (o executável passa a ser `python3`). */
  python: boolean;
  /** Exige login/credencial prévia antes de conseguir correr. */
  requerLogin?: string;
  /** argv não-interativo para este alvo (puro, sem shell). */
  args: (alvo: string, tipo: TipoAlvo, tmp: string) => string[];
  /** Saída → itens. `null` = saída não interpretada (não se inventa o conteúdo). */
  interpretar: (saida: string) => { itens: Item[] | null; nota: string };
}

// ------------------------------------------------------------------ parsers

function jsonQualquer(txt: string): unknown | null {
  const t = txt.trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* segue */ }
  // JSON Lines / NDJSON (SpiderFoot escreve assim em algumas versões)
  const linhas = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const itens: unknown[] = [];
  for (const l of linhas) {
    try { itens.push(JSON.parse(l)); } catch { return null; }
  }
  return itens.length ? itens : null;
}

function aItens(v: unknown): Item[] {
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    if (v.every((x) => typeof x === 'string')) return v.map((s) => ({ rotulo: 'valor', valor: s }));
    return v.map((x, i) => ({
      rotulo: `registo #${i + 1}`,
      valor: (typeof x === 'object' && x !== null ? x : { valor: x }) as FindingValue,
    }));
  }
  if (typeof v === 'object' && v !== null) {
    return [{ rotulo: 'objeto', valor: v as FindingValue }];
  }
  return [{ rotulo: 'valor', valor: v as FindingValue }];
}

function saidaJson(txt: string): { itens: Item[] | null; nota: string } {
  const v = jsonQualquer(txt);
  if (v === null) return { itens: null, nota: 'saída não é JSON legível (não é inventado conteúdo a partir de texto bruto)' };
  const itens = aItens(v);
  return { itens, nota: itens.length ? '' : 'JSON válido sem registos' };
}

function saidaLinhas(txt: string): { itens: Item[] | null; nota: string } {
  const linhas = txt.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return { itens: null, nota: 'sem linhas de saída' };
  return { itens: linhas.map((l) => ({ rotulo: 'linha', valor: l })), nota: '' };
}

/** Texto que não é JSON: fica como evidência bruta, sem classificação nossa. */
function saidaTexto(txt: string): { itens: Item[] | null; nota: string } {
  const t = txt.trim();
  if (!t) return { itens: null, nota: 'sem saída' };
  return {
    itens: [{ rotulo: 'saída de texto do programa (bruta)', valor: t }],
    nota: 'saída de texto: fica tal e qual como evidência, sem a re-classificarmos aqui',
  };
}

// --------------------------------------------------------------- definições

export const PROVIDERS: ProviderOsint[] = [
  {
    id: 'spiderfoot',
    nome: 'SpiderFoot',
    licenca: 'MIT',
    repo: 'https://github.com/smicallef/spiderfoot',
    tipos: ['dominio', 'ip'],
    instalacao: 'git clone https://github.com/smicallef/spiderfoot && pip3 install -r spiderfoot/requirements.txt',
    binario: null,
    envCaminho: 'ARGUS_SPIDERFOOT',
    python: true,
    args: (alvo, _tipo) => ['-s', alvo, '-o', 'json'],
    interpretar: saidaJson,
  },
  {
    id: 'photon',
    nome: 'Photon',
    licenca: 'GPL-3.0',
    repo: 'https://github.com/s0md3v/Photon',
    tipos: ['dominio'],
    instalacao: 'git clone https://github.com/s0md3v/Photon && pip3 install -r Photon/requirements.txt',
    binario: null,
    envCaminho: 'ARGUS_PHOTON',
    python: true,
    args: (alvo) => ['-u', alvo, '--stdout'],
    interpretar: saidaLinhas,
  },
  {
    id: 'openosint',
    nome: 'OpenOSINT',
    licenca: 'MIT',
    repo: 'https://github.com/OpenOSINT/OpenOSINT',
    tipos: ['username', 'email'],
    instalacao: 'pip install openosint',
    binario: 'openosint',
    envCaminho: null,
    python: false,
    args: (alvo, tipo) => [tipo === 'email' ? 'email' : 'username', alvo, '--json'],
    interpretar: saidaJson,
  },
  {
    id: 'ghunt',
    nome: 'GHunt',
    licenca: 'AGPL-3.0',
    repo: 'https://github.com/mxrch/GHunt',
    tipos: ['email'],
    instalacao: 'pipx install ghunt',
    binario: 'ghunt',
    envCaminho: null,
    python: false,
    requerLogin: 'requer autenticação prévia: corra `ghunt login` uma vez (o ARGOS não guarda contas Google)',
    args: (alvo, _tipo, tmp) => ['email', alvo, '--json', tmp],
    interpretar: saidaJson,
  },
  {
    id: 'holehe',
    nome: 'Holehe',
    licenca: 'GPL-3.0',
    repo: 'https://github.com/megadose/holehe',
    tipos: ['email'],
    instalacao: 'pip3 install holehe',
    binario: 'holehe',
    envCaminho: null,
    python: false,
    args: (alvo) => [alvo],
    interpretar: saidaTexto,
  },
];

export const TIPOS_DE_ALVO = new Set<TipoAlvo>(['email', 'dominio', 'ip', 'username']);

/** Deteção de tipo. Só classifica o que é inequívoco; o resto é username. */
export function detectarTipo(bruto: string): TipoAlvo {
  const a = bruto.trim();
  if (a.includes('@')) return 'email';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(a)) return 'ip';
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(a) && !a.includes(' ')) return 'dominio';
  return 'username';
}

/**
 * O que falta, ANTES de tocar a qualquer processo. Puro: lê só `env`.
 * Quem devolve `PRONTO` ainda pode falhar na existência do binário — isso é
 * verificado depois, com `existe()`.
 */
export type Planejo =
  | { estado: 'INCOMPATIBLE'; nota: string }
  | { estado: 'NOT_CONFIGURED'; nota: string }
  | { estado: 'PRONTO'; executavel: string; args: string[] };

export function planejar(
  p: ProviderOsint, alvo: string, tipo: TipoAlvo, tmp: string, env: NodeJS.ProcessEnv = process.env,
): Planejo {
  if (!p.tipos.includes(tipo)) {
    return { estado: 'INCOMPATIBLE', nota: `só aceita alvos do tipo ${p.tipos.join(' / ')}` };
  }
  const args = p.args(alvo, tipo, tmp);
  if (p.binario) return { estado: 'PRONTO', executavel: p.binario, args };
  const nome = p.envCaminho ?? '';
  const caminho = (env[nome] ?? '').trim();
  if (!caminho) {
    return {
      estado: 'NOT_CONFIGURED',
      nota: `defina ${nome} com o caminho de ${p.id} (instale: ${p.instalacao})`,
    };
  }
  return { estado: 'PRONTO', executavel: p.python ? 'python3' : caminho, args: p.python ? [caminho, ...args] : args };
}

/** Trata a saída de um processo que correu (sucesso ou não). */
export function classificar(p: ProviderOsint, saida: CliSaida, textoExtra?: string): {
  estado: EstadoProvider; nota: string; itens: Item[];
} {
  const texto = textoExtra ?? saida.stdout;
  if (saida.estado === 'nao-instalado') {
    return { estado: 'NOT_INSTALLED', nota: `${saida.nota} (instale: ${p.instalacao})`, itens: [] };
  }
  if (saida.estado === 'timeout') {
    return { estado: 'ERROR', nota: saida.nota, itens: [] };
  }
  // Falhou por falta de login/credencial → não é "erro", é configuração em falta.
  const combinado = `${saida.stdout}\n${saida.stderr}`;
  if (p.requerLogin && /(^|\W)(login|log in|unauthori[sz]ed|not authenticated|401|credential)/i.test(combinado)) {
    return { estado: 'NOT_CONFIGURED', nota: p.requerLogin, itens: [] };
  }
  if (!saida.stdout.trim() && saida.stderr.trim()) {
    return { estado: 'ERROR', nota: `stderr: ${saida.stderr.trim().slice(0, 400)}`, itens: [] };
  }
  const inter = p.interpretar(texto);
  if (!inter.itens) {
    return { estado: 'ERROR', nota: inter.nota, itens: [] };
  }
  if (!inter.itens.length) {
    return { estado: 'READY', nota: 'correu sem registos (nada encontrado)', itens: [] };
  }
  return { estado: 'READY', nota: inter.nota, itens: inter.itens };
}
