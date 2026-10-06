/**
 * Landing pública — visual estilo "app showcase" (fundo escuro com brilho +
 * mockup de telemóvel), identidade ARGOS, conteúdo ARGOS.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type Plan, type ToolPublic, useContacto, periodoCurto } from '../api';
import { Brand, PlanTag, Skeleton } from '../components/ui';
import { GRUPOS, porGrupo } from '../ia';

const VERDE = '#1fd67a';
const FUNDO = '#04120b';

const glow: CSSProperties = {
  background: `radial-gradient(90% 55% at 50% 0%, rgba(31,214,122,.22) 0%, rgba(4,18,11,0) 70%), ${FUNDO}`,
};

const kicker: CSSProperties = {
  fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: VERDE, fontWeight: 700,
};

const titulo: CSSProperties = { color: '#fff', fontSize: 34, lineHeight: 1.1, margin: '8px 0 0', fontWeight: 800 };

function Phone() {
  return (
    <div style={{
      width: 250, borderRadius: 36, padding: 10, margin: '0 auto',
      background: '#0b0f0d', border: '2px solid #c9a86a',
      boxShadow: '0 30px 80px rgba(0,0,0,.6), 0 0 60px rgba(31,214,122,.15)',
    }}>
      <div style={{ background: '#101613', borderRadius: 28, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px 6px', color: '#fff', fontSize: 12, fontWeight: 700 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: VERDE, display: 'grid', placeItems: 'center', color: '#04120b', fontSize: 12 }}>◉</span>
          ARGOS
          <span style={{ marginLeft: 'auto', fontSize: 10, color: VERDE, background: 'rgba(31,214,122,.12)', padding: '2px 8px', borderRadius: 20 }}>● ONLINE</span>
        </div>
        <div style={{ padding: '8px 14px', color: '#9fb3a8', fontSize: 10 }}>PAINEL DE ANÁLISE</div>
        <div style={{ margin: '0 12px', background: '#0a0f0c', border: '1px solid #1e2b24', borderRadius: 12, padding: 12 }}>
          <div style={{ color: '#7d8f86', fontSize: 10 }}>@perfil_alvo</div>
          <div style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>87<span style={{ fontSize: 12, color: '#7d8f86' }}>/100 presença</span></div>
          <div style={{ height: 6, borderRadius: 4, background: '#1c2620', marginTop: 8 }}>
            <div style={{ width: '87%', height: '100%', borderRadius: 4, background: VERDE }} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#04120b', background: VERDE, borderRadius: 8, padding: '6px 0', fontWeight: 800 }}>ANALISAR</span>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#fff', background: '#1c2620', borderRadius: 8, padding: '6px 0' }}>RELATÓRIO</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 12 }}>
          {[['2.4M', 'alcance'], ['4.8%', 'engajam.'], ['132', 'posts']].map(([v, l]) => (
            <div key={l} style={{ flex: 1, background: '#0a0f0c', border: '1px solid #1e2b24', borderRadius: 10, padding: 8, textAlign: 'center' }}>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>{v}</div>
              <div style={{ color: '#7d8f86', fontSize: 9 }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '10px 0 14px', color: '#5d6f65', fontSize: 14 }}>
          <span style={{ color: VERDE }}>◉</span><span>◎</span><span>◎</span><span>◎</span>
        </div>
      </div>
    </div>
  );
}

export function Landing({ onStart, tools }: { onStart: () => void; tools: ToolPublic[] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const wa = useContacto();
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

  const emDestaque = GRUPOS.map((g) => ({ g, lista: porGrupo(tools, g.id) })).filter((x) => x.lista.length);

  const secoes: { kicker: string; titulo: string; sub: string; corpo: ReactNode }[] = [
    {
      kicker: 'Ferramentas', titulo: 'Cada rede, uma análise.',
      sub: `${tools.length} ferramentas reais, organizadas pelo que queres fazer.`,
      corpo: (
        <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
          {emDestaque.slice(0, 4).map(({ g, lista }) => {
            const Ico = g.icon;
            return (
              <div key={g.id} style={{ background: '#0a0f0c', border: '1px solid #1e2b24', borderLeft: `3px solid ${VERDE}`, borderRadius: 12, padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ color: VERDE }}><Ico /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{g.nome}</div>
                  <div style={{ color: '#7d8f86', fontSize: 12 }}>{lista.length} ferramentas · {lista.slice(0, 3).map((t) => t.name).join(' · ')}</div>
                </div>
                {lista[0] && (lista[0].lock === 'locked' ? <PlanTag minPlan={lista[0].minPlan} /> : <span className="tag tag-free">GRÁTIS</span>)}
              </div>
            );
          })}
        </div>
      ),
    },
    {
      kicker: 'Como funciona', titulo: 'Do @perfil ao relatório.',
      sub: 'Três passos, sempre com proveniência.',
      corpo: (
        <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
          {[['1 · BUSCAR', 'Digite o @usuário, domínio ou alvo.'], ['2 · ANALISAR', 'O ARGOS cruza Instagram, TikTok e mais.'], ['3 · RELATÓRIO', 'Resultado com fonte, data e confiança.']].map(([t, d]) => (
            <div key={t} style={{ background: '#0a0f0c', border: '1px solid #1e2b24', borderRadius: 12, padding: 14 }}>
              <div style={{ color: VERDE, fontWeight: 800, fontSize: 12 }}>{t}</div>
              <div style={{ color: '#d7e2dc', fontSize: 13, marginTop: 4 }}>{d}</div>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div style={{ margin: '0 -16px', ...glow }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 16px 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 0' }}>
          <Brand size={30} subtitle="Análise de presença" className="brand-plain" />
          <span className="grow" />
          {wa && <a className="btn btn-quiet btn-sm" href={wa.link} target="_blank" rel="noopener noreferrer">falar connosco</a>}
        </header>

        {/* HERO */}
        <section style={{ textAlign: 'center', padding: '36px 0 10px' }}>
          <div style={kicker}>Painel de análise</div>
          <h1 style={{ ...titulo, fontSize: 38 }}>Descubra a presença<br />de qualquer perfil.</h1>
          <p style={{ color: '#9fb3a8', maxWidth: '46ch', margin: '14px auto 0', fontSize: 15, lineHeight: 1.6 }}>
            O ARGOS analisa perfis no Instagram, TikTok e mais — métricas, atividade e
            proveniência de cada dado. Sem dados inventados.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-lg" type="button" onClick={onStart} style={{ background: VERDE, borderColor: VERDE, color: '#04120b', fontWeight: 800 }}>criar conta grátis</button>
            <button className="btn btn-lg" type="button" onClick={() => document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth' })}>ver planos</button>
          </div>
          <div style={{ display: 'flex', gap: 22, justifyContent: 'center', marginTop: 22 }}>
            {[['9', 'ferramentas'], ['0', 'dados inventados'], ['100%', 'com proveniência']].map(([v, l]) => (
              <div key={l}><div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{v}</div><div style={{ color: '#7d8f86', fontSize: 11 }}>{l}</div></div>
            ))}
          </div>
        </section>

        <div style={{ padding: '26px 0' }}><Phone /></div>

        {secoes.map((s) => (
          <section key={s.kicker} style={{ padding: '30px 0 6px' }}>
            <div style={kicker}>{s.kicker}</div>
            <h2 style={titulo}>{s.titulo}</h2>
            <p style={{ color: '#7d8f86', fontSize: 13, marginTop: 6 }}>{s.sub}</p>
            {s.corpo}
          </section>
        ))}

        {/* PLANOS */}
        <section id="planos" style={{ padding: '30px 0 6px' }}>
          <div style={kicker}>Planos</div>
          <h2 style={titulo}>Comece grátis.</h2>
          <p style={{ color: '#7d8f86', fontSize: 13, marginTop: 6 }}>O Free não expira e não pede cartão.</p>
          {plans === null ? <Skeleton lines={4} /> : (
            <div className="plan-grid" style={{ marginTop: 18 }}>
              {plans.map((p) => (
                <div className="plan-card" key={p.id}>
                  <div className="plan-name">{p.name}</div>
                  <div className="plan-price">
                    {p.priceBRL === 0 ? 'Grátis' : `R$ ${p.priceBRL.toFixed(2).replace('.', ',')}`}
                    {p.priceBRL > 0 && <small>{periodoCurto(p)}</small>}
                  </div>
                  <div className="plan-note">{p.highlight}</div>
                  <ul className="plan-perks">{p.perks.map((k) => <li key={k}>{k}</li>)}</ul>
                  <button className="btn btn-block btn-quiet" type="button" onClick={onStart}>
                    {p.priceBRL === 0 ? 'começar grátis' : 'escolher plano'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="foot">
          <div className="stack" style={{ gap: 5 }}>
            <span className="foot-brand">SR. AMORIM</span>
            <span>Criado e desenvolvido por SR. Amorim.</span>
            <span>{wa?.copyright ?? '© 2026 SR. Amorim'} · Todos os direitos reservados.</span>
          </div>
          <div className="foot-links">
            {wa && <a href={wa.link} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
            <a href="https://github.com/sramorim/argus" target="_blank" rel="noopener noreferrer">Código</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
