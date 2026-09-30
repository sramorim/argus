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
export function Mark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="ARGUS">
      <defs>
        <linearGradient id="argus-pupil" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#DC2626" />
          <stop offset="1" stopColor="#B91C1C" />
        </linearGradient>
        <linearGradient id="argus-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14171C" />
          <stop offset="1" stopColor="#0B0D10" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6.9" fill="url(#argus-bg)" />
      <circle cx="16" cy="16" r="13.7" fill="none" stroke="#C8CDD4" strokeOpacity=".34" strokeWidth="1.4" />
      <path d="M4.4 16C7.5 11.6 11.5 9.3 16 9.3s8.5 2.3 11.6 6.7c-3.1 4.4-7.1 6.7-11.6 6.7S7.5 20.4 4.4 16Z"
        fill="none" stroke="#C8CDD4" strokeOpacity=".95" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="6.2" fill="none" stroke="#C8CDD4" strokeOpacity=".8" strokeWidth="1.1" />
      <circle cx="16" cy="16" r="3.2" fill="url(#argus-pupil)" />
      <circle cx="18.3" cy="13.7" r="1.05" fill="#F5F7FA" fillOpacity=".85" />
    </svg>
  );
}

export function Brand({ size = 30, subtitle = 'Fontes abertas' }: { size?: number; subtitle?: string }) {
  return (
    <div className="brand">
      <Mark size={size} className="brand-logo" />
      <div className="brand-text">
        <div className="brand-name">ARGUS</div>
        <div className="brand-sub">{subtitle}</div>
      </div>
    </div>
  );
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
