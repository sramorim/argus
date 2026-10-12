/**
 * Landing pública do ARGOS — reconstrução 2026-10.
 *
 * Uma página curta e premium, não uma lista interminável: herói com proposta
 * e CTA, "como funciona" em 3 passos, ferramentas agrupadas de forma compacta,
 * planos (dados reais da API), FAQ curto e rodapé. Tudo o que aparece vem do
 * backend (`tools`, `api.plans()`); nada é prometido além do catálogo real.
 */
import { useEffect, useState } from 'react';
import { api, type Plan, type ToolPublic, useContacto, periodoCurto } from '../api';
import { PlanTag, Skeleton } from '../components/ui';
import { GRUPOS } from '../ia';

export function Landing({ onStart, tools }: { onStart: () => void; tools: ToolPublic[] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const wa = useContacto();
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

  const nomes = new Set(tools.map((t) => t.id));
  const totalFerramentas = GRUPOS.reduce(
    (n, g) => n + g.ferramentas.filter((id) => nomes.has(id)).length, 0,
  );

  return (
    <div className="lp">
      {/* ---------- Herói ---------- */}
      <header className="lp-hero">
        <p className="lp-marca">SENHOR AMORIM</p>
        <h1 className="lp-titulo">ARGOS</h1>
        <p className="lp-sub">
          Inteligência de presença pública em redes sociais.
          Cada achado diz <strong>de onde veio</strong>, quando e com que confiança —
          e o que não foi encontrado também está escrito.
        </p>
        <div className="lp-cta">
          <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
            Começar grátis
          </button>
          <button
            type="button"
            className="btn btn-lg"
            onClick={() => document.getElementById('lp-ferramentas')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Ver ferramentas
          </button>
        </div>
        <p className="lp-trust">
          {totalFerramentas > 0 ? `${totalFerramentas} ferramentas ativas` : 'Ferramentas reais'} · Free com 15 execuções/dia · Sem cartão para começar
        </p>
      </header>

      {/* ---------- Como funciona ---------- */}
      <section className="lp-secao" aria-label="Como funciona">
        <ol className="lp-passos">
          {[
            { n: '1', t: 'Diz o alvo', d: 'Username, nome, domínio, e-mail, telefone, IP ou URL. O tipo é detetado sozinho.' },
            { n: '2', t: 'Vê o plano', d: 'O ARGOS mostra o que vai correr — e o que fica bloqueado, com o motivo — antes de gastar.' },
            { n: '3', t: 'Lê com prova', d: 'Achados com fonte, estado e confiança. Exporta em JSON, CSV, HTML e PDF.' },
          ].map((p) => (
            <li key={p.n} className="lp-passo">
              <span className="lp-passo-n" aria-hidden>{p.n}</span>
              <div>
                <div className="lp-passo-t">{p.t}</div>
                <p className="lp-passo-d">{p.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Ferramentas ---------- */}
      <section className="lp-secao" id="lp-ferramentas" aria-label="Ferramentas">
        <h2 className="lp-h2">Ferramentas</h2>
        <ul className="lp-grupos">
          {GRUPOS.map((g) => {
            const reais = g.ferramentas.filter((id) => nomes.has(id));
            if (!reais.length) return null;
            const Ico = g.icon;
            return (
              <li key={g.id}>
                <button type="button" className="lp-grupo" onClick={onStart}>
                  <span className="lp-grupo-ico"><Ico /></span>
                  <span className="lp-grupo-txt">
                    <span className="lp-grupo-nome">{g.nome}</span>
                    <span className="lp-grupo-d">{g.resumo}</span>
                  </span>
                  <span className="lp-grupo-n">{reais.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- Planos ---------- */}
      <section className="lp-secao" id="planos" aria-label="Planos">
        <h2 className="lp-h2">Planos</h2>
        {plans === null ? <Skeleton lines={3} /> : (
          <div className="lp-planos">
            {plans.map((p) => (
              <article className="lp-plano" key={p.id}>
                <div className="lp-plano-nome">{p.name}</div>
                <div className="lp-plano-preco">
                  {p.priceBRL === 0 ? 'Grátis' : `R$ ${p.priceBRL.toFixed(2).replace('.', ',')}`}
                  {p.priceBRL > 0 && <small> {periodoCurto(p)}</small>}
                </div>
                <p className="lp-plano-destaque">{p.highlight}</p>
                <button className="btn btn-block" type="button" onClick={onStart}>
                  {p.priceBRL === 0 ? 'Começar grátis' : 'Escolher plano'}
                </button>
              </article>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <PlanTag minPlan="pro" />
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="lp-secao" aria-label="Perguntas frequentes">
        <h2 className="lp-h2">Perguntas frequentes</h2>
        <div className="lp-faq">
          {[
            {
              q: 'Os resultados são inventados?',
              a: 'Não. Cada achado declara fonte, instante e confiança. Fonte em falha aparece como erro ou vazia — nunca um resultado falso.',
            },
            {
              q: 'Preciso pagar para começar?',
              a: 'Não. O Free dá 15 execuções por dia, sem cartão. A ativação do Pro é manual via WhatsApp, após confirmares a transferência.',
            },
            {
              q: 'Isto invade contas ou redes?',
              a: 'Não. Só fontes públicas, com proveniência (LGPD). Sem login em redes sociais, sem scan ativo, sem Tor no backend.',
            },
          ].map((f) => (
            <details key={f.q} className="lp-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- Rodapé ---------- */}
      <footer className="lp-rodape">
        <span className="lp-rodape-marca">Argos</span>
        <span className="lp-rodape-copy">{wa?.copyright ?? '© 2026 SR. Amorim'} · Todos os direitos reservados.</span>
        <span className="lp-rodape-canais">
          {wa && <a href={wa.link} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">✆</a>}
          <a href="https://github.com/sramorim/argus" target="_blank" rel="noopener noreferrer" aria-label="Código">{'</>'}</a>
        </span>
      </footer>
    </div>
  );
}
