/**
 * Mapa de conexões do painel.
 *
 * Um resumo do grafo da investigação mais recente, não um segundo motor de
 * grafo: o alvo ao centro, os nós descobertos à volta por salto, e as
 * ligações que o servidor guardou. Tudo vem de `/api/investigations/:id` —
 * sem sessão guardada o painel diz que está vazio em vez de desenhar um
 * exemplo.
 *
 * Para explorar a sério (zoom, detalhe do nó, busca) a pessoa abre a sessão,
 * que usa o `GraphView` completo. Os rótulos de tipo são os do `GraphView`.
 */
import { useMemo } from 'react';
import type { ReactElement, SVGProps } from 'react';
import type { GraphEdge, GraphNode, InvestigationDetail } from '../api';
import { TYPE_LABEL } from './GraphView';
import { Icon } from './Icons';

const W = 760;
const H = 420;
/** Acima disto o resumo vira uma mancha: o resto conta-se na legenda. */
const MAX_NOS = 14;

const ORDEM_CONF: Record<string, number> = { confirmed: 0, corroborated: 1, indicated: 2, weak: 3 };

/** Cor saturada por tipo — a mesma no nó e na legenda. */
export const COR_TIPO: Record<string, string> = {
  pessoa: '#D3121B', username: '#D3121B', conta: '#3F3F46', email: '#E0525A',
  telefone: '#E0525A', dominio: '#71717A', ip: '#71717A', servico: '#71717A',
  empresa: '#121214', socio: '#121214', endereco: '#52525B', documento: '#3F3F46',
  hashtag: '#A16207', wallet: '#A16207', breach: '#B00F17', cve: '#B00F17',
  pacote: '#52525B', portfolio: '#71717A',
};
const corDe = (t: string) => COR_TIPO[t] ?? '#52525B';

type Ico = (p: SVGProps<SVGSVGElement>) => ReactElement;
const ICONE_TIPO: Record<string, Ico> = {
  pessoa: Icon.user, username: Icon.user, socio: Icon.user, conta: Icon.link, email: Icon.mail,
  telefone: Icon.phone, dominio: Icon.globe, portfolio: Icon.globe, ip: Icon.server, servico: Icon.server,
  empresa: Icon.building, endereco: Icon.target, documento: Icon.file, hashtag: Icon.hash,
  breach: Icon.shield, cve: Icon.shield, wallet: Icon.coins, pacote: Icon.code,
};
const iconeDe = (t: string): Ico => ICONE_TIPO[t] ?? Icon.layers;

const corte = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Estrelas do fundo: fixas (semente), para o desenho não tremer a cada render. */
const ESTRELAS = (() => {
  let x = 7;
  const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 70 }, () => ({ cx: r() * W, cy: r() * H, r: 0.5 + r() * 1.2, o: 0.15 + r() * 0.5 }));
})();

function posicoes(nos: GraphNode[]) {
  const cx = W / 2, cy = H / 2 - 6;
  const centro = nos.find((n) => n.hop === 0) ?? nos[0];
  const resto = nos.filter((n) => n !== centro);
  const m = new Map<string, { x: number; y: number; n: GraphNode }>();
  if (centro) m.set(centro.id, { x: cx, y: cy, n: centro });
  // Um anel; os nós de salto maior ficam mais longe dentro do mesmo anel.
  const passo = (Math.PI * 2) / Math.max(1, resto.length);
  resto.forEach((n, i) => {
    const a = -Math.PI / 2 + passo / 2 + i * passo;
    const k = n.hop > 1 ? 1.1 : 0.92;
    m.set(n.id, { x: cx + Math.cos(a) * 290 * k, y: cy + Math.sin(a) * 140 * k, n });
  });
  return m;
}

