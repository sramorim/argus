/**
 * Mapa de conexões do painel.
 *
 * Um resumo do grafo da investigação mais recente, não um segundo motor de
 * grafo: o alvo ao centro, os nós descobertos em anéis por salto, e as
 * ligações que o servidor guardou. Tudo vem de `/api/investigations/:id` —
 * sem sessão guardada o mapa diz que está vazio em vez de desenhar um exemplo.
 *
 * Para explorar a sério (zoom, detalhe do nó, busca) a pessoa abre a sessão,
 * que usa o `GraphView` completo. Por isso as cores e os rótulos de tipo são
 * os do `GraphView`: o resumo e o grafo inteiro dizem a mesma coisa.
 */
import { useMemo } from 'react';
import type { GraphEdge, GraphNode, InvestigationDetail } from '../api';
import { NODE_COLOR, TYPE_LABEL } from './GraphView';

const W = 640;
const H = 360;
/** Acima disto o resumo vira uma mancha: mostra-se o resto pela legenda. */
const MAX_NOS = 22;
/** Só os nós mais perto do centro levam nome, para o texto não se sobrepor. */
const MAX_ROTULOS = 8;

const ORDEM_CONF: Record<string, number> = { confirmed: 0, corroborated: 1, indicated: 2, weak: 3 };

const corte = (s: string, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function posicoes(nos: GraphNode[]) {
  const cx = W / 2, cy = H / 2;
  const centro = nos.find((n) => n.hop === 0) ?? nos[0];
  const resto = nos.filter((n) => n !== centro);
  const porHop = new Map<number, GraphNode[]>();
  for (const n of resto) {
    const h = Math.max(1, n.hop);
    if (!porHop.has(h)) porHop.set(h, []);
    porHop.get(h)!.push(n);
  }
  const hops = [...porHop.keys()].sort((a, b) => a - b);
  const m = new Map<string, { x: number; y: number; n: GraphNode }>();
  if (centro) m.set(centro.id, { x: cx, y: cy, n: centro });
  hops.forEach((h, i) => {
    const lista = porHop.get(h)!;
    const raio = hops.length === 1 ? 128 : 96 + (i / (hops.length - 1)) * 70;
    const passo = (Math.PI * 2) / lista.length;
    const desvio = -Math.PI / 2 + i * 0.5;
    lista.forEach((n, j) => {
      const a = desvio + j * passo;
      // Elipse: o cartão é largo e baixo.
      m.set(n.id, { x: cx + Math.cos(a) * raio * 1.7, y: cy + Math.sin(a) * raio * 0.95, n });
    });
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
  const comNome = new Set(nos.slice(0, MAX_ROTULOS + 1).map((n) => n.id));

  return (
    <div className="mapa">
      <svg className="mapa-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Grafo de ${detalhe.investigation.seed}: ${total} nós e ${detalhe.edges?.length ?? 0} ligações`}>
        <defs>
          <radialGradient id="mapa-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2E9BFF" stopOpacity=".55" />
            <stop offset="100%" stopColor="#2E9BFF" stopOpacity="0" />
          </radialGradient>
        </defs>
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
          const cor = centro ? NODE_COLOR.seed : (NODE_COLOR[n.type] ?? '#9AA7BD');
          const esquerda = p.x < W / 2 - 4;
          return (
            <g key={n.id} className="mapa-no">
              {centro && <circle cx={p.x} cy={p.y} r={46} fill="url(#mapa-halo)" />}
              <circle cx={p.x} cy={p.y} r={centro ? 17 : 7.5} fill={cor}
                stroke="#050D1F" strokeWidth={centro ? 4 : 2.5} />
              {centro ? (
                <text className="mapa-txt mapa-txt-centro" x={p.x} y={p.y + 36} textAnchor="middle">
                  {corte(n.value || n.label, 28)}
                </text>
              ) : comNome.has(n.id) ? (
                <text className="mapa-txt" x={p.x + (esquerda ? -12 : 12)} y={p.y + 4}
                  textAnchor={esquerda ? 'end' : 'start'}>
                  {corte(n.value || n.label)}
                </text>
              ) : null}
              <title>{`${TYPE_LABEL[n.type] ?? n.type}: ${n.value || n.label}`}</title>
            </g>
          );
        })}
      </svg>
      {legenda.length > 0 && (
        <ul className="mapa-legenda" aria-label="Nós por tipo">
          {legenda.map(([tipo, n]) => (
            <li key={tipo} className="mapa-chip">
              <i style={{ background: NODE_COLOR[tipo] ?? '#9AA7BD' }} />
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
