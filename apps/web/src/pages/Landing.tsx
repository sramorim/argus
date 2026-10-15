/**
 * Landing pública do ARGOS — redesenho 2026-10 (identidade azul-marinho).
 *
 * A mesma marca da app: barra com o símbolo e "Entrar", banner com o globo e
 * a frase da marca, "como funciona" em 3 passos, ferramentas agrupadas,
 * planos (dados reais da API), perguntas frequentes e rodapé. Tudo o que
 * aparece vem do backend (`tools`, `api.plans()`); nada é prometido além do
 * catálogo real.
 */
import { useEffect, useState } from 'react';
import { api, type Plan, type ToolPublic, useContacto, periodoCurto } from '../api';
import { CanaisOficiais } from '../components/CanaisOficiais';
import { Brand, PlanTag, Skeleton } from '../components/ui';
import { Icon } from '../components/Icons';
import Globo from '../components/Globo';
import { GRUPOS } from '../ia';

const PASSOS = [
  { n: '1', t: 'Diz o alvo', d: 'Username, nome, domínio, e-mail, telefone, IP ou URL. O tipo é detetado sozinho.' },
  { n: '2', t: 'Vê o plano', d: 'O ARGOS mostra o que vai correr, e o que fica bloqueado com o motivo, antes de gastar.' },
  { n: '3', t: 'Lê com prova', d: 'Achados com fonte, estado e confiança. Exporta em JSON, CSV, HTML e PDF.' },
];

const FAQ = [
  {
    q: 'Os resultados são inventados?',
    a: 'Não. Cada achado declara fonte, instante e confiança. Fonte em falha aparece como erro ou vazia, nunca como um resultado falso.',
  },
  {
    q: 'Preciso pagar para começar?',
    a: 'Não. O Free dá 15 execuções por dia, sem cartão. A ativação do Pro é manual via WhatsApp, depois de confirmares a transferência.',
  },
  {
    q: 'Isto invade contas ou redes?',
    a: 'Não. Só fontes públicas, com proveniência (LGPD). Sem login em redes sociais, sem scan ativo, sem Tor no backend.',
  },
];

export function Landing({ onStart, tools }: { onStart: () => void; tools: ToolPublic[] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const wa = useContacto();
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

  const nomes = new Set(tools.map((t) => t.id));
  const totalFerramentas = GRUPOS.reduce(
    (n, g) => n + g.ferramentas.filter((id) => nomes.has(id)).length, 0,
  );
  const irPara = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="lp">
      {/* ---------- Barra ---------- */}
      <nav className="lp-topo" aria-label="ARGOS">
        <Brand size={34} className="brand-plain" />
        <span className="grow" />
        <button type="button" className="lp-link" onClick={() => irPara('lp-ferramentas')}>Ferramentas</button>
        <button type="button" className="lp-link" onClick={() => irPara('planos')}>Planos</button>
        <button type="button" className="btn btn-primary lp-entrar" onClick={onStart}>Entrar</button>
      </nav>

      {/* ---------- Banner ---------- */}
      <header className="lp-hero lp-splash">
        <Globo />
        <img className="lp-splash-lobo" src="/brand/argos-a.png" width={148} height={148} alt="Lobo ARGOS" decoding="async" draggable={false} />
        <p className="lp-splash-nome">ARGOS</p>
        <p className="lp-splash-tag">Ferramentas OSINT para investigações digitais</p>
        <div className="lp-hero-txt">
          <p className="lp-marca">OSINT · Análise · Estratégia</p>
          <h1 className="lp-titulo">Informação<br />Revela <span>Poder</span></h1>
          <p className="lp-sub">
            Inteligência de presença pública em redes sociais.
            Cada achado diz <strong>de onde veio</strong>, quando e com que confiança,
            e o que não foi encontrado também está escrito.
          </p>
          <div className="lp-cta">
            <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
              Começar grátis <Icon.arrowRight />
            </button>
            <button type="button" className="btn btn-lg" onClick={() => irPara('lp-ferramentas')}>
              Ver ferramentas
            </button>
          </div>
          <p className="lp-trust">
            {totalFerramentas > 0 ? `${totalFerramentas} ferramentas ativas` : 'Ferramentas reais'} · Free com 15 execuções/dia · Sem cartão para começar
          </p>
        </div>
      </header>

      <main className="lp-corpo">
        {/* ---------- Como funciona ---------- */}
        <section className="lp-secao" aria-label="Como funciona">
          <h2 className="lp-h2">Como funciona</h2>
          <ol className="lp-passos">
            {PASSOS.map((p) => (
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
                    <span className="lp-grupo-txt">
                      <span className="lp-grupo-nome">{g.nome} <small className="lp-grupo-n">{reais.length}</small></span>
                      <span className="lp-grupo-d">{g.resumo}</span>
                    </span>
                    <span className="lp-grupo-ico"><Ico /></span>
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
                  <button className={`btn btn-block${p.priceBRL === 0 ? ' btn-primary' : ''}`} type="button" onClick={onStart}>
                    {p.priceBRL === 0 ? 'Começar grátis' : 'Escolher plano'}
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="lp-plano-nota">
            <PlanTag minPlan="pro" /> <span>marca as ferramentas que precisam do plano Pro.</span>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="lp-secao" aria-label="Perguntas frequentes">
          <h2 className="lp-h2">Perguntas frequentes</h2>
          <div className="lp-faq">
            {FAQ.map((f) => (
              <details key={f.q} className="lp-faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      {/* ---------- Rodapé ---------- */}
      <footer className="lp-rodape">
        <Brand size={28} className="brand-plain" />
        <span className="lp-rodape-copy">
          Um projeto do ecossistema Senhor Amorim<br />
          {wa?.copyright ?? '© 2026 SR. Amorim'} · Todos os direitos reservados.
        </span>
        <span className="lp-rodape-canais">
          <CanaisOficiais contacto={wa} titulo={false} />
          <a href="https://github.com/sramorim/argus" target="_blank" rel="noopener noreferrer">
            <Icon.code /> Código
          </a>
        </span>
      </footer>
    </div>
  );
}
