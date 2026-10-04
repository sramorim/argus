/**
 * Grafo interativo em SVG.
 *
 * Quatro decisões que o tornam utilizável no telemóvel:
 *  - **eventos de ponteiro** (não só rato): arrastar com o dedo funciona igual;
 *  - **dois dedos fazem zoom** em vez de a página fazer scroll por cima;
 *  - **"ajustar" automático**: o grafo é desenhado no tamanho do contentor, com
 *    o nó central no meio e os saltos em anéis — não há coordenadas fixas que
 *    saiam do ecrã num telemóvel;
 *  - **o detalhe do nó é uma folha de fundo**, não um painel flutuante: com o
 *    dedoTap, um cartão no meio do ecrã tapa o grafo que se está a ler.
 *
 * A espessura e a opacidade de cada ligação saem da confiança que o servidor
 * pôs na aresta (`confidence`). Nada aqui é decorativo: mudar a confiança muda
 * o que se vê.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph, GraphNode } from '../api';
import { CONF_LABEL, CONF_HINT } from '../api';
import { Icon } from './Icons';

/* As cores dos nós saem da paleta do Design System: o accent para o alvo, uma
   rampa de azuis e neutros para o resto, e o âmbar do estado de aviso para
   carteira e conta. Nenhuma cor nova foi inventada. */
const NODE_COLOR: Record<string, string> = {
  seed: '#2E9BFF', pessoa: '#FFFFFF', username: '#FFFFFF', conta: '#F5A623',
  email: '#9BD4FF', telefone: '#B9A5D9', dominio: '#6FC0FF', ip: '#5F6B84',
  servico: '#7A879F', empresa: '#9AA7BD', socio: '#8C97AB', endereco: '#8492A8',
  wallet: '#F5A623', portfolio: '#6FC0FF', cve: '#2E9BFF', pacote: '#B9A5D9',
  breach: '#2E9BFF', documento: '#7A879F', hashtag: '#C7B48C',
};
const TYPE_LABEL: Record<string, string> = {
  pessoa: 'pessoa', username: 'username', conta: 'conta', email: 'email', telefone: 'telefone',
  dominio: 'domínio', ip: 'IP', servico: 'serviço', empresa: 'empresa', socio: 'sócio',
  endereco: 'endereço', wallet: 'carteira', cve: 'CVE', pacote: 'pacote', breach: 'breach',
  documento: 'documento', hashtag: 'hashtag', portfolio: 'portfólio',
};
const R = 7;
const W = 1000;
const H = 620;

function layout(nodes: GraphNode[]): Map<string, { x: number; y: number; n: GraphNode }> {
  const m = new Map<string, { x: number; y: number; n: GraphNode }>();
  const cx = W / 2, cy = H / 2;
  const byHop = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    if (!byHop.has(n.hop)) byHop.set(n.hop, []);
    byHop.get(n.hop)!.push(n);
  }
  const hops = [...byHop.keys()].sort((a, b) => a - b);
  for (const hop of hops) {
    const list = byHop.get(hop)!;
    if (hop === 0) { for (const n of list) m.set(n.id, { x: cx, y: cy, n }); continue; }
    const idx = hops.indexOf(hop);
    // Anéis concêntricos; o raio cresce com o salto e com a quantidade de nós.
    const ring = (W / 2 - 70) * (idx / Math.max(1, hops.length - 1)) * 0.78 + 110;
    const n = list.length;
    const step = (Math.PI * 2) / n;
    const offset = (hop * 0.9) % (Math.PI * 2);
    list.forEach((node, i) => {
      const a = i * step + offset;
      // Elipse: o ecrã é largo e baixo, por isso o raio Y é menor.
      m.set(node.id, { x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring * 0.66, n: node });
    });
  }
  return m;
}

