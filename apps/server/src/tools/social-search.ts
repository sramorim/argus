/**
 * Busca de pessoas pelo NOME em toda a web, agrupada por rede social.
 *
 * Porque é assim e não raspando as redes: Instagram, Facebook, TikTok, X e
 * LinkedIn não têm API pública para leitura de perfis e o acesso web está
 * fechado atrás de login. Raspar viola os termos de serviço e a plataforma
 * bloqueia a conta — uma ferramenta que prometa isso ou não devolve nada, ou
 * derruba o utilizador a meio da semana.
 *
 * O que se consulta aqui é o **índice do motor de busca**: páginas públicas que
 * o Bing já indexou. É um interface público e suportado (RSS), é a mesma
 * pesquisa que qualquer pessoa faz à mão, e chega exatamente onde o scraping
 * não chega — ao conteúdo público das grandes redes.
 *
 * IMPORTANTE sobre o que isto prova: os resultados são perfis públicos que
 * **mencionam o nome pesquisado**. Não é confirmação de que é a mesma pessoa.
 * Duas pessoas com o mesmo nome são o caso normal, não a exceção — por isso a
 * confiança começa em INDICADO e sobe só quando o utilizador confirma.
 */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding, type FindingValue } from '../net/provenance.ts';
import { bingRss, type WebHit } from '../net/sources.ts';

interface Rede {
  id: string;
  label: string;
  /** Restrição `site:` — vazia = toda a web. */
  filtro: string;
}

/**
 * Ordem por onde um investigador brasileiro procura primeiro: o geral, depois as
 * grandes, depois as de nicho. Cada rede é um pedido separado de propósito —
 * juntar `site:` num só pedido obriga a OR/parêntesis que o RSS do Bing não
 * interpreta bem, e um erro de operador silenciava uma rede inteira.
 */
const REDES: Rede[] = [
  { id: 'busca-web', label: 'Toda a web', filtro: '' },
  { id: 'busca-instagram', label: 'Instagram', filtro: 'site:instagram.com' },
  { id: 'busca-facebook', label: 'Facebook', filtro: 'site:facebook.com' },
  { id: 'busca-tiktok', label: 'TikTok', filtro: 'site:tiktok.com' },
  { id: 'busca-x', label: 'X (Twitter)', filtro: 'site:x.com' },
  { id: 'busca-twitter', label: 'Twitter (domínio antigo)', filtro: 'site:twitter.com' },
  { id: 'busca-linkedin', label: 'LinkedIn', filtro: 'site:linkedin.com/in' },
  { id: 'busca-youtube', label: 'YouTube', filtro: 'site:youtube.com' },
  { id: 'busca-threads', label: 'Threads', filtro: 'site:threads.net' },
  { id: 'busca-reddit', label: 'Reddit', filtro: 'site:reddit.com' },
  { id: 'busca-telegram', label: 'Telegram', filtro: 'site:t.me' },
  { id: 'busca-pinterest', label: 'Pinterest', filtro: 'site:pinterest.com' },
];

/** Caminhos que não são um utilizador — são secções da plataforma. */
const NAO_E_PERFIL = new Set([
  'in', 'p', 'u', 'user', 'users', 'c', 'channel', 'watch', 'results', 'search',
  'about', 'posts', 'videos', 'photos', 'reels', 'stories', 'topic', 'hashtag',
  'tag', 'feed', 'explore', 'home', 'pages', 'groups', 'profile', 'web',
  'company', 'school', 'jobs', 'embed', 'shorts', 'live', 'r', 'user',
]);

/** `https://instagram.com/ana.silva/?hl=en` → `@ana.silva`. */
function perfilDe(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\./, '');
  for (const bruto of u.pathname.split('/').filter(Boolean)) {
    const p = bruto.replace(/^@/, '');
    if (!p || NAO_E_PERFIL.has(bruto.toLowerCase()) || NAO_E_PERFIL.has(p.toLowerCase())) continue;
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(p)) continue;
    return `@${p}`;
  }
  return host;
}

