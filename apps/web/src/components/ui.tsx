/**
 * Peças de interface partilhadas: marca, cartões, estados e avisos.
 *
 * Tudo o que aparece em mais do que um ecrã vive aqui — assim o visual não
 * diverge entre a landing, a app e a administração.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Icon } from './Icons';

export { Icon };

// --------------------------------------------------------------------- marca
/**
 * O símbolo: um "A" em duas faixas (prata e azul) dobradas no topo, com uma
 * conexão de três nós no lugar do traço do meio — é o que o ARGOS faz: liga
 * informação pública.
 *
 * A fonte é `public/brand/argos-a.png` (o símbolo da marca);
 * `npm run icons` gera a partir da versão PNG o favicon, os ícones da app e a
 * capa social. O teste `ui.test.mts` confirma que tudo aponta para a mesma fonte.
 */
export function Mark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <img className={className} src="/brand/argos-a-128.png" width={size} height={size}
      alt="ARGOS" decoding="async" draggable={false} />
  );
}

export function Brand({
  size = 30, subtitle = 'Inteligência digital', className,
}: { size?: number; subtitle?: string; className?: string }) {
  return (
    // `brand-plain` é a variante sem a moldura da barra: a landing e o ecrã de
    // login põem a marca dentro de um cabeçalho que já tem a sua.
    <div className={`brand${className ? ' ' + className : ''}`}>
      <Mark size={size} className="brand-logo" />
      <div className="brand-text">
        <div className="brand-name">ARGOS</div>
        <div className="brand-sub">{subtitle}</div>
      </div>
    </div>
  );
}

/**
 * Micro-label do Design System: caixa alta, mono, tracking largo. É o que
 * separa "FONTES E STATUS" de um título qualquer — e é uma classe, não uma
 * repetição de `<span>` em cada ecrã.
 */
export function Micro({ children }: { children: ReactNode }) {
  return <span className="micro">{children}</span>;
}

// -------------------------------------------------------------------- avisos
export type NoteKind = 'info' | 'ok' | 'warn' | 'err';
export function Note({ kind = 'info', children }: { kind?: NoteKind; children: ReactNode }) {
  const Ico = kind === 'err' ? Icon.alert : kind === 'warn' ? Icon.alert : kind === 'ok' ? Icon.check : Icon.info;
  return (
    <div className={`note ${kind === 'info' ? '' : `note-${kind}`}`} role={kind === 'err' ? 'alert' : undefined}>
      <Ico />
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ estados
export function Empty({
  icon, title, children, action,
}: { icon?: (p: Record<string, unknown>) => ReactElement; title: string; children?: ReactNode; action?: ReactNode }) {
  const Ico = icon ?? Icon.search;
  return (
    <div className="empty">
      <div className="empty-ico"><Ico /></div>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, card }: { lines?: number; card?: boolean }) {
  if (card) return <div className="skel skel-card" />;
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skel skel-line" style={{ width: `${94 - i * 13}%` }} />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ n = 6 }: { n?: number }) {
  return <div className="tool-grid">{Array.from({ length: n }).map((_, i) => <div key={i} className="skel skel-card" />)}</div>;
}

// ------------------------------------------------------------------- campos
export function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function SearchInput({
  value, onChange, placeholder, autoFocus, onEnter,
}: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
  return (
    <div className="search">
      <Icon.search />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} aria-label="limpar pesquisa" type="button">
          <Icon.close width={15} height={15} />
        </button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- modal
export function Modal({
  open, onClose, title, children, actions,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="modal-actions">
          <button className="btn btn-quiet" onClick={onClose} type="button">Fechar</button>
          {actions}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- toast
type Toast = { id: number; kind: NoteKind; text: string };
const ToastCtx = createContext<(kind: NoteKind, text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: NoteKind, text: string) => {
    const id = ++seq.current;
    setItems((xs) => [...xs, { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 4200);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => {
          const Ico = t.kind === 'err' ? Icon.alert : t.kind === 'warn' ? Icon.alert : t.kind === 'ok' ? Icon.check : Icon.info;
          return (
            <div key={t.id} className={`toast ${t.kind === 'err' ? 'toast-err' : t.kind === 'ok' ? 'toast-ok' : ''}`}>
              <Ico />
              <span>{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// --------------------------------------------------------------------etiquetas
export function PlanTag({ minPlan, locked }: { minPlan: string; locked?: boolean }) {
  if (minPlan === 'free') return <span className="tag tag-free">GRÁTIS</span>;
  if (minPlan === 'pro_max') return <span className="tag tag-max">PRO MAX</span>;
  return <span className="tag tag-pro">PRO</span>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return <div><div className="v num">{value}</div><div className="l">{label}</div></div>;
}
