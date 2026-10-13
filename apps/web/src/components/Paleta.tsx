/**
 * Busca global (Ctrl/⌘+K).
 *
 * Um só sítio para chegar a qualquer coisa que a app já tem: as vistas, as
 * ferramentas do catálogo real (pela mesma `buscar()` do `ia.ts`) e os
 * módulos independentes. Não procura dados de alvos — isso é trabalho das
 * ferramentas — e por isso nunca mostra um "resultado" que não exista: sem
 * correspondência, diz que não encontrou.
 *
 * Teclado: ↑/↓ mudam a seleção, Enter abre, Escape fecha.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, SVGProps } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ToolPublic, User } from '../api';
import { Icon, CATEGORY_ICON } from './Icons';
import { VISTAS, FERRAMENTA_POR_ID, buscar } from '../ia';
import { MODULOS } from '../pages/ToolPage';
import type { View } from '../pages/AppShell';

interface Item {
  chave: string;
  titulo: string;
  sub: string;
  secao: 'Navegação' | 'Ferramentas';
  icone: (p: SVGProps<SVGSVGElement>) => ReactElement;
  pro: boolean;
  vista: View;
}

export default function Paleta({
  tools, user, onIr, onFechar,
}: {
  tools: ToolPublic[]; user: User; onIr: (v: View) => void; onFechar: () => void;
}) {
  const [termo, setTermo] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suave = useReducedMotion();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const itens = useMemo<Item[]>(() => {
    const n = termo.trim().toLowerCase();
    const vistas: Item[] = VISTAS
      .filter((v) => user.isAdmin || v.id !== 'admin')
      .filter((v) => !n || v.nome.toLowerCase().includes(n))
      .map((v) => ({
        chave: `v:${v.id}`, titulo: v.nome, sub: 'Abrir', secao: 'Navegação',
        icone: v.icon, pro: false, vista: { k: v.id } as View,
      }));
    const ferramentas: Item[] = buscar(tools, termo).map((t) => ({
      chave: `t:${t.id}`, titulo: t.name,
      sub: FERRAMENTA_POR_ID[t.id]?.grupo.nome ?? t.summary,
      secao: 'Ferramentas', icone: CATEGORY_ICON[t.category] ?? Icon.grid,
      pro: t.lock === 'locked', vista: { k: 'tool', id: t.id },
    }));
    const modulos: Item[] = Object.entries(MODULOS)
      .filter(([, m]) => !n || m.titulo.toLowerCase().includes(n))
      .map(([id, m]) => ({
        chave: `m:${id}`, titulo: m.titulo, sub: 'Módulo', secao: 'Ferramentas',
        icone: m.icone, pro: false, vista: { k: 'tool', id },
      }));
    return [...vistas, ...ferramentas, ...modulos];
  }, [termo, tools, user.isAdmin]);

  useEffect(() => { setSel(0); }, [termo]);

  const abrir = (i: Item | undefined) => { if (i) { onIr(i.vista); onFechar(); } };

  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onFechar(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(itens.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); abrir(itens[sel]); }
  };

  useEffect(() => {
    document.getElementById(`paleta-op-${sel}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);

  let secaoAnterior = '';
  return (
    <div className="paleta-scrim" onClick={onFechar}>
      <motion.div
        className="paleta"
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={tecla}
        initial={suave ? false : { opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
        <div className="paleta-campo">
          <Icon.search />
          <input
            ref={inputRef}
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Procurar ferramenta ou ecrã… (ex.: username, domínio)"
            aria-controls="paleta-lista"
            aria-activedescendant={itens[sel] ? `paleta-op-${sel}` : undefined}
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="paleta-esc" type="button" onClick={onFechar} aria-label="Fechar busca">Esc</button>
        </div>
        {itens.length === 0 ? (
          <div className="paleta-vazio">Nada encontrado para “{termo}”.</div>
        ) : (
          <ul className="paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados">
            {itens.map((it, i) => {
              const cab = it.secao !== secaoAnterior ? it.secao : null;
              secaoAnterior = it.secao;
              const Ico = it.icone;
              return (
                <li key={it.chave} role="presentation">
                  {cab && <div className="paleta-secao micro">{cab}</div>}
                  <button
                    id={`paleta-op-${i}`}
                    className="paleta-item"
                    type="button"
                    role="option"
                    aria-selected={i === sel}
                    data-chave={it.chave}
                    onMouseMove={() => setSel(i)}
                    onClick={() => abrir(it)}
                  >
                    <span className="paleta-ico"><Ico /></span>
                    <span className="paleta-txt">
                      <span className="paleta-titulo">{it.titulo}</span>
                      <span className="paleta-sub">{it.sub}</span>
                    </span>
                    {it.pro && <span className="tag tag-pro">PRO</span>}
                    <Icon.chevronRight className="paleta-seta" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="paleta-rodape">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> fechar</span>
        </div>
      </motion.div>
    </div>
  );
}
