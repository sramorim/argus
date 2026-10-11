/**
 * Landing pública — referência visual oficial:
 * `central-amorim-referencia-final.png` (página Central Amorim).
 *
 * Estrutura fiel à referência: masthead central (marca + linha vermelha),
 * fila de canais, cartões empilhados (ícone | título + resumo | seta) e
 * rodapé com assinatura. Props intactas: onStart + tools (backend).
 * Os cartões são os grupos reais de `ia.ts` — nada é prometido além do
 * que o catálogo da API entrega.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { api, type Plan, type ToolPublic, useContacto, periodoCurto } from '../api';
import { PlanTag, Skeleton } from '../components/ui';
import { GRUPOS } from '../ia';

/* Paleta — Design System ARGOS v1.0 (se fosse meu: uma só verdade visual).
   Antes era preto+vermelho solto aqui dentro; agora lê os mesmos tokens do app:
   fundo azul-noite, superfície, borda e azul eléctrico. Nada de HEX solto. */
const TINTA = 'var(--t-1)';
const APAGADO = 'var(--t-2)';
const FUNDO = 'var(--bg)';
const CARTAO = 'var(--surface)';
const BORDA = 'var(--line)';
const VERMELHO = 'var(--blue-2)';
const VERMELHO_CLARO = 'var(--blue)';

const pagina: CSSProperties = {
  background: 'var(--grad-hero)',
  color: TINTA,
  margin: '0 -16px',
  fontFamily: 'var(--font, "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif)',
};

const coluna: CSSProperties = {
  maxWidth: 520,
  margin: '0 auto',
  padding: '0 20px 40px',
};

const tituloSecao: CSSProperties = {
  fontSize: 11,
  letterSpacing: 3,
  textTransform: 'uppercase',
  color: APAGADO,
  fontWeight: 700,
  textAlign: 'center',
  margin: '34px 0 14px',
};

const cartao: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  background: CARTAO,
  border: `1px solid ${BORDA}`,
  borderRadius: 16,
  padding: 16,
  marginBottom: 12,
  width: '100%',
  textAlign: 'left',
  color: 'inherit',
  cursor: 'pointer',
};

const iconeQuadro: CSSProperties = {
  flex: '0 0 auto',
  width: 52,
  height: 52,
  borderRadius: 14,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderBottom: '2px solid var(--blue)',
  color: TINTA,
};

const setaQuadro: CSSProperties = {
  flex: '0 0 auto',
  width: 44,
  height: 44,
  borderRadius: 12,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--surface-3)',
  border: '1px solid var(--line-strong)',
  color: 'var(--blue-3)',
  fontSize: 20,
};

const canal: CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 14,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  color: TINTA,
  fontSize: 22,
  textDecoration: 'none',
};

