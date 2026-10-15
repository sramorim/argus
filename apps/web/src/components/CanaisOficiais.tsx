/**
 * Canais oficiais da marca, para os rodapés.
 *
 * A lista vem do servidor (`/api/contact`), tal como o WhatsApp: trocar um
 * @ é uma variável de ambiente, não um rebuild. Enquanto o servidor não
 * responde, não se mostra nada — melhor nenhum link do que um link errado.
 */
import type { Contacto } from '../api';

export function CanaisOficiais({ contacto, titulo = true }: { contacto: Contacto | null; titulo?: boolean }) {
  // Um servidor mais antigo só manda o WhatsApp: mostra-se esse, que é sempre certo.
  const canais = contacto?.canais?.length
    ? contacto.canais
    : contacto ? [{ id: 'whatsapp', nome: 'WhatsApp', rotulo: contacto.label, url: contacto.link }] : [];
  if (canais.length === 0) return null;
  return (
    <nav className="canais-oficiais" aria-label="Canais oficiais">
      {titulo && <span className="canais-titulo">Canais oficiais</span>}
      <ul>
        {canais.map((c) => (
          <li key={c.id}>
            <a href={c.url} target="_blank" rel="noopener noreferrer" title={`${c.nome} · ${c.rotulo}`}>
              {c.nome}
            </a>
          </li>
        ))}
        {/* O X já tem lugar no rodapé; o link entra quando houver conta (ARGUS_X no servidor). */}
        {!canais.some((c) => c.id === 'x') && (
          <li><span className="canal-breve" aria-label="X (em breve)" title="X — em breve">X</span></li>
        )}
      </ul>
    </nav>
  );
}