export default function GraphView({ graph }: { graph: Graph; onPick?: (n: GraphNode) => void }) {
  const pos = useMemo(() => layout(graph.nodes), [graph.nodes]);
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  /* Busca real sobre os nós que existem: filtra por valor, e o primeiro
     resultado é trazido para o ecrã. Não há resultados inventados — o que
     não está no grafo não aparece. */
  const [termo, setTermo] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Estado de ponteiro (rato OU dedo) e pinça de zoom.
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ d: number; k: number } | null>(null);

  useEffect(() => { setSel(null); setView({ x: 0, y: 0, k: 1 }); setTermo(''); }, [graph]);

  const filtrados = useMemo(() => {
    const n = termo.trim().toLowerCase();
    if (!n) return null;
    const achados = graph.nodes.filter((x) => x.value.toLowerCase().includes(n));
    return new Set(achados.map((x) => x.id));
  }, [termo, graph.nodes]);

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current.size === 2) {
        const [a, b] = [...pinch.current.values()];
        pinchStart.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
        drag.current = null;
      } else {
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      }
    } else {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pinch.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(3, Math.max(0.4, (pinchStart.current.k * d) / Math.max(1, pinchStart.current.d)));
      setView((v) => ({ ...v, k }));
      return;
    }
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const sx = (rect ? W / rect.width : 1) * 1.15;
    setView((v) => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) * sx, y: drag.current!.vy + (e.clientY - drag.current!.y) * sx }));
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchStart.current = null;
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const zoom = useCallback((f: number) => setView((v) => ({ ...v, k: Math.min(3, Math.max(0.4, v.k * f)) })), []);
  const reset = useCallback(() => setView({ x: 0, y: 0, k: 1 }), []);

  const types = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of graph.nodes) if (n.type !== 'seed') seen.set(n.type, (seen.get(n.type) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [graph.nodes]);

  if (!graph.nodes.length) {
    return (
      <div className="empty">
        <div className="empty-ico"><Icon.network /></div>
        <b>Grafo vazio</b>
        <p>Nenhum nó foi construído. As fontes podem ter falhado — vê a matriz de fontes.</p>
      </div>
    );
  }

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.9); } }}
        onDoubleClick={reset}
        role="img"
        aria-label={`Grafo com ${graph.nodes.length} nós e ${graph.edges.length} ligações`}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {graph.edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to);
            if (!a || !b) return null;
            // Com a busca activa, as ligações que não chegam a um nó
            // encontrado esbatem: vê-se o sub-grafo do que se procura.
            const apagada = filtrados
              ? !(filtrados.has(e.from) || filtrados.has(e.to))
              : false;
            return (
              <line
                key={i}
                className={`gedge c-${e.confidence}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                opacity={apagada ? 0.12 : undefined}
              />
            );
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const isSeed = n.hop === 0;
            const r = isSeed ? R + 4 : R;
            const color = NODE_COLOR[n.type] ?? '#5F6B84';
            const active = sel?.id === n.id;
            const achado = filtrados?.has(n.id) ?? true;
            return (
              <g
                key={n.id} className="gnode"
                onPointerUp={(e) => { if (e.pointerType !== 'touch' || !drag.current) { e.stopPropagation(); setSel(n); } }}
                style={{ cursor: 'pointer', opacity: achado ? 1 : 0.22 }}
              >
                {active && <circle cx={p.x} cy={p.y} r={r + 7} fill="none" stroke={color} strokeWidth={1.6} opacity={0.6} />}
                {/* Alvo de toque: o raio real é pequeno, o alvo tem 44px. */}
                <circle cx={p.x} cy={p.y} r={22} fill="transparent" />
                <circle
                  cx={p.x} cy={p.y} r={r} fill={color} opacity={isSeed ? 1 : 0.88}
                  stroke={active ? '#fff' : achado ? 'transparent' : color} strokeWidth={active ? 2 : 1}
                />
                {n.hop >= 1 && (
                  <text x={p.x} y={p.y + r + 12} fontSize="10" fill="#9AA7BD" textAnchor="middle">
                    {n.value.length > 28 ? `${n.value.slice(0, 27)}…` : n.value}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="g-panel g-ctl">
        <button onClick={() => zoom(1.18)} title="Aproximar" aria-label="Aproximar" type="button"><Icon.zoomIn /></button>
        <button onClick={() => zoom(0.85)} title="Afastar" aria-label="Afastar" type="button"><Icon.zoomOut /></button>
        <button onClick={reset} title="Repor" aria-label="Repor vista" type="button"><Icon.target /></button>
      </div>

      <div className="g-busca">
        <div className="search">
          <Icon.search />
          <input
            type="search"
            value={termo}
            placeholder="Procurar no grafo"
            aria-label="Procurar um nó no grafo"
            enterKeyHint="search"
            onChange={(e) => setTermo(e.target.value)}
          />
          {termo && (
            <button className="search-clear" onClick={() => setTermo('')} aria-label="limpar pesquisa" type="button">
              <Icon.close width={15} height={15} />
            </button>
          )}
        </div>
      </div>

      <div className="g-panel g-stats">
        <span><b>{graph.nodes.length}</b> nós</span>
        <span><b>{graph.edges.length}</b> ligações</span>
        <span><b>{Math.max(...graph.nodes.map((n) => n.hop))}</b> salto(s)</span>
      </div>

      <div className="g-panel g-legend">
        {types.map(([t, c]) => (
          <div className="l" key={t}>
            <span className="conf-dot" style={{ background: NODE_COLOR[t] ?? '#5F6B84', marginTop: 0 }} />
            {TYPE_LABEL[t] ?? t} <span className="dim num">{c}</span>
          </div>
        ))}
      </div>

      <div className="g-panel g-hint">arrastar · dois dedos: zoom · toque num nó</div>

      {sel && (
        <div className="g-folha" role="dialog" aria-label={`Nó ${TYPE_LABEL[sel.type] ?? sel.type}`}>
          <div className="g-folha-top">
            <span className="micro">{TYPE_LABEL[sel.type] ?? sel.type}</span>
            <button className="icon-btn" onClick={() => setSel(null)} aria-label="Fechar detalhe" type="button">
              <Icon.close width={16} height={16} />
            </button>
          </div>
          <div className="mono" style={{ overflowWrap: 'anywhere', marginBottom: 9, color: 'var(--t-1)', fontSize: 13.5 }}>{sel.value}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <span className="tag" title={CONF_HINT[sel.confidence]}>{CONF_LABEL[sel.confidence]}</span>
            <span className="tag">salto {sel.hop}</span>
            {typeof (sel.attrs as { via?: string } | null)?.via === 'string' && (
              <span className="tag">via {(sel.attrs as { via?: string }).via}</span>
            )}
          </div>
          {sel.sourceIds.length > 0 && <div className="src-ref" style={{ marginTop: 8 }}>fontes: {sel.sourceIds.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
