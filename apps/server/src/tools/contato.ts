/**
 * Telefone, e-mail e Telegram — as três buscas de contacto do ARGOS.
 *
 * Regra comum: só o que é público ou calculável localmente. Nada aqui
 * confirma "de quem é" um número ou e-mail; diz o que o próprio número/e-mail
 * revela (formato, país, tipo de linha, domínio), onde ele aparece publicado,
 * e — no caso do Telegram — o que a página pública t.me mostra a qualquer
 * visitante.
 *
 * O que fica de fora de propósito: verificar se um número "tem WhatsApp" ou
 * "tem Telegram" por baixo do pano. Não há API pública para isso; as formas
 * que existem violam os termos desses serviços. Em vez disso a ferramenta dá
 * o link wa.me / t.me para a própria pessoa abrir e conferir.
 */
import { createHash } from 'node:crypto';
import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max';
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch, apiJson } from '../net/ssrf.ts';
import { buscaWeb } from '../net/sources.ts';

// ============================================================== TELEFONE

/** DDD brasileiro → UF. Tabela da Anatel (planos de numeração por área). */
const DDD_UF: Record<string, string> = {
  11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
  21: 'RJ', 22: 'RJ', 24: 'RJ', 27: 'ES', 28: 'ES',
  31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
  41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR', 47: 'SC', 48: 'SC', 49: 'SC',
  51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
  61: 'DF', 62: 'GO', 64: 'GO', 63: 'TO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE',
  81: 'PE', 87: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 88: 'CE', 86: 'PI', 89: 'PI',
  91: 'PA', 93: 'PA', 94: 'PA', 92: 'AM', 97: 'AM', 95: 'RR', 96: 'AP', 98: 'MA', 99: 'MA',
} as unknown as Record<string, string>;

const TIPO_LINHA: Record<string, string> = {
  MOBILE: 'Móvel', FIXED_LINE: 'Fixo', FIXED_LINE_OR_MOBILE: 'Fixo ou móvel', TOLL_FREE: 'Gratuito (0800)',
  PREMIUM_RATE: 'Tarifa especial', SHARED_COST: 'Custo partilhado', VOIP: 'VoIP', PERSONAL_NUMBER: 'Número pessoal',
  PAGER: 'Pager', UAN: 'Número corporativo', VOICEMAIL: 'Correio de voz',
};

/** Lê o número como a pessoa o escreveu: sem +, assume Brasil. Exportado para teste. */
export function lerTelefone(bruto: string): PhoneNumber | undefined {
  const s = bruto.trim();
  if (!s) return undefined;
  const digitos = s.replace(/[^\d+]/g, '');
  return parsePhoneNumberFromString(digitos.startsWith('+') ? digitos : digitos, digitos.startsWith('+') ? undefined : 'BR')
    ?? parsePhoneNumberFromString(`+${digitos.replace(/^\+/, '')}`);
}

/** Factos locais do número (sem rede). Exportado para teste. */
export function factosTelefone(p: PhoneNumber) {
  const nacional = p.nationalNumber;
  const ddd = p.country === 'BR' ? nacional.slice(0, 2) : '';
  const tipo = p.getType();
  return {
    valido: p.isValid(),
    possivel: p.isPossible(),
    pais: p.country ?? null,
    codigoPais: `+${p.countryCallingCode}`,
    ddd: ddd || null,
    uf: ddd ? (DDD_UF[ddd] ?? null) : null,
    tipo: tipo ? (TIPO_LINHA[tipo] ?? tipo) : 'Indeterminado',
    e164: p.number,
    nacional: p.formatNational(),
    internacional: p.formatInternational(),
  };
}

