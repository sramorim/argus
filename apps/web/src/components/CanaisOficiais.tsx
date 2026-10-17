/**
 * Canais oficiais da marca, para os rodapés — só ícones, sem texto.
 *
 * A lista vem do servidor (`/api/contact`), tal como o WhatsApp: trocar um
 * @ é uma variável de ambiente, não um rebuild. Enquanto o servidor não
 * responde, não se mostra nada — melhor nenhum link do que um link errado.
 */
import type { ReactElement } from 'react';
import type { Contacto } from '../api';

const BASE = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONES: Record<string, ReactElement> = {
  whatsapp: (
    <svg {...BASE}><path d="M4 20l1.2-3.6A8 8 0 1 1 8.4 18.8z" /></svg>
  ),
  telegram: (
    <svg {...BASE}><path d="M21 4L3 11l6 2 2 6 3-4 5 4z" /><path d="M9 13l10-8" /></svg>
  ),
  instagram: (
    <svg {...BASE}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  facebook: (
    <svg {...BASE}><path d="M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V10H5.5v3H8v8h3v-8h2.6l.4-3H11V8a1 1 0 0 1 1-1h3z" /></svg>
  ),
  x: (
    <svg {...BASE}><path d="M4 4l16 16M20 4L4 20" /></svg>
  ),
};

export function CanaisOficiais({ contacto }: { contacto: Contacto | null; titulo?: boolean }) {
  // Um servidor mais antigo só manda o WhatsApp: mostra-se esse, que é sempre certo.
  const canais = contacto?.canais?.length
    ? contacto.canais
    : contacto ? [{ id: 'whatsapp', nome: 'WhatsApp', rotulo: contacto.label, url: contacto.link }] : [];
  if (canais.length === 0) return null;
  return (
    <nav className="canais-oficiais" aria-label="Canais oficiais">
      <ul>
        {canais.map((c) => (
          <li key={c.id}>
            <a href={c.url} target="_blank" rel="noopener noreferrer" title={c.nome} aria-label={c.nome}>
              {ICONES[c.id] ?? c.nome}
            </a>
          </li>
        ))}
        {/* O X entra quando houver conta (ARGUS_X no servidor); até lá fica discreto. */}
        {!canais.some((c) => c.id === 'x') && (
          <li><span className="canal-breve" title="X — em breve" aria-label="X em breve">{ICONES.x}</span></li>
        )}
      </ul>
    </nav>
  );
}