/**
 * `1M Followers, 3,612 Following, 864 Posts` → `1M`.
 * As redes escrevem a contagem no snippet do índice — é o único sítio onde ela
 * aparece sem login, por isso se extrai de lá e não se inventa.
 */
function seguidoresDe(desc: string): string {
  const m = /([\d.,]+\s*[KkMmBb]?)\s*(?:followers|seguidores|seguidoras)/i.exec(desc);
  return m ? m[1].replace(/\s+/g, '') : '';
}

function bioDe(desc: string): string {
  if (!desc) return '';
  // O Bing costuma colar "X Followers, Y Following, Z Posts - bio".
  const depois = desc.replace(/^[\d.,]+\s*[KkMmBb]?\s*followers?,?\s*/i, '')
    .replace(/^[\d.,]+\s*following,?\s*/i, '')
    .replace(/^[\d.,]+\s*posts?,?\s*/i, '')
    .replace(/^\d+\s*[KkMmBb]?\s*(?:seguidores|posts)\s*[-–—,]?\s*/i, '')
    .trim();
  return (depois || desc).replace(/\s+/g, ' ').slice(0, 150);
}

/** Uma URL vista duas vezes é o mesmo perfil — conta-se uma vez. */
function chave(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch { return url.toLowerCase(); }
}

interface Achado {
  Perfil: string;
  Nome: string;
  Bio: string;
  Seguidores: string;
  Link: string;
}

