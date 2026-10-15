/**
 * Globo do banner do painel.
 *
 * É só ilustração (aria-hidden): o planeta visto de cima, com a malha de
 * latitudes, luzes de cidade e arcos de ligação. Desenhado em SVG para não
 * pedir nenhuma imagem a um servidor de fora (a CSP só deixa `img-src 'self'`)
 * e para escalar sem perder nitidez em ecrãs de alta densidade. Os pontos são
 * gerados por uma semente fixa: o desenho é sempre o mesmo.
 */
const CX = 420, CY = 330, R = 300;

const PONTOS = (() => {
  let x = 41;
  const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const out: { x: number; y: number; r: number; o: number }[] = [];
  while (out.length < 150) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.97;
    const px = CX + Math.cos(a) * d, py = CY + Math.sin(a) * d * 0.9;
    if (py < 330 && py > 40) out.push({ x: px, y: py, r: 0.6 + r() * 1.6, o: 0.35 + r() * 0.6 });
  }
  return out;
})();

const ARCOS: [number, number, number, number][] = [
  [250, 210, 470, 120], [330, 160, 560, 210], [470, 120, 610, 150],
  [210, 290, 330, 160], [560, 210, 650, 280], [380, 250, 520, 290],
];

export default function Globo() {
  return (
    <svg className="globo" viewBox="0 0 760 330" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="globo-mar" cx="45%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F6F6F8" />
          <stop offset="100%" stopColor="#ECECEF" />
        </radialGradient>
        <radialGradient id="globo-ar" cx="50%" cy="50%" r="50%">
          <stop offset="86%" stopColor="#D3121B" stopOpacity="0" />
          <stop offset="96%" stopColor="#D3121B" stopOpacity=".18" />
          <stop offset="100%" stopColor="#D3121B" stopOpacity="0" />
        </radialGradient>
        <clipPath id="globo-corte"><circle cx={CX} cy={CY} r={R} /></clipPath>
      </defs>
      <circle cx={CX} cy={CY} r={R + 26} fill="url(#globo-ar)" />
      <circle cx={CX} cy={CY} r={R} fill="url(#globo-mar)" />
      <g clipPath="url(#globo-corte)" fill="none" stroke="#D3121B" strokeOpacity=".16" strokeWidth="1">
        {[0.25, 0.5, 0.75].map((k) => <ellipse key={`la${k}`} cx={CX} cy={CY} rx={R} ry={R * k} />)}
        {[0.2, 0.45, 0.7, 0.92].map((k) => <ellipse key={`lo${k}`} cx={CX} cy={CY} rx={R * k} ry={R} />)}
      </g>
      <g clipPath="url(#globo-corte)">
        {PONTOS.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#D3121B" opacity={p.o} />)}
        {ARCOS.map(([x1, y1, x2, y2], i) => (
          <path key={i} d={`M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.min(y1, y2) - 70} ${x2} ${y2}`}
            fill="none" stroke="#121214" strokeOpacity=".35" strokeWidth="1.3" />
        ))}
        {ARCOS.map(([x1, y1], i) => <circle key={`n${i}`} cx={x1} cy={y1} r="2.6" fill="#D3121B" />)}
      </g>
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#D4D4DA" strokeOpacity="1" strokeWidth="1.5" />
    </svg>
  );
}
