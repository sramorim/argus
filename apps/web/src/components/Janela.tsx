/**
 * Janela do espaço de trabalho.
 *
 * A ferramenta abre **dentro de uma janela**, não numa página que substitui a
 * anterior: é isso que permite ter o domínio e o IP abertos ao mesmo tempo e
 * comparar os dois sem perder o que já se tinha escrito. A janela tem a barra
 * de título com os três controlos (minimizar, maximizar, fechar), arrasta-se
 * pela barra e redimensiona-se por qualquer aresta.
 *
 * A geometria vive no `AppShell` (é ela que manda para o histórico e para a
 * barra de tarefas); aqui só se arrasta e redimensiona, sempre limitado à área
 * de trabalho — uma janela que se pode perder para fora do ecrã é uma janela
 * perdida.
 *
 * Em ecrãs estreitos a janela ocupa a área toda (regra no CSS): o arrasto não
 * faz sentido num telemóvel, e o botão de fechar é o caminho de volta.
 */
import type { CSSProperties, PointerEvent as RPointerEvent, ReactElement, ReactNode } from 'react';
import type { SVGProps } from 'react';
import { motion } from 'framer-motion';
import { Icon } from './Icons';

export interface Geom { x: number; y: number; w: number; h: number }

const limite = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export default function Janela({
  titulo, icone: Ico, geom, espaco, z, ativa, max, min,
  onFocar, onFechar, onMin, onMax, onGeom, children,
}: {
  titulo: string;
  icone: (p: SVGProps<SVGSVGElement>) => ReactElement;
  geom: Geom;
  /** Tamanho da área de trabalho: o que define até onde se pode arrastar. */
  espaco: { w: number; h: number };
  z: number;
  ativa: boolean;
  max: boolean;
  min: boolean;
  onFocar: () => void;
  onFechar: () => void;
  onMin: () => void;
  onMax: () => void;
  onGeom: (g: Geom) => void;
  children: ReactNode;
}) {
  const arrastar = (e: RPointerEvent<HTMLElement>, modo: 'mover' | 'e' | 's' | 'se') => {
    // Um clique num botão da barra de título não pode começar um arrasto.
    if (max || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    onFocar();

    const x0 = e.clientX, y0 = e.clientY, g0 = { ...geom };
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let g: Geom;
      if (modo === 'mover') {
        g = {
          ...g0,
          x: limite(g0.x + dx, 0, Math.max(0, espaco.w - 140)),
          y: limite(g0.y + dy, 0, Math.max(0, espaco.h - 56)),
        };
      } else {
        g = { ...g0 };
        if (modo === 'e') g.w = limite(g0.w + dx, 420, Math.max(420, espaco.w - g0.x));
        if (modo === 's') g.h = limite(g0.h + dy, 300, Math.max(300, espaco.h - g0.y));
        if (modo === 'se') {
          g.w = limite(g0.w + dx, 420, Math.max(420, espaco.w - g0.x));
          g.h = limite(g0.h + dy, 300, Math.max(300, espaco.h - g0.y));
        }
      }
      onGeom(g);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('arrastando');
    };
    document.body.classList.add('arrastando');
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  const estilo = {
    '--wx': `${geom.x}px`, '--wy': `${geom.y}px`,
    '--ww': `${geom.w}px`, '--wh': `${geom.h}px`,
    zIndex: z,
  } as CSSProperties;

  return (
    <motion.section
      className="janela"
      data-ativa={ativa ? 'true' : 'false'}
      data-max={max ? 'true' : 'false'}
      data-min={min ? 'true' : 'false'}
      style={estilo}
      aria-label={titulo}
      onPointerDown={onFocar}
      /* A posição vem de `--wx/--wy` no CSS, por isso aqui só mexemos em
         transform e opacidade: os dois nunca escreve a mesma propriedade. */
      initial={{ opacity: 0, scale: 0.93, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.93, y: 10 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.7 }}
      whileFocus={{ scale: 1.004 }}
    >
      <motion.header
        className="win-title"
        onPointerDown={(e) => arrastar(e, 'mover')}
        onDoubleClick={onMax}
        /* Enquanto não está em foco, a barra de título recua um pouco — é o
           que dá a noção de que a janela está ao fundo. */
        animate={{ opacity: ativa ? 1 : 0.72 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <Ico className="win-ico" />
        <span className="win-name">{titulo}</span>
        <div className="win-btns">
          <button className="win-btn" type="button" onClick={onMin} title="Minimizar" aria-label={`Minimizar ${titulo}`}>
            <Icon.minimize />
          </button>
          <motion.button
            className="win-btn"
            type="button"
            onClick={onMax}
            title={max ? 'Restaurar' : 'Maximizar'}
            aria-label={`${max ? 'Restaurar' : 'Maximizar'} ${titulo}`}
            aria-pressed={max}
            whileHover={{ scale: 1.14 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          >
            {max ? <Icon.restore /> : <Icon.maximize />}
          </motion.button>
          <motion.button
            className="win-btn win-close"
            type="button"
            onClick={onFechar}
            title="Fechar"
            aria-label={`Fechar ${titulo}`}
            whileHover={{ scale: 1.14, background: 'var(--erro-dim)', color: 'var(--erro)' }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          >
            <Icon.close />
          </motion.button>
        </div>
      </motion.header>

      <div className="win-body">{children}</div>

      {!max && (['e', 's', 'se'] as const).map((d) => (
        <i
          key={d}
          className={`win-rs rs-${d}`}
          role="presentation"
          onPointerDown={(e) => arrastar(e, d)}
        />
      ))}
    </motion.section>
  );
}
