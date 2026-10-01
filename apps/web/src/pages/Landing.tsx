/**
 * Landing pública.
 *
 * A ordem responde a quem chega do telemóvel, sem contexto e sem paciência:
 * o que é isto → porque é diferente → o que entrega → quanto custa → como entro.
 *
 * Três tipos de número, e a diferença entre eles é o produto inteiro:
 * 26 ferramentas · 0 dados inventados · 100% com origem declarada.
 */
import { useEffect, useState } from 'react';
import { api, type Plan, type ToolPublic, useContacto } from '../api';
import { Icon } from '../components/Icons';
import { Mark, PlanTag, Skeleton } from '../components/ui';
import { GRUPOS, porGrupo } from '../ia';

export function Landing({ onStart, tools }: { onStart: () => void; tools: ToolPublic[] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const wa = useContacto();
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

  const livres = tools.filter((t) => t.lock === 'open').length;
  const emDestaque = GRUPOS.map((g) => ({ g, lista: porGrupo(tools, g.id) })).filter((x) => x.lista.length);

  const capacidades = [
    {
      i: Icon.network, t: 'Um alvo, tudo ligado',
      d: 'Começa por um username, um domínio, um telefone. O ARGOS escolhe as ferramentas certas, cruza o que encontra e mostra as relações num grafo.',
    },
    {
      i: Icon.database, t: 'Proveniência em tudo',
      d: 'Cada achado diz de que fonte veio, quando e com que grau de confiança. Fonte que falhou aparece como falhou — nunca escondida atrás de um resultado parcial.',
    },
    {
      i: Icon.shield, t: 'Só fontes públicas e reais',
      d: 'RDAP, DNS-over-HTTPS, Certificate Transparency, NVD, OSV, BrasilAPI, abuse.ch, GitHub. Cada uma foi testada com alvos reais antes de entrar no catálogo.',
    },
    {
      i: Icon.phone, t: 'Feito para o telemóvel',
      d: 'Pesquisar, investigar e ler resultados com o polegar. A mesma arquitectura serve o desktop, sem duas interfaces para manter.',
    },
  ];

  return (
    <>
      <header className="topbar-landing" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 0' }}>
        <Mark size={30} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 720, letterSpacing: '.2em' }}>ARGOS</div>
          <div className="t-xs dim" style={{ letterSpacing: '.13em', textTransform: 'uppercase', fontSize: 9.5 }}>Fontes abertas</div>
        </div>
        <span style={{ flex: 1 }} />
        {wa && (
          <a className="btn btn-quiet btn-sm" href={wa.link} target="_blank" rel="noopener noreferrer">
            falar connosco
          </a>
        )}
      </header>

      {/* ---------------- herói ---------------- */}
      <section className="hero">
        <span className="hero-kicker">Inteligência de fontes abertas</span>
        <h1 className="t-display" style={{ marginTop: 'var(--s-4)' }}>
          Investigue o que é <span className="blue">público</span>,<br />com a proveniência à vista.
        </h1>
        <p className="lead">
          O ARGOS cruza fontes abertas reais para responder a perguntas sobre domínios, IPs,
          perfis, empresas, carteiras e vulnerabilidades. Cada resultado diz <b>de onde veio</b>,
          quando e com que grau de confiança. Não há mock, não há resultado plausível inventado,
          e não há fonte que responda 200 e finja que tem dados.
        </p>
        <div className="hero-cta">
          <button className="btn btn-primary btn-lg" type="button" onClick={onStart}>criar conta grátis</button>
          <button className="btn btn-lg" type="button" onClick={() => document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth' })}>
            ver planos
          </button>
        </div>
        <div className="hero-stats">
          <div><div className="v">{tools.length || '—'}</div><div className="l">ferramentas</div></div>
          <div><div className="v">{livres || '—'}</div><div className="l">gratuitas no Free</div></div>
          <div><div className="v">0</div><div className="l">dados inventados</div></div>
          <div><div className="v">100%</div><div className="l">com origem declarada</div></div>
        </div>
      </section>

      {/* ---------------- capacidades ---------------- */}
      <section className="section">
        <h2 className="t-h2">O que o ARGOS faz</h2>
        <p className="muted t-sm">Quatro capacidades. Todas com fontes reais por trás.</p>
        <div className="feat-grid" style={{ marginTop: 'var(--s-4)' }}>
          {capacidades.map((c) => (
            <div className="feat" key={c.t}>
              <div className="feat-ico"><c.i /></div>
              <h4>{c.t}</h4>
              <p>{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- ferramentas por objetivo ---------------- */}
      <section className="section">
        <h2 className="t-h2">Ferramentas</h2>
        <p className="muted t-sm">
          {tools.length} registadas, organizadas pelo que queres fazer. Só entram as que
          funcionam — cada uma foi testada contra alvos reais antes de estar aqui.
        </p>
        <div className="grid grid-2" style={{ marginTop: 'var(--s-4)' }}>
          {emDestaque.map(({ g, lista }) => {
            const Ico = g.icon;
            return (
              <article className="card" key={g.id}>
                <div className="layer-card-head">
                  <span className="layer-card-ico"><Ico /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="card-title">{g.nome}</div>
                    <div className="card-sub">{g.resumo}</div>
                  </div>
                  <span className="layer-card-n">{lista.length}</span>
                </div>
                <div className="layer-list">
                  {lista.map((t) => (
                    <div className="nav-item" key={t.id} style={{ cursor: 'default' }}>
                      <span className="nav-label-txt">{t.name}</span>
                      {t.lock === 'locked' ? <PlanTag minPlan={t.minPlan} /> : <span className="tag tag-free">GRÁTIS</span>}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ---------------- planos ---------------- */}
      <section className="section" id="planos">
        <h2 className="t-h2">Planos</h2>
        <p className="muted t-sm">O Free não expira e não pede cartão. Paga-se quando precisas de mais volume.</p>
        {plans === null ? <Skeleton lines={4} /> : (
          <div className="plan-grid" style={{ marginTop: 'var(--s-4)' }}>
            {plans.map((p) => (
              <div className="plan-card" key={p.id}>
                <div className="plan-name">{p.name}</div>
                <div className="plan-price">
                  {p.priceBRL === 0 ? 'Grátis' : `R$ ${p.priceBRL.toFixed(2).replace('.', ',')}`}
                  {p.priceBRL > 0 && <small> /mês</small>}
                </div>
                <div className="plan-note">{p.highlight}</div>
                <ul className="plan-perks">
                  {p.perks.map((k) => <li key={k}>{k}</li>)}
                </ul>
                <button className="btn btn-block btn-quiet" type="button" onClick={onStart}>
                  {p.priceBRL === 0 ? 'começar grátis' : 'escolher plano'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- honestidade ---------------- */}
      <section className="section">
        <h2 className="t-h2">Perguntas honestas</h2>
        <div className="feat-grid" style={{ marginTop: 'var(--s-4)' }}>
          <Faq q="Isto é legal?" a="O ARGOS só consulta fontes públicas: registos RDAP, DNS, logs de transparência de certificados, bases de vulnerabilidades, registos de empresas e perfis públicos. Não faz varredura ativa, não compra dados e não acede a sistemas de ninguém. O uso responsável continua a ser responsabilidade de quem o usa — há um aviso em cada ferramenta com dados pessoais." />
          <Faq q="Os dados são inventados?" a="Não. O que vem de uma fonte vem com o nome, o endereço e o estado dessa fonte. O que é cálculo local (parse de EXIF, pHash, validação de número) é rotulado como tal. E o que não coube numa resposta aparece como 'precisa de chave' ou 'erro' — nunca preenchido com algo plausível." />
          <Faq q="Guardam o que eu pesquiso?" a="Guardamos a sua conta e o histórico das suas execuções, para conseguir mostrar-lhe o resultado outra vez. Os alvos que pesquisa não vão para uma base de dados de vigilância — só para o seu histórico, que pode apagar quando quiser." />
          <Faq q="Como pago o Pro?" a={`A ativação é feita à mão, depois de confirmada a transferência — não há gateway de pagamento, e nenhum cartão passa por este site. Escolhes o plano, o ARGOS abre o WhatsApp com o pedido já escrito (${wa?.label ?? 'WhatsApp'}) e combinamos daí para a frente.`} />
        </div>
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
    </>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="feat">
      <h4>{q}</h4>
      <p>{a}</p>
    </div>
  );
}