export default function MapaConexoes({ detalhe }: { detalhe: InvestigationDetail }) {
  const { nos, arestas, legenda, total } = useMemo(() => {
    const todos = Array.isArray(detalhe.nodes) ? detalhe.nodes : [];
    const escolhidos = [...todos]
      .sort((a, b) => a.hop - b.hop || (ORDEM_CONF[a.confidence] ?? 9) - (ORDEM_CONF[b.confidence] ?? 9))
      .slice(0, MAX_NOS);
    const ids = new Set(escolhidos.map((n) => n.id));
    const ars: GraphEdge[] = (Array.isArray(detalhe.edges) ? detalhe.edges : [])
      .filter((e) => ids.has(e.from) && ids.has(e.to));
    const cont = new Map<string, number>();
    for (const n of todos) if (n.hop > 0) cont.set(n.type, (cont.get(n.type) ?? 0) + 1);
    return {
      nos: escolhidos,
      arestas: ars,
      legenda: [...cont.entries()].sort((a, b) => b[1] - a[1]),
      total: todos.length,
    };
  }, [detalhe]);

  const pos = useMemo(() => posicoes(nos), [nos]);

  return (
    <div className="mapa">
      <svg className="mapa-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Grafo de ${detalhe.investigation.seed}: ${total} nós e ${detalhe.edges?.length ?? 0} ligações`}>
        <defs>
          <radialGradient id="mapa-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#D3121B" stopOpacity=".55" />
            <stop offset="100%" stopColor="#D3121B" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mapa-centro" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4FB0FF" />
            <stop offset="100%" stopColor="#1B6EF3" />
          </linearGradient>
        </defs>
        {ESTRELAS.map((e, i) => <circle key={i} cx={e.cx} cy={e.cy} r={e.r} fill="#6FC0FF" opacity={e.o} />)}
        {arestas.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <line key={i} className="mapa-aresta" data-conf={e.confidence}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          );
        })}
        {nos.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const centro = n.hop === 0;
          const I = iconeDe(n.type);
          const nome = corte(n.value || n.label);
          if (centro) {
            return (
              <g key={n.id} className="mapa-no" data-centro="true">
                <circle cx={p.x} cy={p.y} r={70} fill="url(#mapa-halo)" />
                <circle cx={p.x} cy={p.y} r={36} fill="none" stroke="#D3121B" strokeOpacity=".55" strokeWidth={2} />
                <circle cx={p.x} cy={p.y} r={29} fill="url(#mapa-centro)" />
                <I x={p.x - 15} y={p.y - 15} width={30} height={30} color="#FFFFFF" strokeWidth={1.9} />
                <text className="mapa-txt mapa-txt-centro" x={p.x} y={p.y + 58} textAnchor="middle">{corte(n.value || n.label, 30)}</text>
                <title>{`${TYPE_LABEL[n.type] ?? n.type}: ${n.value || n.label}`}</title>
              </g>
            );
          }
          const esquerda = p.x < W / 2 - 4;
          const tx = p.x + (esquerda ? -26 : 26);
          return (
            <g key={n.id} className="mapa-no">
              <circle cx={p.x} cy={p.y} r={19} fill={corDe(n.type)} stroke="#FFFFFF" strokeWidth={3} />
              <I x={p.x - 10} y={p.y - 10} width={20} height={20} color="#FFFFFF" strokeWidth={1.9} />
              <text className="mapa-txt" x={tx} y={p.y - 2} textAnchor={esquerda ? 'end' : 'start'}>{nome}</text>
              <text className="mapa-txt-sub" x={tx} y={p.y + 15} textAnchor={esquerda ? 'end' : 'start'}>
                {TYPE_LABEL[n.type] ?? n.type}
              </text>
              <title>{`${TYPE_LABEL[n.type] ?? n.type}: ${n.value || n.label}`}</title>
            </g>
          );
        })}
      </svg>
      {legenda.length > 0 && (
        <ul className="mapa-legenda" aria-label="Nós por tipo">
          {legenda.map(([tipo, n]) => (
            <li key={tipo} className="mapa-chip">
              <i style={{ background: corDe(tipo) }} />
              {TYPE_LABEL[tipo] ?? tipo}
              <b>{n}</b>
            </li>
          ))}
        </ul>
      )}
      {total > MAX_NOS && (
        <p className="t-xs dim">A mostrar {MAX_NOS} de {total} nós — abre a sessão para o grafo completo.</p>
      )}
    </div>
  );
}