registerTool({
  id: 'phone-intel',
  name: 'Busca de Telefone',
  category: 'pessoa',
  summary: 'País, DDD, tipo de linha e formatos de um número, e onde ele aparece publicado.',
  longDesc: 'Lê o número com a base de numeração do Google (libphonenumber): valida, diz país, DDD e estado, tipo de linha (móvel, fixo, VoIP…) e os formatos oficiais. Depois procura o número publicado na web (sites, perfis comerciais, anúncios). A operadora não é mostrada: com a portabilidade, a operadora de origem não diz qual é a atual. Dá ainda os links wa.me e t.me para conferir à mão — o ARGOS não testa contas de WhatsApp ou Telegram por baixo do pano.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['telefone', 'celular', 'whatsapp', 'ddd', 'operadora', 'numero'],
  fields: [{ name: 'phone', label: 'Telefone', type: 'text', placeholder: 'ex: +55 47 99999-0000', required: true, hint: 'Com DDD; sem +55 assume Brasil' }],
  async run(input) {
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];
    const bruto = String(input.phone ?? '');
    const p = lerTelefone(bruto);
    if (!p) {
      log.local(0, 'não foi possível ler um número');
      out.push(finding('validacao', 'Telefone', `não reconhecido: "${bruto.slice(0, 40)}"`, ['local'], { confidence: 'confirmed' }));
      return { findings: out, log, notes };
    }
    const f = factosTelefone(p);
    log.local(1, 'libphonenumber (metadados de numeração)');
    out.push(finding('resumo', 'Número', f.internacional, ['local'], { confidence: 'confirmed' }));
    out.push(finding('resumo', 'Válido', f.valido ? 'sim' : (f.possivel ? 'formato possível, mas não atribuído' : 'não'), ['local'], { confidence: 'confirmed' }));
    out.push(finding('linha', 'País', `${f.pais ?? '—'} (${f.codigoPais})`, ['local'], { confidence: 'confirmed' }));
    if (f.ddd) out.push(finding('linha', 'DDD', `${f.ddd}${f.uf ? ` (${f.uf})` : ''}`, ['local'], { confidence: 'confirmed' }));
    out.push(finding('linha', 'Tipo de linha', f.tipo, ['local'], { confidence: f.tipo === 'Indeterminado' ? 'weak' : 'confirmed' }));
    out.push(finding('linha', 'Formatos', { e164: f.e164, nacional: f.nacional, internacional: f.internacional }, ['local'], { confidence: 'confirmed' }));

    const digitos = f.e164.replace('+', '');
    out.push(finding('conferir', 'Abrir no WhatsApp', `https://wa.me/${digitos}`, ['local'],
      { kind: 'claim', confidence: 'weak', link: `https://wa.me/${digitos}` }));
    out.push(finding('conferir', 'Abrir no Telegram', `https://t.me/+${digitos}`, ['local'],
      { kind: 'claim', confidence: 'weak', link: `https://t.me/+${digitos}` }));
    notes.push('Os links do WhatsApp e do Telegram abrem a conversa para conferir à mão. O ARGOS não testa se o número tem conta: não há forma pública de o fazer sem violar os termos desses serviços.');

    // Onde o número aparece publicado (formatos que as pessoas escrevem).
    const consultas = [...new Set([`"${f.nacional}"`, `"${f.internacional}"`, `"${digitos.replace(/^55/, '')}"`])];
    const hits = (await Promise.all(consultas.map((q, i) => buscaWeb(q, log, `web-${i + 1}`)))).flat();
    const vistos = new Set<string>();
    const unicos = hits.filter((h) => !vistos.has(h.url) && vistos.add(h.url));
    if (unicos.length) {
      out.push(finding('mencoes', `Menções públicas (${unicos.length})`,
        unicos.slice(0, 25).map((h) => ({ titulo: h.titulo, url: h.url, excerto: h.descricao ?? '' })),
        consultas.map((_, i) => `web-${i + 1}`), { kind: 'inference', confidence: 'indicated' }));
    } else {
      out.push(finding('mencoes', 'Menções públicas', 'nenhuma página pública com este número foi encontrada', [], { confidence: 'weak' }));
    }
    notes.push('Operadora: não mostrada. Com a portabilidade, a operadora de origem do prefixo já não diz qual é a atual, e a consulta oficial de portabilidade não é pública.');
    return { findings: out, log, notes };
  },
});

// ================================================================ E-MAIL

const PROVEDORES_LIVRES = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br',
  'zoho.com', 'gmx.com', 'aol.com', 'yandex.com', 'mail.com',
]);
const DESCARTAVEIS = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'temp-mail.org', 'tempmail.com', 'yopmail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com',
]);
const EMAIL_RE = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