registerTool({
  id: 'social-search',
  name: 'Busca por Nome nas Redes',
  category: 'pessoa',
  summary: 'Procura um nome em toda a web e devolve os perfis públicos encontrados, agrupados por rede social.',
  longDesc: 'Pesquisa o nome no índice do Bing (interface RSS público, sem chave) com uma consulta por rede: Instagram, Facebook, TikTok, X, Twitter, LinkedIn, YouTube, Threads, Reddit, Telegram e Pinterest — mais uma busca sem restrição em toda a web. Para cada resultado devolve o perfil, o nome, a bio e os seguidores quando aparecem no snippet. Não raspa nenhuma rede: consulta o motor de busca, que é como qualquer pessoa pesquisaria à mão. Os resultados são perfis que MENCIONAM o nome — confirmar que é a mesma pessoa depende de quem investiga, por isso a confiança começa em INDICADO.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['nome', 'redes sociais', 'busca', 'instagram', 'facebook', 'tiktok', 'x', 'perfil'],
  fields: [
    { name: 'name', label: 'Nome da pessoa', type: 'text', placeholder: 'Nome Exemplo', required: true,
      hint: 'Entre aspas funciona melhor: "Nome Exemplo". Podes acrescentar cidade ou empresa.' },
    { name: 'network', label: 'Restringir a uma rede (opcional)', type: 'text', placeholder: 'instagram', required: false,
      hint: 'instagram, facebook, tiktok, x, twitter, linkedin, youtube, threads, reddit, telegram, pinterest. Vazio = todas.' },
  ],
  async run(input) {
    const nome = String(input.name ?? '').trim().replace(/^["']|["']$/g, '');
    const filtroRede = String(input.network ?? '').trim().toLowerCase();
    const log = new SourceLog();
    const out: Finding[] = [];

    if (!nome) {
      log.empty('busca-web', 'Bing RSS (pesquisa web)', 'https://www.bing.com/search', 0, 'sem nome indicado');
      out.push(finding('resumo', 'Busca',
        'Sem nome indicado. Escreve o nome completo — entre aspas funciona melhor — e acrescenta cidade ou empresa se souberes.',
        ['busca-web'], { kind: 'inference', confidence: 'confirmed' }));
      return { findings: out, log };
    }

    const alvo = `"${nome}"`;
    let redes = REDES;
    if (filtroRede) {
      redes = REDES.filter((r) => r.id.replace('busca-', '') === filtroRede || r.label.toLowerCase() === filtroRede);
      if (!redes.length) {
        log.note(`A rede "${filtroRede}" não está na lista. Estão disponíveis: ${REDES.filter((r) => r.filtro).map((r) => r.id.replace('busca-', '')).join(', ')}. A correr todas.`);
        redes = REDES;
      }
    }

    // Todos os pedidos são independentes: correm em paralelo. Um falhar não
    // pode impedir os outros — cada rede é registada como fonte própria.
    const resultados = await Promise.all(redes.map(async (r) => {
      const q = r.filtro ? `${alvo} ${r.filtro}` : alvo;
      try { return { r, hits: await bingRss(q, log, r.id) }; }
      catch (e) {
        log.error(r.id, 'Bing RSS (pesquisa web)', 'https://www.bing.com/search', String((e as Error).message).slice(0, 70));
        return { r, hits: [] as WebHit[] };
      }
    }));

    let total = 0;
    const vistas = new Set<string>();

    for (const { r, hits } of resultados) {
      const achados: Achado[] = [];
      for (const h of hits) {
        const k = chave(h.url);
        // "Toda a web" é um espelho dos outros: deduplica contra o que já saiu.
        if (vistas.has(k)) continue;
        vistas.add(k);
        achados.push({
          Perfil: perfilDe(h.url) || r.label,
          Nome: h.titulo.slice(0, 90),
          Bio: bioDe(h.descricao ?? ''),
          Seguidores: seguidoresDe(h.descricao ?? '') || '—',
          Link: h.url,
        });
      }
      if (!achados.length) continue;
      total += achados.length;
      out.push(finding(r.label, 'Perfis encontrados', achados as unknown as FindingValue, [r.id], {
        confidence: 'indicated',
      }));
    }

    if (total) {
      // Uma rede devolve uma só linha de achados, por isso a contagem por grupo
      // é o comprimento desse array — lido aqui em vez de confiar no tipo união
      // de `Finding.value`, que também aceita escalar.
      const contagem = new Map<string, number>();
      for (const f of out) {
        if (!Array.isArray(f.value)) continue;
        contagem.set(f.group, (contagem.get(f.group) ?? 0) + f.value.length);
      }
      const comResultado = [...contagem].filter(([, n]) => n > 0).map(([g, n]) => `${g} (${n})`);
      out.unshift(finding('resumo', 'Redes com resultado', comResultado.join(' · '), ['busca-web'], { confidence: 'confirmed' }));
      out.unshift(finding('resumo', 'Perfis encontrados (sem repetir)', total, ['busca-web'], { confidence: 'confirmed' }));
      out.unshift(finding('resumo', 'Nome pesquisado', `"${nome}"`, ['local'], { kind: 'inference', confidence: 'confirmed' }));
      out.push(finding('resumo', 'O que isto significa',
        'São perfis públicos que mencionam o nome pesquisado. Não provam que é a mesma pessoa — homónimos são o caso normal. Confirma pelo perfil, bio e cidade antes de tratar como identidade.',
        ['local'], { kind: 'inference', confidence: 'indicated' }));
      log.local(total, 'agrupamento por rede, remoção de repetidos e extração de perfil/seguidores do snippet');
    } else {
      log.empty('busca-web', 'Bing RSS (pesquisa web)', 'https://www.bing.com/search', 0,
        `sem resultados para "${nome}"`);
      log.note(`O Bing não devolveu nada para "${nome}". Tenta com aspas, com cidade ou empresa junto, ou com o username em vez do nome.`);
      out.push(finding('resumo', 'Perfis encontrados (sem repetir)', 0, ['busca-web'],
        { kind: 'inference', confidence: 'confirmed' }));
      out.push(finding('resumo', 'O que isto significa',
        `Nenhum resultado no índice do pesquisa web para "${nome}". Isto não significa que a pessoa não exista — significa que o índice não devolveu nada para esta consulta.`,
        ['busca-web'], { kind: 'inference', confidence: 'indicated' }));
    }

    return { findings: out, log };
  },
});
