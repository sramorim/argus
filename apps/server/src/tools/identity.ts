/** Ferramentas de identidade: username, email, telefone, Telegram, leak, password. */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch, apiGet } from '../net/ssrf.ts';
import { doh, pwnedPasswords, certspotter, crtsh } from '../net/sources.ts';
import { cached } from '../db.ts';

// ---------------- USERNAME FINDER ----------------
type Strategy = 'api' | 'status' | 'content';

interface Platform { id: string; label: string; url: (u: string) => string; strategy: Strategy; note?: string }

const PLATFORMS: Platform[] = [
  { id: 'github', label: 'GitHub', url: (u) => `https://api.github.com/users/${encodeURIComponent(u)}`, strategy: 'api' },
  { id: 'gitlab', label: 'GitLab', url: (u) => `https://gitlab.com/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'x', label: 'X (Twitter)', url: (u) => `https://x.com/${encodeURIComponent(u)}`, strategy: 'status' },
  { id: 'instagram', label: 'Instagram', url: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`, strategy: 'content' },
  { id: 'tiktok', label: 'TikTok', url: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'reddit', label: 'Reddit', url: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`, strategy: 'status' },
  { id: 'telegram', label: 'Telegram', url: (u) => `https://t.me/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'twitch', label: 'Twitch', url: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'pinterest', label: 'Pinterest', url: (u) => `https://www.pinterest.com/${encodeURIComponent(u)}/`, strategy: 'content' },
  { id: 'patreon', label: 'Patreon', url: (u) => `https://www.patreon.com/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'soundcloud', label: 'SoundCloud', url: (u) => `https://soundcloud.com/${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'keybase', label: 'Keybase', url: (u) => `https://keybase.io/${encodeURIComponent(u)}`, strategy: 'status' },
  // Medium responde 200 a TUDO (SPA). Decide-se pelo og:title, como as outras SPAs:
  { id: 'medium', label: 'Medium', url: (u) => `https://medium.com/@${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'npm', label: 'npm', url: (u) => `https://www.npmjs.com/~${encodeURIComponent(u)}`, strategy: 'content' },
  { id: 'hackernews', label: 'Hacker News', url: (u) => `https://news.ycombinator.com/user?id=${encodeURIComponent(u)}`, strategy: 'status' },
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
  summary: 'Procura um username em 15 plataformas, distinguindo confirmado de apenas indicado.',
  longDesc: 'Verifica o mesmo username em 15 plataformas com tres estrategias: API oficial (GitHub), codigo HTTP (X, Keybase, Hacker News) e comparacao contra um username inexistente gerado ao acaso (SPAs como Instagram, TikTok, GitLab). Separa CONFIRMADO de INDICADO e nunca trata "a pagina carregou" como "o perfil existe": nas SPAs compara-se o que a rede social DIZ ao visitante (titulo, og:title, h1), nao o tamanho da pagina.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['username', 'redes', 'perfis', 'identidade'],
  fields: [{ name: 'username', label: 'Username', type: 'text', placeholder: 'ex: torvalds', required: true, hint: 'Sem @ nem URL' }],
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

      if (p.strategy === 'api') {
        if (r.status === 200 && r.body.includes('"login"')) {
          let perfil = url;
          try { perfil = (JSON.parse(r.body) as { html_url?: string }).html_url ?? url; } catch { /* resposta inesperada */ }
          log.ok(p.id, p.label, url, r.ms, 1);
          found[p.id] = { label: p.label, url: perfil, conf: 'confirmed', via: 'API oficial' };
        } else { log.empty(p.id, p.label, url, r.ms, 'perfil inexistente (HTTP ' + r.status + ')'); }
        continue;
      }
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
      out.push(finding('plataforma', v.label, v.url, [id], { confidence: v.conf, link: v.url, kind: v.conf === 'confirmed' ? 'fact' : 'inference' }));
    }
    if (!Object.keys(found).length) log.note('Nenhuma plataforma confirmada. Pode nao existir, ou o username e diferente por plataforma.');
    log.note('"Confirmado" = API oficial, HTTP inequivoco, ou titulo/descricao do perfil diferentes dos de um username inexistente. "Indicado" = so o corpo da pagina difere (pode ser falso positivo).');
    log.local(1, 'Geracao de username aleatorio para baseline e comparacao de marcadores');
    return { findings: out, log };
  },
});

// ---------------- EMAIL ANALYZER ----------------
const DISPOSABLE = new Set(['mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','yopmail.com','trashmail.com','throwawaymail.com','sharklasers.com','getnada.com','maildrop.cc','dispostable.com','fakeinbox.com','spamgourmet.com','mailnesia.com','tempr.email','burnermail.io']);

registerTool({
  id: 'email-analyzer',
  name: 'Analisador de Email',
  category: 'pessoa',
  summary: 'Valida formato, MX, disposable, Gravatar e correcoes provaveis.',
  longDesc: 'Valida o email de forma real: sintaxe, registos MX (o dominio aceita email?), dominio disposable, presenca de Gravatar (email publicado), e sugere correcoes para erros de digitacao. Nao acede a bases de vazamento sem BYOK.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['email', 'mx', 'validacao', 'gravatar'],
  fields: [{ name: 'email', label: 'Endereco de email', type: 'email', placeholder: 'nome@exemplo.com', required: true }],
  async run(input) {
    const email = String(input.email ?? '').trim().toLowerCase();
    const log = new SourceLog();
    const out: Finding[] = [];
    const m = email.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
    if (!m) {
      log.empty('syntax', 'Validade de sintaxe', email, 0, 'formato invalido');
      return { findings: [finding('validacao', 'Email invalido', email, [], { confidence: 'confirmed' })], log };
    }
    const [, local, domain] = m as unknown as [string, string, string];
    log.local(0, 'Validacao de sintaxe e lista local de dominios descartaveis');
    out.push(finding('validacao', 'Formato valido', email, ['local'], { confidence: 'confirmed' }));

    // disposable (lista local curada — o resultado e sobre a lista, nao sobre o dominio)
    if (DISPOSABLE.has(domain)) out.push(finding('validacao', 'Dominio disposable', domain, ['local'], { confidence: 'corroborated', kind: 'fact' }));
    else out.push(finding('validacao', 'Dominio descartavel (lista local)', 'nao', ['local'], { kind: 'inference', confidence: 'indicated' }));

    // MX, TXT (SPF) e DMARC sao consultas independentes: em paralelo.
    const [mx, txt, dmarc] = await Promise.all([
      doh(domain, 'MX', log),
      doh(domain, 'TXT', log),
      doh(`_dmarc.${domain}`, 'TXT', log),
    ]);
    const answers = mx?.Answer ?? [];
    const mxList = answers.filter((x) => x.type === 15).map((x) => x.data);
    // RFC 7505: "0 ." como unico MX significa que o dominio NAO aceita email.
    const nullMx = mxList.length === 1 && /^0\s*\.\s*$/.test(mxList[0]!);
    if (mxList.length && !nullMx) {
      out.push(finding('mx', `Servidores MX (${mxList.length})`, mxList, ['doh'], { confidence: 'corroborated' }));
    } else if (nullMx) {
      out.push(finding('mx', 'Aceita email', 'nao — o dominio declara "null MX" (RFC 7505)', ['doh'], { confidence: 'corroborated', kind: 'inference' }));
    } else {
      log.empty('doh', `MX de ${domain}`, `https://dns.google/resolve?name=${domain}&type=MX`, 0, 'sem registos MX — o dominio nao aceita email');
      out.push(finding('mx', 'Aceita email', 'provavelmente nao (sem registos MX)', ['doh'], { kind: 'inference', confidence: 'indicated' }));
    }

    const spf = (txt?.Answer ?? []).filter((x) => x.type === 16).map((x) => x.data).filter((s) => /v=spf/i.test(s));
    if (spf.length) out.push(finding('dns', 'SPF', spf, ['doh'], { confidence: 'corroborated' }));
    else { log.empty('doh', `SPF de ${domain}`, `https://dns.google/resolve?name=${domain}&type=TXT`, 0, 'sem registo SPF (ou sem v=spf)'); }

    const dm = (dmarc?.Answer ?? []).filter((x) => x.type === 16).map((x) => x.data);
    if (dm.length) out.push(finding('dns', 'DMARC', dm, ['doh'], { confidence: 'corroborated' }));
    else { log.empty('doh', `DMARC de ${domain}`, `https://dns.google/resolve?name=_dmarc.${domain}&type=TXT`, 0, 'sem registo DMARC'); }

    // Gravatar
    const crypto = await import('node:crypto');
    const md5 = crypto.createHash('md5').update(email).digest('hex');
    const gUrl = `https://www.gravatar.com/avatar/${md5}?d=404`;
    try {
      const g = await apiGet(gUrl, { timeoutMs: 8000 });
      if (g.status === 200) { log.ok('gravatar', 'Gravatar', gUrl, g.ms, 1); out.push(finding('gravatar', 'Gravatar', 'imagem publica para este email', ['gravatar'], { confidence: 'corroborated' })); }
      else { log.empty('gravatar', 'Gravatar', gUrl, g.ms, 'sem imagem publica'); }
    } catch { log.empty('gravatar', 'Gravatar', gUrl, 0); }

    // typo correction
    if (domain === 'gmai.com' || domain === 'gmail.co') out.push(finding('validacao', 'Possivel erro de digitacao', 'Queria dizer gmail.com?', [], { kind: 'inference' }));
    if (domain.endsWith('.con')) out.push(finding('validacao', 'Possivel erro de digitacao', 'Possivel ".com" em vez de ".con"', [], { kind: 'inference' }));

    return { findings: out, log };
  },
});

// ---------------- PHONE ANALYZER ----------------
/**
 * Mapas oficiais de numeração. Fonte: plano de numeração da ANATEL
 * (Resolução 553/2017 e o plano de numeração vigente) e a lista de códigos de
 * país da ITU-T E.164. Estes dois mapas são FACTOS — a relação DDD↔UF é fixa e
 * verificável.
 *
 * O que NÃO existe aqui (e existia numa versão anterior, removido de propósito):
 * uma tabela de prefixos do 9º dígito para "operadora". Essa tabela não
 * correspondia a nenhuma regra real da numeração brasileira e produzia
 * "operadora" inventada — exatamente o que este projeto não pode fazer. A
 * operadora (e a titularidade) exigem base de numeração móvel, que só se obtém
 * com API paga. A ferramenta diz isso em vez de chutar.
 */
const DDD_UF: Record<string, { uf: string; regiao: string }> = {
  '11': { uf: 'SP', regiao: 'São Paulo (RMSP)' }, '12': { uf: 'SP', regiao: 'São José dos Campos' },
  '13': { uf: 'SP', regiao: 'Santos / Baixada Santista' }, '14': { uf: 'SP', regiao: 'Bauru / Marília' },
  '15': { uf: 'SP', regiao: 'Sorocaba / Itapetininga' }, '16': { uf: 'SP', regiao: 'Ribeirão Preto / Franca' },
  '17': { uf: 'SP', regiao: 'São José do Rio Preto' }, '18': { uf: 'SP', regiao: 'Presidente Prudente' },
  '19': { uf: 'SP', regiao: 'Campinas' }, '20': { uf: 'RJ', regiao: 'Rio de Janeiro' },
  '21': { uf: 'RJ', regiao: 'Rio de Janeiro (interior)' }, '22': { uf: 'RJ', regiao: 'Campos / Cabo Frio' },
  '24': { uf: 'RJ', regiao: 'Volta Redonda / Barra Mansa' }, '27': { uf: 'ES', regiao: 'Vitória' },
  '28': { uf: 'ES', regiao: 'Cachoeiro de Itapemirim' }, '31': { uf: 'MG', regiao: 'Belo Horizonte' },
  '32': { uf: 'MG', regiao: 'Juiz de Fora' }, '33': { uf: 'MG', regiao: 'Governador Valadares' },
  '34': { uf: 'MG', regiao: 'Uberlândia / Uberaba' }, '35': { uf: 'MG', regiao: 'Poços de Caldas / Varginha' },
  '37': { uf: 'MG', regiao: 'Divinópolis' }, '38': { uf: 'MG', regiao: 'Montes Claros' },
  '41': { uf: 'PR', regiao: 'Curitiba' }, '42': { uf: 'PR', regiao: 'Ponta Grossa' },
  '43': { uf: 'PR', regiao: 'Londrina / Maringá' }, '44': { uf: 'PR', regiao: 'Paranaguá' },
  '45': { uf: 'PR', regiao: 'Foz do Iguaçu / Toledo' }, '46': { uf: 'PR', regiao: 'Francisco Beltrão' },
  '47': { uf: 'SC', regiao: 'Blumenau / Joinville' }, '48': { uf: 'SC', regiao: 'Florianópolis' },
  '49': { uf: 'SC', regiao: 'Chapecó / Lages' }, '51': { uf: 'RS', regiao: 'Porto Alegre' },
  '53': { uf: 'RS', regiao: 'Pelotas / Santa Maria' }, '54': { uf: 'RS', regiao: 'Caxias do Sul' },
  '55': { uf: 'RS', regiao: 'Passo Fundo / Santa Maria (interior)' }, '61': { uf: 'DF', regiao: 'Brasília e entorno' },
  '62': { uf: 'GO', regiao: 'Goiânia' }, '63': { uf: 'TO', regiao: 'Palmas' },
  '64': { uf: 'GO', regiao: 'Anápolis / Rio Verde' }, '65': { uf: 'MT', regiao: 'Cuiabá' },
  '66': { uf: 'MT', regiao: 'Rondonópolis / Sinop' }, '67': { uf: 'MS', regiao: 'Campo Grande / Dourados' },
  '68': { uf: 'AC', regiao: 'Rio Branco' }, '69': { uf: 'RO', regiao: 'Porto Velho' },
  '71': { uf: 'BA', regiao: 'Salvador' }, '73': { uf: 'BA', regiao: 'Ilhéus / Itabuna' },
  '74': { uf: 'BA', regiao: 'Juazeiro' }, '75': { uf: 'BA', regiao: 'Feira de Santana' },
  '77': { uf: 'BA', regiao: 'Vitória da Conquista / Itapetinga' }, '79': { uf: 'SE', regiao: 'Aracaju' },
  '81': { uf: 'PE', regiao: 'Recife' }, '82': { uf: 'AL', regiao: 'Maceió' },
  '83': { uf: 'PB', regiao: 'João Pessoa' }, '84': { uf: 'RN', regiao: 'Natal' },
  '85': { uf: 'CE', regiao: 'Fortaleza' }, '86': { uf: 'PI', regiao: 'Teresina' },
  '87': { uf: 'PE', regiao: 'Petrolina / Caruaru' }, '88': { uf: 'CE', regiao: 'Juazeiro do Norte' },
  '89': { uf: 'PI', regiao: 'Parnaíba' }, '91': { uf: 'PA', regiao: 'Belém' },
  '92': { uf: 'AM', regiao: 'Manaus' }, '93': { uf: 'PA', regiao: 'Santarém / Castanhal' },
  '94': { uf: 'PA', regiao: 'Marabá' }, '95': { uf: 'RR', regiao: 'Boa Vista' },
  '96': { uf: 'AP', regiao: 'Macapá' }, '97': { uf: 'AM', regiao: 'Interior do Amazonas' },
  '98': { uf: 'MA', regiao: 'São Luís' }, '99': { uf: 'MA', regiao: 'Imperatriz / Timon' },
};

const E164_REGION: Record<string, string> = {
  BR: 'Brasil', US: 'Estados Unidos', CA: 'Canadá', PT: 'Portugal', ES: 'Espanha', FR: 'França',
  IT: 'Itália', DE: 'Alemanha', GB: 'Reino Unido', IE: 'Irlanda', NL: 'Países Baixos', BE: 'Bélgica',
  LU: 'Luxemburgo', CH: 'Suíça', AT: 'Áustria', PL: 'Polônia', UA: 'Ucrânia', RU: 'Rússia',
  AR: 'Argentina', CL: 'Chile', CO: 'Colômbia', PE: 'Peru', VE: 'Venezuela', UY: 'Uruguai',
  PY: 'Paraguai', BO: 'Bolívia', EC: 'Equador', MX: 'México', CN: 'China', JP: 'Japão',
  KR: 'Coreia do Sul', IN: 'Índia', AU: 'Austrália', NZ: 'Nova Zelândia', ZA: 'África do Sul',
  NG: 'Nigéria', EG: 'Egito', MA: 'Marrocos', TR: 'Turquia', IL: 'Israel', SA: 'Arábia Saudita',
  AE: 'Emirados Árabes Unidos', SE: 'Suécia', NO: 'Noruega', DK: 'Dinamarca', FI: 'Finlândia',
};

registerTool({
  id: 'phone-analyzer',
  name: 'Analisador de Telefone',
  category: 'pessoa',
  summary: 'Normaliza, valida o formato E.164 e situa o numero por pais, regiao (DDD) e tipo de linha.',
  longDesc: 'Valida o numero no formato E.164 e identifica pais, regiao e tipo de linha (movel/fixo) usando o plano de numeracao publico. Para numeros brasileiros situa o DDD na UF e regiao (plano ANATEL). OPERADORA e TITULARIDADE nao sao obtidas: dependem da base de numeracao movel, que so existe em APIs pagas — a ferramenta diz isso em vez de inventar. Gera ligacoes para verificacao manual.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['telefone', 'e164', 'validacao', 'ddd', 'regiao'],
  fields: [{ name: 'phone', label: 'Numero de telefone', type: 'text', placeholder: '+5511999999999', required: true, hint: 'Com codigo de pais. Formato BR: +55 DDD 9 digitos (movel) ou 8 (fixo).' }],
  async run(input) {
    const raw = String(input.phone ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const digits = raw.replace(/\D/g, '');
    const e164 = `+${digits}`;

    let country = 'desconhecido';
    let region = 'desconhecido';
    let uf = '';
    let valid = false;
    let type = 'desconhecido';
    const avisos: string[] = [];

    if (!digits.length) {
      log.local(0, 'sem digitos para normalizar');
      return { findings: [finding('validacao', 'Telefone', 'sem dígitos para validar', [], { confidence: 'weak' })], log };
    }

    // Prefixo internacional mais comum, para dar nome ao pais mesmo fora do E.164 rigoroso.
    const intl = Object.keys(E164_REGION).find((cc) => digits.startsWith(cc));
    if (e164.startsWith('+55')) {
      country = 'Brasil';
      const rest = digits.slice(2);
      const ddd = rest.slice(0, 2);
      const num = rest.slice(2);
      const dddVal = Number(ddd);
      if (dddVal < 11 || dddVal > 99) {
        type = `DDD invalido (${ddd})`;
        avisos.push('O prefixo de area nao existe no plano de numeracao brasileiro.');
      } else {
        const reg = DDD_UF[ddd];
        uf = reg?.uf ?? '';
        region = reg ? `${reg.regiao}${uf ? ` — ${uf}` : ''}` : `DDD ${ddd} (regiao nao mapeada)`;
        if (num.length === 9 && num.startsWith('9')) { valid = true; type = 'Movel'; }
        else if (num.length === 8) { valid = true; type = 'Fixo'; }
        else if (num.length === 9) { valid = true; type = 'Movel (formato antigo, sem 9o digito)'; }
        else {
          type = `formato inesperado (${num.length} digitos apos o DDD)`;
          avisos.push('O numero de assinante nao tem o comprimento previsto no plano de numeracao.');
        }
        if (!reg) avisos.push(`DDD ${ddd} nao consta do plano de numeracao publica consultado.`);
      }
    } else if (e164.startsWith('+')) {
      country = intl ? E164_REGION[intl]! : 'internacional (prefixo + nao reconhecido)';
      valid = digits.length >= 8 && digits.length <= 15;
      type = 'indeterminado (plano de numeracao nacional nao aplicado)';
      if (intl) region = `Prefixo +${intl}`;
      else avisos.push(`Prefixo internacional +${digits.slice(0, 3)} nao reconhecido — o numero pode estar mal formado.`);
      if (digits.length < 8) avisos.push('Menos de 8 digitos apos o prefixo: nenhum plano de numeracao do mundo tem numeros tao curtos.');
    } else {
      country = 'nao informado (falta o codigo de pais, ex.: +55)';
      avisos.push('Sem codigo de pais o numero nao pode ser normalizado em E.164. Use o formato internacional.');
    }

    out.push(finding('validacao', 'Formato normalizado (E.164)', e164, ['local'], { confidence: 'confirmed' }));
    out.push(finding('validacao', 'Comprimento valido', valid ? 'sim' : 'nao', ['local'],
      { confidence: valid ? 'corroborated' : 'weak' }));
    if (country !== 'desconhecido') out.push(finding('geo', 'Pais', country, ['local'], { confidence: country === 'Brasil' ? 'confirmed' : 'indicated' }));
    if (region !== 'desconhecido') out.push(finding('geo', 'Regiao', region, ['local'],
      { confidence: uf ? 'corroborated' : 'indicated' }));
    if (uf) out.push(finding('geo', 'UF', uf, ['local'], { confidence: 'corroborated' }));
    out.push(finding('tipo', 'Tipo de linha', type, ['local'], { kind: 'inference', confidence: valid ? 'corroborated' : 'weak' }));
    out.push(finding('operadora', 'Operadora', 'nao determinada (exige base de numeracao movel — API paga)', ['local'],
      { kind: 'claim', confidence: 'weak' }));
    out.push(finding('acoes', 'Verificar registo (manual)', [`https://wa.me/${digits}`, `https://t.me/${digits}`], ['local'], { kind: 'claim' }));
    for (const a of avisos) log.note(a);
    log.local(out.length, 'Normalizacao E.164, plano de numeracao ANATEL e mapa DDD/UF');
    log.note('Operadora, titularidade e portabilidade exigem a base de numeracao movel da Anatel, que so e acessivel por API paga. Nao e inferido aqui.');
    log.needsKey('numverify', 'numverify (operadora e tipo de linha)', 'https://numverify.com', 'Operadora e tipo de linha exigem chave API (BYOK) de um fornecedor de numeracao.');
    return { findings: out, log };
  },
});

// ---------------- PASSWORD CHECK ----------------
registerTool({
  id: 'password-check',
  name: 'Verificador de Password',
  category: 'ameaca',
  summary: 'Verifica se uma password ja apareceu em vazamentos via k-anonymity (sem enviar a password).',
  longDesc: 'Usa o modelo de k-anonymity do Pwned Passwords: so os 5 primeiros caracteres do SHA-1 sao enviados. A password nunca sai do dispositivo. Ideal para auto-auditoria. 100% gratuito.',
  minPlan: 'free',
  freeTier: true,
  tags: ['password', 'breach', 'hibp', 'k-anonymity'],
  fields: [{ name: 'password', label: 'Password a verificar', type: 'text', placeholder: 'a sua password', required: true, hint: 'Processada localmente. So o prefixo do hash e enviado.' }],
  async run(input) {
    const pw = String(input.password ?? '');
    const log = new SourceLog();
    const out: Finding[] = [];
    const cnt = await pwnedPasswords(pw, log);
    if (cnt === null) return { findings: [finding('breach', 'Verificacao', 'fonte indisponivel', [], { confidence: 'weak' })], log };
    out.push(finding('breach', 'Ocorrencias em vazamentos', String(cnt), ['hibp-pw'], { confidence: 'confirmed' }));
    out.push(finding('breach', 'Risco', cnt === 0 ? 'Nenhuma ocorrencia encontrada' : cnt < 100 ? 'EXPOSTO (poucas ocorrencias)' : cnt < 1000 ? 'EXPOSTO' : 'ALTAMENTE EXPOSTO', ['hibp-pw'], { confidence: 'corroborated' }));
    const zxcvbnLike = pw.length < 12;
    out.push(finding('forca', 'Comprimento', `${pw.length} caracteres`, [], { kind: 'inference', confidence: 'indicated' }));
    out.push(finding('forca', 'Avaliacao basica', zxcvbnLike ? 'curta (ideal >= 12)' : 'comprimento adequado', [], { kind: 'inference' }));
    return { findings: out, log, notes: ['Metodo k-anonymity: a password completa nunca foi enviada.'] };
  },
});

/*
 * ---------------------------------------------------------------------------
 * REMOVIDA: `leak-check` (Verificacao de Vazamentos)
 *
 * Foi testada a fundo antes de sair. Nao existe base de brechas gratuita, sem
 * chave e sem registo, que responda sobre um email/username:
 *   - HIBP breachedaccount  -> 401 "missing hibp-api-key"
 *   - LeakCheck.io         -> 401 "missing key"
 *   - Leak-Lookup          -> 200 mas com `error: MISSING REQUIRED PARAMETERS`
 *   - Hudson Rock (endpoint publico usado em 2025) -> 404, deixa de existir
 * Sem chave, a ferramenta so sabia dizer "precisa de chave" — ou seja, nao
 * entregava nada e ocupava um lugar no catalogo. Regra 5 do projeto: o que nao
 * entrega, sai. O que ficou no lugar dela e `tls-audit` (real, sem chave).
 *
 * Para quem precisar mesmo de consulta de breaches, o caminho honesto e
 * Leak-Lookup (a unica com API gratuitamente acessivel) por BYOK — e o que o
 * campo BYOK da aplicacao continua a servir.
 * ---------------------------------------------------------------------------
 */


// ---------------- TELEGRAM OSINT ----------------
registerTool({
  id: 'telegram-osint',
  name: 'Telegram OSINT',
  category: 'pessoa',
  summary: 'Resolve canais e utilizadores publicos do Telegram: inscritos, descricao, tipo.',
  longDesc: 'Le o preview publico de t.me (sem login) para obter inscritos, descricao e tipo de canal/utilizador. Apenas conteudo publico. Sem API key.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['telegram', 'canal', 'inscritos'],
  fields: [{ name: 'target', label: 'Utilizador/canal', type: 'text', placeholder: 'durov ou t.me/s/telegram', required: true }],
  async run(input) {
    let t = String(input.target ?? '').trim().replace(/^https?:\/\//, '').replace(/^t\.me\//, '');
    const isPreview = t.startsWith('s/');
    if (isPreview) t = t.replace(/^s\//, '');
    const url = `https://t.me/${t}`;
    const log = new SourceLog();
    const out: Finding[] = [];
    try {
      const r = await safeFetch(url, { timeoutMs: 12_000, maxBytes: 400_000 });
      if (r.status === 200) {
        const subs = r.body.match(/(\d[\d\s,.]*)\s+subscribers/i)?.[1]?.trim();
        const desc = r.body.match(/<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
        const title = r.body.match(/<div class="tgme_page_title"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]?.trim();
        const isChannel = /tgme_page_extra[^>]*subscribers/i.test(r.body);
        log.ok('telegram', 'Telegram preview publico', url, r.ms, 1);
        out.push(finding('perfil', 'Nome', title ?? t, ['telegram'], { confidence: 'corroborated' }));
        out.push(finding('perfil', 'Tipo', isChannel ? 'Canal/Grupo' : 'Utilizador', ['telegram'], { kind: 'inference', confidence: 'indicated' }));
        if (subs) out.push(finding('perfil', 'Inscritos', subs, ['telegram'], { confidence: 'corroborated' }));
        if (desc) out.push(finding('perfil', 'Descricao', desc, ['telegram']));
        out.push(finding('perfil', 'Link', url, ['telegram'], { link: url }));
      } else { log.empty('telegram', 'Telegram', url, r.ms, `HTTP ${r.status}`); }
    } catch (e) { log.error('telegram', 'Telegram', url, String((e as Error).message).slice(0, 60)); }
    return { findings: out, log };
  },
});
