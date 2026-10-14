/**
 * Abertura da aplicação (splash).
 *
 * Primeira tela que alguém vê: a marca ARGOS centrada, a frase da marca e uma
 * barra a carregar. Ao fim, o ecrã parte-se ao meio e a aplicação entra por
 * trás.
 *
 * Duas decisões que valem mais do que a animação:
 *  1. **A barra não mente.** Avança com o tempo mas trava nos 90% enquanto o
 *     servidor não responder.
 *  2. **O tempo tem um mínimo** (`MIN_MS`), para a abertura não piscar.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const MIN_MS = 2400;
const TRAVA = 90;

export default function LoadingScreen({
  pronto, onComplete,
}: {
  /** O servidor já respondeu? A barra só chega ao fim quando isto é verdade. */
  pronto: boolean;
  onComplete: () => void;
}) {
  const [progresso, setProgresso] = useState(0);
  const [esperou, setEsperou] = useState(false);
  const [aAbrir, setAAbrir] = useState(false);
  const [fora, setFora] = useState(false);
  const inicio = useRef(0);
  const aoAbrir = useRef(onComplete);
  aoAbrir.current = onComplete;

  // O relógio do mínimo, separado do progresso.
  useEffect(() => {
    const t = setTimeout(() => setEsperou(true), MIN_MS);
    return () => clearTimeout(t);
  }, []);

  /* O progresso avança sozinho, trava nos 90% e só completa quando o servidor
     disse que está tudo cá. */
  useEffect(() => {
    inicio.current = performance.now();
    let raf = 0;
    const passo = () => {
      const t = performance.now() - inicio.current;
      const alvo = pronto ? 100 : Math.min((t / MIN_MS) * 100, TRAVA);
      setProgresso((p) => {
        const proximo = p + (alvo - p) * 0.12;
        return Math.abs(proximo - alvo) < 0.4 ? alvo : proximo;
      });
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [pronto]);

  /* A revelação arranca com as três coisas certas: servidor respondeu, mínimo
     passou e a barra chegou ao fim. Corre uma vez só. */
  const liberado = useRef(false);
  useEffect(() => {
    if (liberado.current || !pronto || !esperou || progresso < 99.5) return;
    liberado.current = true;
    setAAbrir(true);
    const t = setTimeout(() => {
      setFora(true);
      aoAbrir.current();
    }, 640);
    return () => clearTimeout(t);
  }, [pronto, esperou, progresso]);

  if (fora) return null;

  return (
    <div className="boot" role="status" aria-live="polite" aria-label="A carregar a ARGOS">
      <div className="boot-grid" />
      <div className="scanline-overlay boot-scan" />

      {aAbrir ? (
        <div className="boot-split">
          <motion.i
            className="boot-half"
            initial={{ x: 0 }}
            animate={{ x: '-101%' }}
            transition={{ duration: 0.62, ease: [0.76, 0, 0.24, 1] }}
          />
          <motion.i
            className="boot-half"
            initial={{ x: 0 }}
            animate={{ x: '101%' }}
            transition={{ duration: 0.62, ease: [0.76, 0, 0.24, 1] }}
          />
        </div>
      ) : (
        <motion.div
          className="boot-corpo"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 26 }}
        >
          <div className="boot-brand">
            <span className="boot-halo" aria-hidden />
            <img className="boot-mark" src="/brand/argos-a-128.png" width={112} height={112} alt="" />
            <div className="boot-name">ARGOS</div>
            <div className="boot-sub">SOCIAL INTELLIGENCE</div>
          </div>

          <p className="boot-tagline">Informação revela<br />novas perspectivas.</p>

          <div className="boot-barra">
            <div className="boot-trilho">
              <i className="boot-cheio" style={{ width: `${progresso}%`, boxShadow: '0 0 14px var(--blue-glow-strong)' }} />
            </div>
          </div>

          <p className="boot-load">Carregando o ARGOS…</p>
        </motion.div>
      )}
    </div>
  );
}