registerTool({
  id: 'email-intel',
  name: 'Busca de E-mail',
  category: 'pessoa',
  summary: 'Valida o e-mail, lê o domínio e o servidor de correio, perfil Gravatar público e vazamentos conhecidos.',
  longDesc: 'Confere o formato, se o domínio recebe e-mail (registos MX), se é um provedor gratuito ou descartável, e se o endereço tem um perfil Gravatar público. Com a chave do Have I Been Pwned configurada no servidor (HIBP_API_KEY), mostra em que vazamentos conhecidos o e-mail aparece e que TIPOS de dado vazaram — nunca o conteúdo vazado.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['email', 'e-mail', 'vazamentos', 'gravatar', 'mx', 'breach'],
  fields: [{ name: 'email', label: 'E-mail', type: 'email', placeholder: 'ex: nome@dominio.com', required: true }],
  async run(input) {
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      log.local(0, 'formato inválido');
      out.push(finding('validacao', 'E-mail', `formato inválido: "${email.slice(0, 60)}"`, ['local'], { confidence: 'confirmed' }));
      return { findings: out, log, notes };
    }
    const dominio = email.split('@')[1]!;
    log.local(1, 'validação de formato e classificação do domínio');
    out.push(finding('resumo', 'E-mail', email, ['local'], { confidence: 'confirmed' }));
    out.push(finding('dominio', 'Domínio', dominio, ['local'], { confidence: 'confirmed' }));
    out.push(finding('dominio', 'Tipo de provedor',
      DESCARTAVEIS.has(dominio) ? 'descartável (e-mail temporário)' : PROVEDORES_LIVRES.has(dominio) ? 'gratuito (pessoal)' : 'próprio / corporativo',
      ['local'], { confidence: 'confirmed' }));

    const hash = createHash('md5').update(email).digest('hex');
    const hibpKey = (process.env.HIBP_API_KEY ?? '').trim();

    const [mx, grav, hibp] = await Promise.all([
      // Servidor de correio do domínio
      (async () => {
        const url = `https://dns.google/resolve?name=${encodeURIComponent(dominio)}&type=MX`;
        const t0 = Date.now();
        try {
          const j = await apiJson<{ Answer?: { data: string }[] }>(url, { timeoutMs: 8000 });
          const mxs = (j.Answer ?? []).map((a) => a.data.replace(/^\d+\s+/, '').replace(/\.$/, ''));
          log.ok('dns-mx', 'DNS MX (Google DoH)', url, Date.now() - t0, mxs.length);
          return mxs;
        } catch (e) { log.error('dns-mx', 'DNS MX (Google DoH)', url, String((e as Error).message), Date.now() - t0); return null; }
      })(),
      // Perfil Gravatar público
      (async () => {
        const url = `https://en.gravatar.com/${hash}.json`;
        try {
          const r = await safeFetch(url, { timeoutMs: 8000, maxBytes: 300_000, headers: { accept: 'application/json' } });
          if (r.status === 404) { log.empty('gravatar', 'Gravatar (perfil público)', url, r.ms, 'sem perfil público'); return null; }
          if (r.status !== 200) { log.error('gravatar', 'Gravatar (perfil público)', url, `HTTP ${r.status}`, r.ms); return null; }
          const e = (JSON.parse(r.body) as { entry?: any[] }).entry?.[0];
          if (!e) { log.empty('gravatar', 'Gravatar (perfil público)', url, r.ms); return null; }
          log.ok('gravatar', 'Gravatar (perfil público)', url, r.ms, 1);
          return e as { displayName?: string; profileUrl?: string; thumbnailUrl?: string; currentLocation?: string; accounts?: { shortname?: string; url?: string }[]; urls?: { title?: string; value?: string }[] };
        } catch (e) { log.error('gravatar', 'Gravatar (perfil público)', url, String((e as Error).message)); return null; }
      })(),
      // Vazamentos conhecidos (HIBP), só com chave
      (async () => {
        const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
        if (!hibpKey) { log.needsKey('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com/API/Key', 'Configure HIBP_API_KEY no servidor para ver os vazamentos'); return undefined; }
        try {
          const r = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 2_000_000, headers: { 'hibp-api-key': hibpKey, 'user-agent': 'ARGOS-OSINT', accept: 'application/json' } });
          if (r.status === 404) { log.empty('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com', r.ms, 'em nenhum vazamento conhecido'); return []; }
          if (r.status === 401) { log.error('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com', 'chave recusada (401)', r.ms); return undefined; }
          if (r.status === 429) { log.error('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com', 'limite de pedidos da chave (429)', r.ms); return undefined; }
          if (r.status !== 200) { log.error('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com', `HTTP ${r.status}`, r.ms); return undefined; }
          const lista = JSON.parse(r.body) as { Name: string; Title?: string; Domain?: string; BreachDate?: string; DataClasses?: string[] }[];
          log.ok('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com', r.ms, lista.length);
          return lista;
        } catch (e) { log.error('hibp', 'Have I Been Pwned (vazamentos)', 'https://haveibeenpwned.com', String((e as Error).message)); return undefined; }
      })(),
    ]);

    if (mx) {
      out.push(finding('dominio', 'Recebe e-mail (MX)', mx.length ? mx : 'não — o domínio não tem servidor de correio', ['dns-mx'],
        { confidence: 'confirmed' }));
    }
    if (grav) {
      out.push(finding('perfil', 'Perfil Gravatar', {
        nome: grav.displayName ?? null, local: grav.currentLocation ?? null, perfil: grav.profileUrl ?? null,
        contas: (grav.accounts ?? []).map((a) => a.url ?? a.shortname ?? '').filter(Boolean),
        links: (grav.urls ?? []).map((u) => u.value ?? '').filter(Boolean),
      }, ['gravatar'], { confidence: 'confirmed', link: grav.profileUrl }));
      for (const a of grav.accounts ?? []) {
        if (a.url && /^https?:\/\//.test(a.url)) {
          // Mesmo formato que o username-intel usa para a grelha "Perfis encontrados".
          out.push(finding('encontrado', a.shortname ?? 'perfil', { platform: a.shortname ?? 'perfil', url: a.url, username: '' },
            ['gravatar'], { confidence: 'corroborated', link: a.url }));
        }
      }
    }
    if (Array.isArray(hibp)) {
      out.push(finding('vazamentos', hibp.length ? `Vazamentos (${hibp.length})` : 'Vazamentos',
        hibp.length
          ? hibp.map((b) => ({ site: b.Title ?? b.Name, dominio: b.Domain ?? '', data: b.BreachDate ?? '', tipos: (b.DataClasses ?? []).join(', ') }))
          : 'em nenhum vazamento conhecido',
        ['hibp'], { confidence: 'confirmed' }));
      notes.push('Vazamentos: mostra-se onde o e-mail apareceu e que tipos de dado vazaram — nunca o conteúdo vazado.');
    }
    return { findings: out, log, notes };
  },
});

