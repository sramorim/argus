/**
 * Landing pública.
 *
 * Ordem pensada para quem chega do telemóvel, com pouca paciência e zero
 * contexto: o que é isto → porque é diferente → o que entrega → quanto custa →
 * como entro. Nada de blocos vazios nem de "funcionalidades infinitas".
 */
import { useEffect, useState } from 'react';
import { api, type Plan, type ToolPublic, CONTACTO } from '../api';
import { Icon, CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_ORDER } from '../components/Icons';
import { Mark, PlanTag, Skeleton } from '../components/ui';

export function Landing({ onStart, tools }: { onStart: () => void; tools: ToolPublic[] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);

  const free = tools.filter((t) => t.lock === 'open').length;

  const featured = useMemoFeatured(tools);
  const caps = [
    { i: Icon.network, t: 'Grafo de investigação', d: 'Começa por um alvo e vê o que aparece: contas, domínios, emails, infra. Cada nó diz de que fonte veio e com que confiança.' },
    { i: Icon.database, t: 'Proveniência em tudo', d: 'Cada achado aponta para a fonte que o sustenta. Fonte que falhou aparece como falhou — nunca escondida atrás de um resultado parcial.' },
    { i: Icon.shield, t: 'Só fontes públicas e reais', d: 'RDAP, DNS-over-HTTPS, Certificate Transparency, NVD, OSV, BrasilAPI, abuse.ch, GitHub. Cada uma foi testada com alvos reais antes de entrar.' },
    { i: Icon.phone, t: 'Feito para o telemóvel', d: 'Pesquisar, investigar e ler os resultados com o polegar. A mesma arquitetura serve o desktop, sem duas interfaces para manter.' },
  ];

  return (
    <>
      <header className="topbar-landing" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0' }}>
        <Mark size={30} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 720, letterSpacing: '.22em' }}>ARGUS</div>
          <div className="t-xs dim" style={{ letterSpacing: '.12em', textTransform: 'uppercase', fontSize: 9.5 }}>Fontes abertas</div>
        </div>
        <span className="grow" style={{ flex: 1 }} />
        <a className="btn btn-quiet btn-sm" href={`https://wa.me/${CONTACTO.whatsapp}`}
          target="_blank" rel="noopener noreferrer">falar connosco</a>
      </header>

      <section className="hero">
        <span className="hero-kicker">Inteligência de fontes abertas</span>
        <h1 className="t-display">
          Investigue o que é <span className="mark-red">público</span>,<br />com a proveniência à vista.
        </h1>
        <p className="lead">
          O ARGUS cruza fontes abertas reais para responder a perguntas sobre domínios, IPs,
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
          <div><div className="v num">{tools.length || '—'}</div><div className="l">ferramentas</div></div>
          <div><div className="v num">{free || '—'}</div><div className="l">gratuitas no Free</div></div>
          <div><div className="v num">0</div><div className="l">dados inventados</div></div>
          <div><div className="v num">100%</div><div className="l">com origem declarada</div></div>
        </div>
      </section>

      <section className="section">
        <h2 className="t-h2">O que o ARGUS faz</h2>
        <p className="muted t-sm">Quatro capacidades. Todas com fontes reais por trás.</p>
        <div className="feat-grid">
          {caps.map((c) => (
            <div className="feat" key={c.t}>
              <div className="feat-ico"><c.i /></div>
              <h4>{c.t}</h4>
              <p>{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="t-h2">Ferramentas</h2>
        <p className="muted t-sm">
          {tools.length} registadas. Só entram as que funcionam — cada uma foi testada contra alvos
          reais antes de estar aqui.
        </p>
        <div className="tool-grid">
          {featured.map((t) => {
            const Ico = CATEGORY_ICON[t.category] ?? Icon.grid;
            return (
              <button className="tool-card" type="button" key={t.id} data-locked={t.lock === 'locked'} onClick={onStart}>
                <div className="tool-top">
                  <span className="tool-glyph"><Ico /></span>
                  <span className="tool-name">{t.name}</span>
                </div>
                <div className="tool-sum">{t.summary}</div>
                <div className="tool-foot">
                  {t.lock === 'locked' ? <PlanTag minPlan={t.minPlan} /> : <PlanTag minPlan="free" />}
                  <span className="tag">{CATEGORY_LABEL[t.category] ?? t.category}</span>
                </div>
              </button>
            );
          })}
        </div>
        {tools.length > featured.length && (
          <button className="btn btn-quiet" style={{ marginTop: 14 }} type="button" onClick={onStart}>
            ver as {tools.length} ferramentas →
          </button>
        )}
      </section>

      <section className="section" id="planos">
        <h2 className="t-h2">Planos</h2>
        <p className="muted t-sm">O Free não expira e não pede cartão. Paga-se quando precisas de mais volume.</p>
        {plans === null ? <Skeleton lines={4} /> : (
          <div className="plan-grid">
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
                  {p.priceBRL === 0 ? 'começar grátis' : 'escolher'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="t-h2">Perguntas honestas</h2>
        <div className="feat-grid" style={{ marginTop: 14 }}>
          <Faq q="Isto é legal?" a="O ARGUS só consulta fontes públicas: registos RDAP, DNS, logs de transparência de certificados, bases de vulnerabilidades, registos de empresas e perfis públicos. Não faz varredura ativa, não compra dados e não acede a sistemas. O uso responsável continua a ser responsabilidade de quem o usa — há um aviso em cada ferramenta com dados pessoais." />
          <Faq q="Os dados de contacto são inventados?" a="Não. O que vem de uma fonte vem com o nome, o endereço e o estado dessa fonte. O que é cálculo local (parse de EXIF, pHash, validação de número) é rotulado como tal. E o que não coube numa resposta aparece como 'precisa de chave' ou 'erro' — nunca preenchido com algo plausível." />
          <Faq q="Guardam o que eu pesquiso?" a="Guardamos a sua conta e o histórico das suas execuções, para conseguir mostrar-lhe o resultado outra vez. Os alvos que pesquisa não são guardados numa base de dados de vigilância — só no histórico, que pode apagar quando quiser." />
          <Faq q="Como pago o Pro?" a={`A ativação é feita à mão, depois de confirmada a transferência — não há gateway de pagamento, e nenhum cartão passa por este site. Escolhes o plano, o ARGUS abre o WhatsApp com o pedido já escrito (${CONTACTO.label}) e combinamos daí para a frente.`} />
        </div>
      </section>

      <footer className="foot t-sm dim">
        <span>ARGUS — ferramenta de investigação de fontes abertas. Uso defensivo e legítimo.</span>
        <span>
          Projeto da Central Amorim ·{' '}
          <a className="silver" href={`https://wa.me/${CONTACTO.whatsapp}`} target="_blank" rel="noopener noreferrer">
            {CONTACTO.label}
          </a>
        </span>
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

/** tools em destaque: uma por categoria, para o cartão não repetir a mesma coisa. */
function useMemoFeatured(tools: ToolPublic[]): ToolPublic[] {
  const seen = new Set<string>();
  const out: ToolPublic[] = [];
  const ordered = [...tools].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
  for (const t of ordered) {
    if (seen.has(t.category)) continue;
    seen.add(t.category);
    out.push(t);
    if (out.length === 8) break;
  }
  return out;
}

export { CATEGORY_ORDER };
