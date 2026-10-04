/**
 * Abertura da aplicação.
 *
 * O ecrã de entrada é a primeira coisa que alguém vê, e é onde a ARGOS se
 * apresenta: antes de aparecer uma tabela de resultados há um radar a varrer,
 * uma linha a escrever-se e a barra a encher. Ao fim, o ecrã parte-se ao meio
 * e a aplicação entra por trás.
 *
 * Duas decisões que valem mais do que a animação:
 *
 * 1. **A barra não mente.** Ela avança com o tempo mas trava nos 90% enquanto
 *    o servidor não responder. Um `100%` que depois fica hanging seria pior do
 *    que não haver barra nenhuma.
 * 2. **O tempo tem um mínimo.** Houve um atraso entre a resposta e a pintura do
 *    painel que deixava a abertura a piscar. O `MIN_MS` segura o ecrã tempo
 *    suficiente para a sequência ser lida, mas nunca mais do que isso.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const TITULO = 'A INICIAR ARQUITECTURA DE INTELIGÊNCIA...';
const MIN_MS = 2400;
const TRAVA = 90;

/** As linhas entram uma a uma, à medida que a barra passa cada marca. */
const ETAPAS = [
  { em: 12, texto: 'a estabelecer ligação segura…' },
  { em: 32, texto: 'a carregar fontes de inteligência…' },
  { em: 54, texto: 'a mapear marcadores ativos…' },
  { em: 74, texto: 'a inicializar camadas OSINT/HUMINT/IMINT…' },
  { em: 93, texto: 'sistema pronto.' },
];

export default function LoadingScreen({
  pronto, onComplete,
}: {
  /** O servidor já respondeu? A barra só chega ao fim quando isto é verdade. */
  pronto: boolean;
  onComplete: () => void;
}) {
  const [progresso, setProgresso] = useState(0);
  const [escrito, setEscrito] = useState('');
  const [esperou, setEsperou] = useState(false);
  const [aAbrir, setAAbrir] = useState(false);
  const [fora, setFora] = useState(false);
  const inicio = useRef(0);
  const aoAbrir = useRef(onComplete);
  aoAbrir.current = onComplete;

  // A linha escreve-se sozinha, ao ritmo de leitura — não ao ritmo da barra.
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setEscrito(TITULO.slice(0, i));
      if (i >= TITULO.length) clearInterval(t);
    }, 42);
    return () => clearInterval(t);
  }, []);

  // O relógio do mínimo. Separado do progresso de propósito: se o servidor
  // responder cedo, a barra já está no fim mas a revelação tem de esperar na
  // mesma — e o progresso, já no alvo, deixa de mexer no estado.
  useEffect(() => {
    const t = setTimeout(() => setEsperou(true), MIN_MS);
    return () => clearTimeout(t);
  }, []);

  /* O progresso é o mais lento dos dois: avança sozinho, trava nos 90% e só
     completa quando o servidor disse que está tudo cá. */
  useEffect(() => {
    inicio.current = performance.now();
    let raf = 0;
    const passo = () => {
      const t = performance.now() - inicio.current;
      const alvo = pronto ? 100 : Math.min((t / MIN_MS) * 100, TRAVA);
      setProgresso((p) => {
        // Aproximação suave: a barra não dá saltos, mesmo quando o alvo muda.
        const proximo = p + (alvo - p) * 0.12;
        return Math.abs(proximo - alvo) < 0.4 ? alvo : proximo;
      });
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [pronto]);

  /* A revelação só arranca com as três coisas certas: o servidor respondeu, o
     mínimo passou e a barra chegou ao fim. O `liberado` garante que isto
     corre uma vez só, mesmo que o componente se redesenhe entretanto. */
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
          <div className="boot-radar">
            {[1, 0.68, 0.36].map((escala, i) => (
              <motion.i
                key={escala}
                className="boot-anel"
                style={{
                  width: 132 * escala, height: 132 * escala,
                  borderColor: `rgba(46,155,255,${0.16 + i * 0.09})`,
                }}
                animate={{ scale: [1, 1.045, 1], opacity: [1, 0.72, 1] }}
                transition={{
                  duration: 3.2, repeat: Infinity, ease: 'easeInOut',
                  delay: i * 0.42,
                }}
              />
            ))}
            <span className="animate-radar-sweep boot-sweep" />
            <span className="boot-nucleo" />
            {[
              { top: '20%', left: '68%' },
              { top: '58%', left: '30%' },
              { top: '40%', left: '75%' },
              { top: '72%', left: '60%' },
            ].map((p, i) => (
              <span
                key={i}
                className="boot-blip"
                style={{
                  ...p,
                  animation: `radar-ping 2.6s ${i * 0.65}s ease-out infinite`,
                }}
              />
            ))}
          </div>

          <div className="boot-titulo">
            <p className="boot-sobre">SISTEMA DE INTELIGÊNCIA MULTI-FONTE</p>
            <h1 className="boot-linha">
              {escrito}
              <span className="boot-cursor" />
            </h1>
          </div>

          <div className="boot-barra">
            <div className="boot-barra-topo">
              <span>A CARREGAR FONTES</span>
              <span className="boot-pct">{Math.round(progresso)}%</span>
            </div>
            <div className="boot-trilho">
              <i
                className="boot-cheio"
                style={{ width: `${progresso}%`, boxShadow: '0 0 14px var(--blue-glow-strong)' }}
              />
            </div>
          </div>

          <ul className="boot-etapas">
            {ETAPAS.map(({ em, texto }) => {
              const feito = progresso >= em;
              return (
                <li key={texto} className="boot-etapa" data-feito={feito ? 'true' : 'false'}>
                  <span className="boot-marca">{feito ? '✓' : '○'}</span>
                  <span>{texto}</span>
                </li>
              );
            })}
          </ul>
        </motion.div>
      )}
    </div>
  );
}