// =============================================================== TELEGRAM

export interface TelegramPublico {
  existe: boolean;
  tipo: 'canal' | 'grupo' | 'bot' | 'usuário' | null;
  nome: string | null;
  descricao: string | null;
  membros: string | null;
  foto: string | null;
}

const desescapa = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const textoDe = (html: string) => desescapa(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

/**
 * Lê a página pública t.me/<username>. Uma conta que não existe devolve a
 * mesma página genérica ("If you have Telegram, you can contact…") sem o
 * bloco `tgme_page_title`; é esse bloco que separa existe de não existe.
 * Exportado para teste.
 */
export function lerPaginaTelegram(html: string, username: string): TelegramPublico {
  const titulo = /<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (!titulo) return { existe: false, tipo: null, nome: null, descricao: null, membros: null, foto: null };
  const extra = /<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const desc = /<div class="tgme_page_description[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const foto = /<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/i.exec(html);
  const extraTxt = extra ? textoDe(extra[1]!) : '';
  const tipo: TelegramPublico['tipo'] =
    /subscriber/i.test(extraTxt) ? 'canal'
      : /member/i.test(extraTxt) ? 'grupo'
        : /bot$/i.test(username) ? 'bot' : 'usuário';
  const membros = /([\d\s.,]+)\s*(subscribers?|members?)/i.exec(extraTxt)?.[1]?.replace(/\s/g, '') ?? null;
  return {
    existe: true,
    tipo,
    nome: textoDe(titulo[1]!) || null,
    descricao: desc ? (textoDe(desc[1]!) || null) : null,
    membros,
    foto: foto?.[1] ?? null,
  };
}

registerTool({
  id: 'telegram-intel',
  name: 'Telegram OSINT',
  category: 'pessoa',
  summary: 'Perfil, canal, grupo ou bot público do Telegram: nome, descrição, membros e últimas publicações.',
  longDesc: 'Lê a página pública t.me/<username>, a mesma que qualquer visitante vê sem conta: diz se o username existe e se é utilizador, canal, grupo ou bot, com nome, descrição, foto e número de inscritos/membros. Num canal público, mostra também as últimas publicações (t.me/s/). Nada de conversas privadas ou números de telefone.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['telegram', 'canal', 'grupo', 'bot', 'username', 'redes'],
  fields: [{ name: 'username', label: 'Username ou link do Telegram', type: 'text', placeholder: 'ex: @durov ou t.me/durov', required: true }],
  async run(input) {
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];
    const user = String(input.username ?? '').trim()
      .replace(/^https?:\/\/(www\.)?(t|telegram)\.me\/(s\/)?/i, '').replace(/^@/, '').split(/[/?#]/)[0]!;
    if (!/^[a-z0-9_]{4,32}$/i.test(user)) {
      log.local(0, 'username inválido');
      out.push(finding('validacao', 'Username', `inválido: "${user.slice(0, 40)}" (5 a 32 letras, números ou _)`, ['local'], { confidence: 'confirmed' }));
      return { findings: out, log, notes };
    }
    const url = `https://t.me/${user}`;
    let pagina: TelegramPublico;
    try {
      const r = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 600_000 });
      if (r.status !== 200) { log.error('tme', 'Telegram (página pública t.me)', url, `HTTP ${r.status}`, r.ms); return { findings: out, log, notes }; }
      pagina = lerPaginaTelegram(r.body, user);
      if (pagina.existe) log.ok('tme', 'Telegram (página pública t.me)', url, r.ms, 1);
      else log.empty('tme', 'Telegram (página pública t.me)', url, r.ms, 'username sem conta pública');
    } catch (e) {
      log.error('tme', 'Telegram (página pública t.me)', url, String((e as Error).message));
      return { findings: out, log, notes };
    }

    out.push(finding('resumo', 'Username', `@${user}`, ['tme'], { confidence: 'confirmed' }));
    if (!pagina.existe) {
      out.push(finding('resumo', 'Conta', 'não existe conta pública com este username', ['tme'], { confidence: 'confirmed' }));
      return { findings: out, log, notes };
    }
    out.push(finding('encontrado', 'Telegram', { platform: 'Telegram', url, username: user }, ['tme'], { confidence: 'confirmed', link: url }));
    out.push(finding('perfil', 'Tipo', pagina.tipo ?? '—', ['tme'], { confidence: pagina.tipo === 'bot' ? 'indicated' : 'confirmed' }));
    if (pagina.nome) out.push(finding('perfil', 'Nome', pagina.nome, ['tme'], { confidence: 'confirmed' }));
    if (pagina.descricao) out.push(finding('perfil', 'Descrição', pagina.descricao, ['tme'], { confidence: 'confirmed' }));
    if (pagina.membros) out.push(finding('perfil', pagina.tipo === 'canal' ? 'Inscritos' : 'Membros', pagina.membros, ['tme'], { confidence: 'confirmed' }));
    if (pagina.foto) out.push(finding('perfil', 'Foto', pagina.foto, ['tme'], { confidence: 'confirmed', link: pagina.foto }));

    // Canal público: últimas publicações visíveis em t.me/s/<username>.
    if (pagina.tipo === 'canal') {
      const urlS = `https://t.me/s/${user}`;
      try {
        const r = await safeFetch(urlS, { timeoutMs: 10_000, maxBytes: 1_500_000 });
        const posts = [...r.body.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<a class="tgme_widget_message_date" href="([^"]+)"[\s\S]*?<time[^>]*datetime="([^"]+)"/g)]
          .slice(-10).reverse()
          .map((m) => ({ data: m[3]!.slice(0, 10), texto: textoDe(m[1]!).slice(0, 280), url: m[2]! }));
        if (posts.length) {
          log.ok('tme-s', 'Telegram (pré-visualização do canal)', urlS, r.ms, posts.length);
          out.push(finding('publicacoes', `Últimas publicações (${posts.length})`, posts, ['tme-s'], { confidence: 'confirmed' }));
        } else {
          log.empty('tme-s', 'Telegram (pré-visualização do canal)', urlS, r.ms, 'pré-visualização desativada ou sem texto');
        }
      } catch (e) { log.error('tme-s', 'Telegram (pré-visualização do canal)', urlS, String((e as Error).message)); }
    }
    notes.push('Só a página pública t.me — a mesma que qualquer pessoa vê sem conta. Conversas, números e membros privados ficam de fora.');
    return { findings: out, log, notes };
  },
});
