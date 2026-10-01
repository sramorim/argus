/**
 * Conjunto de ícones do ARGOS.
 *
 * Um traço, uma espessura, uma grelha: todos 24×24, `currentColor`, com
 * `stroke-linecap: round`. É o que faz a interface parecer uma só coisa. Os
 * glifos unicode (◍ ⬡ ⚠ ◎ ▤ ₿) que existiam antes davam um ar de "dashboard
 * genérico" e não redimensionavam — daí a substituição.
 */
import type { ReactElement, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const Icon = {
  grid: (p: P) => (<svg {...base(p)}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>),
  network: (p: P) => (<svg {...base(p)}><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" /><path d="M10.6 6.9 6.4 15.9M13.4 6.9l4.2 9M7.4 18h9.2" /></svg>),
  crown: (p: P) => (<svg {...base(p)}><path d="M3 8.5l3.6 2.6L12 4.5l5.4 6.6L21 8.5l-1.6 9.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8Z" /></svg>),
  key: (p: P) => (<svg {...base(p)}><circle cx="8" cy="14" r="3.6" /><path d="m10.6 11.4 7-7M15.4 6.6l2 2M17.6 4.4l2 2" /></svg>),
  user: (p: P) => (<svg {...base(p)}><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" /></svg>),
  shield: (p: P) => (<svg {...base(p)}><path d="M12 3.2 19 6v5.4c0 4.3-2.8 7.7-7 9.4-4.2-1.7-7-5.1-7-9.4V6Z" /><path d="m9.2 12.2 2 2 3.6-3.8" /></svg>),
  globe: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.6" /><path d="M3.6 12h16.8M12 3.4c2.2 2.3 3.3 5.3 3.3 8.6s-1.1 6.3-3.3 8.6c-2.2-2.3-3.3-5.3-3.3-8.6S9.8 5.7 12 3.4Z" /></svg>),
  server: (p: P) => (<svg {...base(p)}><rect x="3.2" y="4" width="17.6" height="6" rx="1.6" /><rect x="3.2" y="14" width="17.6" height="6" rx="1.6" /><path d="M6.6 7h.01M6.6 17h.01" /></svg>),
  bug: (p: P) => (<svg {...base(p)}><path d="M8.5 8.5 7 6.2M15.5 8.5 17 6.2M5 12H3M21 12h-2M5.4 16.5 3.4 17.6M18.6 16.5l2 1.1M9 5.4h6v3.2a3 3 0 0 1-6 0Z" /><rect x="9" y="13.4" width="6" height="7" rx="3" /></svg>),
  link: (p: P) => (<svg {...base(p)}><path d="M10.2 13.8a3.7 3.7 0 0 0 5.4 0l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.3 1.3" /><path d="M13.8 10.2a3.7 3.7 0 0 0-5.4 0l-2.6 2.6a3.7 3.7 0 0 0 5.2 5.2l1.3-1.3" /></svg>),
  file: (p: P) => (<svg {...base(p)}><path d="M13.4 3.4H7.2a1.8 1.8 0 0 0-1.8 1.8v13.6a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V8.4Z" /><path d="M13.4 3.4v5h5.2" /></svg>),
  code: (p: P) => (<svg {...base(p)}><path d="m8.6 8.4-4 3.6 4 3.6M15.4 8.4l4 3.6-4 3.6M13.4 5.4l-2.8 13.2" /></svg>),
  coins: (p: P) => (<svg {...base(p)}><ellipse cx="12" cy="6.4" rx="7" ry="2.8" /><path d="M5 6.4v5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-5" /><path d="M5 11.4v5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-5" /></svg>),
  phone: (p: P) => (<svg {...base(p)}><rect x="6.4" y="2.6" width="11.2" height="18.8" rx="2.4" /><path d="M10.6 5.4h2.8" /></svg>),
  mail: (p: P) => (<svg {...base(p)}><rect x="2.8" y="5" width="18.4" height="14" rx="2.2" /><path d="m3.4 6.6 8.6 6 8.6-6" /></svg>),
  hash: (p: P) => (<svg {...base(p)}><path d="M5 9.4h14M5 14.6h14M9.6 4l-1.8 16M16.2 4l-1.8 16" /></svg>),
  image: (p: P) => (<svg {...base(p)}><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.2" /><circle cx="8.6" cy="9.8" r="1.6" /><path d="m3.6 16.6 4.6-4.2 4 3.4 3.2-2.6 5 4.2" /></svg>),
  lock: (p: P) => (<svg {...base(p)}><rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2.2" /><path d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4" /></svg>),
  search: (p: P) => (<svg {...base(p)}><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.2 4.2" /></svg>),
  close: (p: P) => (<svg {...base(p)}><path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" /></svg>),
  minimize: (p: P) => (<svg {...base(p)}><path d="M6 17.4h12" /></svg>),
  maximize: (p: P) => (<svg {...base(p)}><rect x="5.4" y="5.4" width="13.2" height="13.2" rx="1.6" /></svg>),
  restore: (p: P) => (<svg {...base(p)}><rect x="4.6" y="7.6" width="11" height="11" rx="1.6" /><path d="M8 4.6h9.4a2 2 0 0 1 2 2v9.4" /></svg>),
  menu: (p: P) => (<svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>),
  chevronRight: (p: P) => (<svg {...base(p)}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></svg>),
  chevronDown: (p: P) => (<svg {...base(p)}><path d="m5.5 9.5 6.5 6.5 6.5-6.5" /></svg>),
  arrowLeft: (p: P) => (<svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>),
  check: (p: P) => (<svg {...base(p)}><path d="m4.8 12.6 4.6 4.6 9.8-10.4" /></svg>),
  alert: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.6" /><path d="M12 7.6v5.2M12 16.2h.01" /></svg>),
  info: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.6" /><path d="M12 11v5.2M12 7.8h.01" /></svg>),
  eye: (p: P) => (<svg {...base(p)}><path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12Z" /><circle cx="12" cy="12" r="2.9" /></svg>),
  clock: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.6" /><path d="M12 7.2V12l3.2 2" /></svg>),
  trash: (p: P) => (<svg {...base(p)}><path d="M4.6 6.6h14.8M9.4 6.6V4.8h5.2v1.8M6.6 6.6l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12.2" /></svg>),
  plus: (p: P) => (<svg {...base(p)}><path d="M12 5.4v13.2M5.4 12h13.2" /></svg>),
  download: (p: P) => (<svg {...base(p)}><path d="M12 3.8v10.6M8 10.8l4 4 4-4M4.6 19.4h14.8" /></svg>),
  copy: (p: P) => (<svg {...base(p)}><rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2" /><path d="M15.6 5.6V5a1.4 1.4 0 0 0-1.4-1.4H5A1.4 1.4 0 0 0 3.6 5v9.2A1.4 1.4 0 0 0 5 15.6h.6" /></svg>),
  settings: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="2.9" /><path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1A1.9 1.9 0 1 1 7.9 3.6l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V2.3a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1Z" /></svg>),
  logout: (p: P) => (<svg {...base(p)}><path d="M9.6 20.4H6.4a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h3.2M15.4 16.6l4.6-4.6-4.6-4.6M20 12H9" /></svg>),
  zoomIn: (p: P) => (<svg {...base(p)}><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.2 4.2M10.8 8.4v4.8M8.4 10.8h4.8" /></svg>),
  zoomOut: (p: P) => (<svg {...base(p)}><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.2 4.2M8.4 10.8h4.8" /></svg>),
  target: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="3.6" /><path d="M12 1.8v2.6M12 19.6v2.6M22.2 12h-2.6M4.4 12H1.8" /></svg>),
  upload: (p: P) => (<svg {...base(p)}><path d="M12 15.4V4.6M8 8.4l4-4 4 4M4.6 19.4h14.8" /></svg>),
  layers: (p: P) => (<svg {...base(p)}><path d="m12 3 8.6 4.6L12 12.2 3.4 7.6Z" /><path d="m3.4 12.4 8.6 4.6 8.6-4.6M3.4 16.8 12 21.4l8.6-4.6" /></svg>),
  database: (p: P) => (<svg {...base(p)}><ellipse cx="12" cy="6" rx="7.4" ry="2.9" /><path d="M4.6 6v12c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9V6" /><path d="M4.6 12c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9" /></svg>),
  activity: (p: P) => (<svg {...base(p)}><path d="M3 12.4h4l2.4-6 4.2 12 2.4-6h5" /></svg>),
  building: (p: P) => (<svg {...base(p)}><path d="M4.6 20.4V4.6h9v15.8M13.6 10h5.8v10.4M3 20.4h18" /><path d="M7.2 8h1.4M11 8h1.4M7.2 11.4h1.4M11 11.4h1.4M7.2 14.8h1.4M11 14.8h1.4M16 13.4h1.2M16 16.8h1.2" /></svg>),
  history: (p: P) => (<svg {...base(p)}><path d="M3.4 12a8.6 8.6 0 1 0 2.6-6.1" /><path d="M3.2 4.6v4.2h4.2M12 7.6V12l3 1.8" /></svg>),
  star: (p: P) => (<svg {...base(p)}><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8Z" /></svg>),
};

/** Ícone por categoria de ferramenta — a mesma grelha, a mesma espessura. */
export const CATEGORY_ICON: Record<string, (p: P) => ReactElement> = {
  pessoa: Icon.user,
  infra: Icon.server,
  ameaca: Icon.shield,
  web: Icon.globe,
  arquivo: Icon.file,
  financeiro: Icon.coins,
  dev: Icon.code,
  br: Icon.building,
  geo: Icon.target,
};

export const CATEGORY_LABEL: Record<string, string> = {
  pessoa: 'Pessoas e identidade', infra: 'Infraestrutura', ameaca: 'Ameaças', web: 'Web',
  arquivo: 'Ficheiros', financeiro: 'Financeiro', dev: 'Desenvolvimento',
  br: 'Brasil', geo: 'Geolocalização',
};

export const CATEGORY_ORDER = ['pessoa', 'infra', 'ameaca', 'dev', 'br', 'web', 'geo', 'arquivo', 'financeiro'];

export default Icon;
