/** Localizador de username: presença confirmada vs. apenas indicada, em 15 plataformas. */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch } from '../net/ssrf.ts';

// ---------------- USERNAME FINDER ----------------
type Strategy = 'status' | 'content';

interface Platform { id: string; label: string; url: (u: string) => string; strategy: Strategy; note?: string }

const PLATFORMS: Platform[] = [
  { id: 'reddit', label: 'Reddit', url: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`, strategy: 'status' },
  { id: 'telegram', label: 'Telegram', url: (u) => `https://t.me/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'twitch', label: 'Twitch', url: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'pinterest', label: 'Pinterest', url: (u) => `https://www.pinterest.com/${encodeURIComponent(u)}/`, strategy: 'content' },
];

/*
 * Redes que bloqueiam a verificação a partir de servidores de datacenter
 * (é por isso que existem serviços pagos de scraping). Em vez de inventar um
 * resultado ou falhar em silêncio, o ARGOS dá o LINK DIRETO do perfil para a
 * pessoa abrir e conferir à mão — honesto e útil.
 */
const CONFERIR: { id: string; label: string; url: (u: string) => string }[] = [
  { id: 'instagram', label: 'Instagram', url: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/` },
  { id: 'facebook', label: 'Facebook', url: (u) => `https://www.facebook.com/${encodeURIComponent(u)}` },
  { id: 'tiktok', label: 'TikTok', url: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}` },
  { id: 'x', label: 'X (Twitter)', url: (u) => `https://x.com/${encodeURIComponent(u)}` },
];

/** Normaliza o corpo para comparar comprimentos sem ruido de ids/timestamps. */
function normalize(b: string): string {
  return b.replace(/[0-9a-f]{16,}/gi, '').replace(/\d{4,}/g, '').replace(/\s+/g, ' ');
}

/**
 * Isola os <title>/og:title/<h1> de SPAs de redes sociais.
 *
 * Sem isto, um perfil inexistente e um existente devolvem paginas quase
 * identicas (mesma SPA, mesmo cabecalho) e a diferenca de comprimento fica
 * dentro do ruido — o pior erro possivel: dizer "confirmado" de alguem que nao
 * existe. O que distingue os dois casos e a MENSAGEM que a rede social mostra
 * ao visitante, e e isso que comparamos.
 *
 * **Normaliza o username.** Este detalhe é o que fecha o falso positivo mais
 * subtil que já houve aqui: o Telegram escreve `<title>Telegram: Contact
 * @username</title>`. Comparado com a baseline de um username aleatório, esse
 * título é SEMPRE diferente — e a ferramenta confirmava perfis que não
 * existem. Trocando o username por um marcador antes de comparar, a diferença
 * passa a ser só a que interessa: "o perfil é o mesmo" vs "a conta não existe".
 */
function identityMarker(body: string, username: string): string {
  const norm = (t: string) => {
    if (!username) return t;
    const esc = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t.replace(new RegExp(esc, 'gi'), '\u0000USER\u0000').replace(/\u0000/g, '\u0001').replace(/\u0001USER\u0001/g, '\u0001');
  };
  const head = body.slice(0, 60_000);
  const bits: string[] = [];
  const t = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(head);
  if (t) bits.push('T:' + norm(t[1].replace(/\s+/g, ' ').trim().slice(0, 200)));
  const re = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:title|og:description|description|profile:username)["'][^>]*content\s*=\s*["']([^"']{0,400})["']/gi;
  for (const m of head.matchAll(re)) bits.push('M:' + norm(m[1].replace(/\s+/g, ' ').trim().slice(0, 240)));
  const h1 = /<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i.exec(head);
  if (h1) bits.push('H:' + norm(h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)));
  const marker = bits.join(' | ').slice(0, 700);
  // Titulo generico da plataforma (Cloudflare, erro, redireccionamento) nao diz nada.
  return /^(just a moment|attention required|redirecting|access denied|error|page not found|perfil)/i.test(marker.trim()) ? '' : marker;
}

/** Frases que dizem explicitamente "isto nao existe", mesmo com HTTP 200. */
const NOT_FOUND_TEXT = /page not found|user not found|doesn'?t exist|does not exist|no such user|perfil (n[aã]o )?encontrad[oa]|conta n[aã]o encontrada|this account doesn'?t exist|content not found|尚未找到/i;

