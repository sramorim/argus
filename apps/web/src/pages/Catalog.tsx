/**
 * Catálogo de ferramentas.
 *
 * Organização (o nível conta): pesquisa em cima, filtros por categoria em
 * pastilhas, contador honesto, cartões com nome/resumo/etiquetas, e um estado
 * vazio que diz o que fazer em vez de só mostrar "nada encontrado".
 */
import { useMemo, useState } from 'react';
import type { ToolPublic } from '../api';
import { Icon, CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_ORDER } from '../components/Icons';
import { Empty, SearchInput, PlanTag, CardGridSkeleton } from '../components/ui';
import type { View } from './AppShell';

export default function Catalog({ tools, setView, loading }: {
  tools: ToolPublic[]; setView: (v: View) => void; loading?: boolean;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tools) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [tools]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return tools.filter((t) => {
      if (cat && t.category !== cat) return false;
      if (!n) return true;
      return (
        t.name.toLowerCase().includes(n) ||
        t.summary.toLowerCase().includes(n) ||
        t.tags.some((x) => x.toLowerCase().includes(n)) ||
        (CATEGORY_LABEL[t.category] ?? '').toLowerCase().includes(n)
      );
    });
  }, [tools, q, cat]);

  const grouped = useMemo(() => {
    const m = new Map<string, ToolPublic[]>();
    for (const t of filtered) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return [...m.entries()].sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [filtered]);

  const libres = tools.filter((t) => t.lock === 'open').length;
  const searching = !!q.trim() || !!cat;

  return (
    <div className="page">
      <div className="tool-toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Procurar ferramenta, alvo ou tag…" />
      </div>

      <div className="chip-row" style={{ marginTop: 12, marginBottom: 6 }}>
        <button className="chip" type="button" aria-pressed={!cat} onClick={() => setCat(null)}>
          Todas <span className="num dim">{tools.length}</span>
        </button>
        {cats.map(([c, n]) => (
          <button key={c} className="chip" type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {CATEGORY_LABEL[c] ?? c} <span className="num" style={{ opacity: .7 }}>{n}</span>
          </button>
        ))}
      </div>

      <p className="t-sm dim" style={{ margin: '6px 0 18px' }}>
        {searching ? (
          <>{filtered.length} de {tools.length} ferramentas</>
        ) : (
          <>{tools.length} ferramentas · {libres} disponíveis no teu plano · cada uma diz de onde veio o que encontrou</>
        )}
      </p>

      {loading ? <CardGridSkeleton n={6} /> : filtered.length === 0 ? (
        <Empty icon={Icon.search} title="Nada encontrado" action={
          searching ? (
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => { setQ(''); setCat(null); }}>
              limpar filtros
            </button>
          ) : undefined
        }>
          {q ? <>Não há ferramenta que corresponda a “{q}”. Tenta o nome do alvo (domínio, IP, username…) ou outra palavra.</> : 'O catálogo está vazio.'}
        </Empty>
      ) : (
        grouped.map(([c, list]) => {
          const Ico = CATEGORY_ICON[c] ?? Icon.grid;
          return (
            <section key={c} style={{ marginBottom: 30 }}>
              <h2 className="t-h3" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
                <Ico width={15} height={15} style={{ color: 'var(--t-4)' }} />
                {CATEGORY_LABEL[c] ?? c}
                <span className="t-xs dim num">{list.length}</span>
              </h2>
              <div className="tool-grid">
                {list.map((t) => (
                  <ToolCard key={t.id} t={t} onOpen={() => setView({ k: 'tool', id: t.id })} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function ToolCard({ t, onOpen }: { t: ToolPublic; onOpen: () => void }) {
  const Ico = CATEGORY_ICON[t.category] ?? Icon.grid;
  return (
    <button className="tool-card" type="button" data-locked={t.lock === 'locked'} onClick={onOpen}>
      <div className="tool-top">
        <span className="tool-glyph"><Ico /></span>
        <span className="tool-name">{t.name}</span>
      </div>
      <div className="tool-sum">{t.summary}</div>
      <div className="tool-foot">
        {t.lock === 'locked' ? <PlanTag minPlan={t.minPlan} /> : <PlanTag minPlan="free" />}
        {t.legalGate === 'lgpd' && <span className="tag tag-legal">LGPD</span>}
        {t.legalGate === 'restricted' && <span className="tag">uso restrito</span>}
        {t.tags.slice(0, 2).map((x) => <span className="tag" key={x}>{x}</span>)}
      </div>
    </button>
  );
}