export function Landing({ onStart, tools }: { onStart: () => void; tools: ToolPublic[] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const wa = useContacto();
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

  const nomes = new Set(tools.map((t) => t.id));

  return (
    <div style={pagina}>
      <div style={coluna}>
        {/* MASTHEAD — como na referência: marca em cima, linha vermelha */}
        <header style={{ textAlign: 'center', padding: '44px 0 6px' }}>
          <div style={{ fontSize: 13, letterSpacing: 8, color: APAGADO, fontWeight: 600 }}>SENHOR AMORIM</div>
          <h1 style={{ fontSize: 52, lineHeight: 1, margin: '6px 0 0', fontWeight: 900, letterSpacing: 1 }}>ARGOS</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ flex: 1, height: 2, background: VERMELHO, borderRadius: 2 }} />
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 1 }}>
              INTELIGÊNCIA <span style={{ color: VERMELHO_CLARO }}>SOCIAL</span>
            </span>
            <span style={{ flex: 1, height: 2, background: VERMELHO, borderRadius: 2 }} />
          </div>
          <p style={{ color: APAGADO, fontSize: 12, letterSpacing: 2, marginTop: 12 }}>
            INVESTIGAÇÃO DIGITAL, FONTES ABERTAS E INTELIGÊNCIA
          </p>
        </header>

        {/* CANAIS — só o que está declarado: WhatsApp do servidor + código */}
        <nav aria-label="Canais" style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '20px 0 6px' }}>
          {wa && (
            <a style={canal} href={wa.link} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" title="WhatsApp">
              ✆
            </a>
          )}
          <a style={canal} href="https://github.com/sramorim/argus" target="_blank" rel="noopener noreferrer" aria-label="Código" title="Código">
            {'</>'}
          </a>
        </nav>

        {/* CARTÕES — grupos reais do catálogo, com contagem real */}
        <div style={tituloSecao}>Ferramentas · {tools.length} ativas</div>
        <div>
          {GRUPOS.map((g) => {
            const Ico = g.icon;
            const reais = g.ferramentas.filter((id) => nomes.has(id));
            return (
              <button key={g.id} type="button" style={cartao} onClick={onStart}>
                <span style={iconeQuadro}>
                  <Ico />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 800, fontSize: 16, letterSpacing: 0.5 }}>{g.nome.toUpperCase()}</span>
                  <span style={{ display: 'block', color: APAGADO, fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>
                    {g.resumo}
                  </span>
                  <span style={{ display: 'block', color: APAGADO, fontSize: 11, marginTop: 6 }}>
                    {reais.length === 0 ? '—' : reais.length === 1 ? '1 ferramenta' : `${reais.length} ferramentas`}
                  </span>
                </span>
                <span style={setaQuadro} aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onStart}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '16px 0',
            borderRadius: 14,
            border: 'none',
            background: 'var(--grad-cta)',
            color: '#fff',
            fontWeight: 900,
            fontSize: 16,
            letterSpacing: 0.5,
            cursor: 'pointer',
            boxShadow: '0 8px 28px var(--blue-glow)',
          }}
        >
          CRIAR CONTA GRÁTIS
        </button>

        {/* PLANOS — dados reais da API */}
        <div style={tituloSecao} id="planos">Planos</div>
        {plans === null ? <Skeleton lines={4} /> : (
          <div style={{ display: 'grid', gap: 12 }}>
            {plans.map((p) => (
              <div className="plan-card" key={p.id} style={{ background: CARTAO, borderColor: BORDA }}>
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
        <div style={{ marginTop: 14 }}>
          <PlanTag minPlan="pro" />
        </div>

        {/* FAQ HONESTO — o que o visitante pergunta antes de criar conta.
            Respostas curtas, sem promessa além do que o produto entrega. */}
        <div style={tituloSecao}>Perguntas frequentes</div>
        <div style={{ display: 'grid', gap: 12 }}>
          {[
            {
              q: 'Os resultados são inventados?',
              a: 'Não. Cada achado diz de que fonte veio, quando e com que confiança. Se a fonte falhar, aparece como erro ou vazia — nunca um resultado plausível mas falso.',
            },
            {
              q: 'Preciso pagar para começar?',
              a: 'Não. O Free dá 15 execuções por dia, sem cartão. O Pro é pagamento único e vitalício; a ativação é manual via WhatsApp, depois de confirmares a transferência.',
            },
            {
              q: 'O Apify custa à parte?',
              a: 'Sim. Os actors do Apify (Instagram, TikTok, Facebook, X) são pay-per-event na tua conta Apify e o ecrã pede confirmação explícita antes de correr. Nada corre escondido.',
            },
            {
              q: 'Isto invade conta ou rede social?',
              a: 'Não. Só fontes públicas, com proveniência (LGPD). Sem login em rede social, sem scan ativo, sem Tor no backend.',
            },
          ].map((f) => (
            <details key={f.q} style={{ background: CARTAO, border: `1px solid ${BORDA}`, borderRadius: 14, padding: '14px 16px' }}>
              <summary style={{ fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{f.q}</summary>
              <p style={{ color: APAGADO, fontSize: 13, lineHeight: 1.6, margin: '8px 0 0' }}>{f.a}</p>
            </details>
          ))}
        </div>

        {/* RODAPÉ — como na referência: assinatura + direitos + canais */}
        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderTop: `1px solid ${BORDA}`,
            marginTop: 30,
            paddingTop: 18,
            color: APAGADO,
            fontSize: 11,
          }}
        >
          <span style={{ fontStyle: 'italic', fontSize: 16, color: TINTA }}>Argos</span>
          <span style={{ textAlign: 'center' }}>
            Todos os direitos reservados.
            <br />
            {wa?.copyright ?? '© 2026 SR. Amorim'}
          </span>
          <span style={{ display: 'flex', gap: 10, fontSize: 16 }}>
            {wa && <a href={wa.link} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" style={{ color: 'inherit', textDecoration: 'none' }}>✆</a>}
            <a href="https://github.com/sramorim/argus" target="_blank" rel="noopener noreferrer" aria-label="Código" style={{ color: 'inherit', textDecoration: 'none' }}>{'</>'}</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