registerTool({
  id: 'username-finder',
  name: 'Localizador de Username',
  category: 'pessoa',
  summary: 'Procura o username em redes sociais e dá o link direto de Instagram, Facebook, TikTok e X para conferir.',
  longDesc: 'Confirma o username em Reddit, Telegram, Twitch e Pinterest, separando CONFIRMADO de INDICADO. Instagram, Facebook, TikTok e X bloqueiam servidores — para esses, mostra o link direto do perfil para voce abrir e conferir na hora, sem inventar resultado.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['username', 'redes', 'perfis', 'identidade'],
  fields: [{ name: 'username', label: 'Username', type: 'text', placeholder: 'ex: alvo_demo', required: true, hint: 'Sem @ nem URL' }],
  async run(input) {
    const user = String(input.username ?? '').trim().replace(/^@/, '');
    const log = new SourceLog();
    const out: Finding[] = [];
    const found: Record<string, { label: string; url: string; conf: 'confirmed' | 'indicated'; via: string }> = {};

    const baselines = new Map<string, { status: number; len: number; marker: string }>();
    const randomUser = 'zzargus' + Math.random().toString(36).slice(2, 12) + 'q';

    // As paginas do alvo E as baselines correm em paralelo: sao independentes e
    // uma leva de rede em vez de duas encadeadas.
    const baselineJobs = PLATFORMS.filter((p) => p.strategy === 'content').map(async (p) => {
      try {
        const rb = await safeFetch(p.url(randomUser), { timeoutMs: 10_000, maxBytes: 900_000 });
        baselines.set(p.id, { status: rb.status, len: normalize(rb.body).length, marker: identityMarker(rb.body, randomUser) });
      } catch { baselines.set(p.id, { status: 0, len: -1, marker: '' }); }
    });

    const results = await Promise.all(PLATFORMS.map(async (p) => {
      const url = p.url(user);
      try {
        const r = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 900_000 });
        return { p, r };
      } catch (e) {
        return { p, r: null, err: String((e as Error).message) };
      }
    }));
    await Promise.all(baselineJobs);

    for (const { p, r, err } of results) {
      const url = p.url(user);
      if (!r) { log.error(p.id, p.label, url, err ?? 'erro'); continue; }

      if (p.strategy === 'status') {
        if (r.status === 200) {
          const norm = normalize(r.body);
          // Resposta minuscule + texto de "nao encontrado" = perfil inexistente com 200.
          const isNotFound = NOT_FOUND_TEXT.test(r.body.slice(0, 8000)) || (norm.length < 220 && NOT_FOUND_TEXT.test(r.body));
          if (!isNotFound && norm.length >= 60) {
            log.ok(p.id, p.label, url, r.ms, 1);
            found[p.id] = { label: p.label, url, conf: 'confirmed', via: 'HTTP 200 sem pagina de erro' };
          } else {
            log.empty(p.id, p.label, url, r.ms, isNotFound ? 'a resposta diz que o perfil nao existe' : 'resposta demasiado curta (' + norm.length + ' chars)');
          }
        } else { log.empty(p.id, p.label, url, r.ms, 'HTTP ' + r.status); }
        continue;
      }
      // content diff (baseline ja buscada em paralelo acima)
      const base = baselines.get(p.id) ?? { status: 0, len: -1, marker: '' };
      if (r.status >= 400) { log.empty(p.id, p.label, url, r.ms, 'HTTP ' + r.status); continue; }
      if (p.id === 'telegram') {
        // t.me devolve uma página para QUALQUER username; só há conta quando
        // existe o bloco `tgme_page_title`. Decidir por isto (e não pelo
        // tamanho da página) elimina o falso positivo do Telegram.
        if (/tgme_page_title/i.test(r.body)) {
          log.ok(p.id, p.label, url, r.ms, 1, 'página pública t.me com perfil');
          found[p.id] = { label: p.label, url, conf: 'confirmed', via: 'página pública t.me/<user> existe' };
        } else {
          log.empty(p.id, p.label, url, r.ms, 'sem conta pública no Telegram');
        }
        continue;
      }
      if (base.len <= 0) {
        log.skipped(p.id, p.label, url, 'baseline indisponivel, nao compativel com comparacao');
        continue;
      }
      const notFound = NOT_FOUND_TEXT.test(r.body.slice(0, 8000));
      // Sinal 1 (forte): o que a rede social DIZ ao visitante difere da baseline.
      const marker = identityMarker(r.body, user);
      if (marker && base.marker && marker !== base.marker && !notFound) {
        log.ok(p.id, p.label, url, r.ms, 1, 'titulo/descricao do perfil diferentes da baseline');
        found[p.id] = { label: p.label, url, conf: 'confirmed', via: 'identidade do perfil na pagina difere de um username inexistente' };
        continue;
      }
      // Sinal 2 (fraco): o corpo difere em tamanho. Mantido so como INDICADO.
      const tl = normalize(r.body).length;
      const diff = Math.abs(tl - base.len);
      const threshold = Math.max(2000, base.len * 0.06);
      if (diff > threshold && !notFound) {
        log.ok(p.id, p.label, url, r.ms, 1, 'conteudo difere ' + diff + ' chars da baseline');
        found[p.id] = { label: p.label, url, conf: 'indicated', via: 'diferenca de conteudo vs. username inexistente' };
      } else {
        log.empty(p.id, p.label, url, r.ms, 'sem sinal de perfil (titulo igual a baseline; diff ' + diff + ')');
      }
    }

    const confirmed = Object.entries(found).filter(([, v]) => v.conf === 'confirmed');
    const indicated = Object.entries(found).filter(([, v]) => v.conf === 'indicated');

    out.push(finding('resumo', 'Username pesquisado', user, [], { confidence: 'confirmed' }));
    out.push(finding('resumo', 'Confirmados (' + confirmed.length + ')',
      confirmed.length ? confirmed.map(([k, v]) => ({ plataforma: v.label, url: v.url, via: v.via })) : 'nenhum',
      confirmed.map(([k]) => k), { confidence: confirmed.length ? 'corroborated' : 'weak' }));
    if (indicated.length) {
      out.push(finding('resumo', 'Indicados, nao confirmados (' + indicated.length + ')',
        indicated.map(([k, v]) => ({ plataforma: v.label, url: v.url, via: v.via })),
        indicated.map(([k]) => k), { kind: 'inference', confidence: 'indicated' }));
    }
    for (const [id, v] of Object.entries(found)) {
      // `attrs.plataforma`/`url`/`username` são o que o intel lê para montar a
      // conta unificada: sem eles o nó existe mas a plataforma vista fica por
      // dizer e o Presence Radar não compara nada.
      out.push(finding('plataforma', v.label, v.url, [id],
        { confidence: v.conf, link: v.url, kind: v.conf === 'confirmed' ? 'fact' : 'inference',
          attrs: { plataforma: v.label, url: v.url, username: user } }));
      // Alimenta a grelha "Perfis encontrados" do resultado (como no mockup).
      if (v.conf === 'confirmed') {
        out.push(finding('encontrado', v.label, { platform: v.label, url: v.url, username: user },
          [id], { confidence: 'corroborated', link: v.url }));
      }
    }
    // Redes que bloqueiam servidores: o link direto para conferir à mão.
    for (const c of CONFERIR) {
      const url = c.url(user);
      out.push(finding('conferir', c.label, url, ['local'], { kind: 'claim', confidence: 'weak', link: url }));
    }
    log.note('Instagram, Facebook, TikTok e X bloqueiam a verificação a partir de servidores — para esses, o link direto abre o perfil para você conferir. Nada é inventado.');
    if (!Object.keys(found).length) log.note('Nenhuma plataforma confirmada. Pode nao existir, ou o username e diferente por plataforma.');
    log.note('"Confirmado" = HTTP inequivoco ou titulo/descricao do perfil diferentes dos de um username inexistente. "Indicado" = so o corpo da pagina difere (pode ser falso positivo).');
    log.local(1, 'Geracao de username aleatorio para baseline e comparacao de marcadores');
    return { findings: out, log };
  },
});

