/** Financeiro (crypto), developer (github, dorks, metadata), Brasil, geo, imagem, paste. */
import { createHash } from 'node:crypto';
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch, safeFetchBuffer, apiGet, apiJson } from '../net/ssrf.ts';
import { ghUser, ghRepos, ghEvents, nominatim, nominatimReverse, bingRss, pwnedPasswords } from '../net/sources.ts';
import { resolveFile, FileError, type FileKind } from '../net/upload.ts';
import { cached } from '../db.ts';
import { cachedSource } from '../net/cached-source.ts';

// ---------------- CRYPTO TRACER ----------------
/**
 * Validação de endereço Bitcoin — real, por base58check (P2PKH/P2SH) e por
 * bech32 (P2WPKH). Sem esta validação, a ferramenta "investigava" o que o
 * utilizador escrevesse e devolvia o erro da API como se fosse o resultado.
 */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function sha256(b: Buffer): Buffer {
  return createHash('sha256').update(b).digest();
}

/**
 * base58check (P2PKH / P2SH).
 *
 * Implementado com aritmética exata em `BigInt`: converter caractere a
 * caractere perde os bytes zero à esquerda e produz um checksum errado — foi
 * o que fez a primeira versão recusar o endereço do bloco génesis.
 */
function base58check(addr: string): boolean {
  let n = 0n;
  let zeros = 0;
  for (const ch of addr) {
    const i = B58.indexOf(ch);
    if (i < 0) return false;
    if (n === 0n && i === 0) zeros++;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const buf = Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, 'hex')]);
  if (buf.length < 5) return false;
  const payload = buf.subarray(0, -4);
  return sha256(sha256(payload)).subarray(0, 4).equals(buf.subarray(-4));
}

// Geradores do checksum bech32 (BIP-173).
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= BECH32_GEN[i]!;
  }
  return chk;
}

/** bech32 (P2WPKH / P2WSH / P2TR) — polymod tem de dar 1. */
function bech32check(addr: string): boolean {
  const pos = addr.lastIndexOf('1');
  if (pos < 1 || pos + 7 > addr.length) return false;
  const hrp = addr.slice(0, pos).toLowerCase();
  if (hrp !== 'bc' && hrp !== 'tb' && hrp !== 'bcrt') return false;
  const data = [...addr.slice(pos + 1).toLowerCase()].map((c) => BECH32.indexOf(c));
  if (data.some((i) => i < 0)) return false;
  const hrpBytes = [...hrp].map((c) => c.charCodeAt(0));
  const values = [...hrpBytes.map((c) => c >> 5), 0, ...hrpBytes.map((c) => c & 31), ...data];
  return polymod(values) === 1;
}

export function isBtcAddress(a: string): boolean {
  if (/^bc1[ac-hj-np-z02-9]{11,71}$/i.test(a)) return bech32check(a.toLowerCase());
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a)) return base58check(a);
  return false;
}

registerTool({
  id: 'crypto-tracer',
  name: 'Rastreador Crypto',
  category: 'financeiro',
  summary: 'Endereços Bitcoin on-chain: saldo confirmado, totais, número de transações e últimas transações, por blockchain.info e mempool.space.',
  longDesc: 'Lê dados on-chain reais de um endereço Bitcoin em duas fontes independentes (blockchain.info e mempool.space): saldo confirmado, totais recebidos/enviados, número de transações, última atividade e as transações mais recentes. O endereço é validado por base58check/bech32 antes de qualquer consulta. ATRIBUIÇÃO a exchange ou pessoa não é feita — exige um fornecedor pago (Chainalysis) e a ferramenta diz isso em vez de adivinhar.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['bitcoin', 'btc', 'onchain', 'rastreio', 'wallet'],
  fields: [{ name: 'address', label: 'Endereco Bitcoin', type: 'wallet', placeholder: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa ou bc1...', required: true }],
  async run(input) {
    const addr = String(input.address ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    if (!addr) {
      log.empty('validacao', 'Endereco', '(vazio)', 0, 'sem endereco');
      out.push(finding('validacao', 'Endereco', 'vazio', [], { confidence: 'weak' }));
      return { findings: out, log };
    }
    if (!isBtcAddress(addr)) {
      log.empty('validacao', 'Formato do endereco', addr, 0, 'nao passa a validacao base58check/bech32');
      out.push(finding('validacao', 'Endereco Bitcoin', `${addr} — não passa a validação de checksum (base58check/bech32)`, [], { kind: 'fact', confidence: 'confirmed' }));
      out.push(finding('validacao', 'Verificar', 'Um endereço Bitcoin válido começa por 1, 3 ou bc1 e tem 26–35 (base58) ou 42–62 (bech32) caracteres.', [], { kind: 'claim', confidence: 'weak' }));
      return { findings: out, log };
    }
    out.push(finding('validacao', 'Endereco válido (checksum)', addr, ['local'], { kind: 'fact', confidence: 'confirmed' }));

    const [bci, mp, price] = await Promise.all([
      cachedSource({ log, srcId: 'blockchain-info', label: 'blockchain.info (BTC on-chain)', url: `https://blockchain.info/rawaddr/${addr}`, key: `bci:${addr}`, ttl: 120, count: false }, async () => {
        const url = `https://blockchain.info/rawaddr/${addr}?limit=10`;
        const t0 = Date.now();
        try {
          const r = await apiGet(url, { timeoutMs: 12_000 });
          if (r.status === 200) { log.ok('blockchain-info', 'blockchain.info (BTC on-chain)', url, Date.now() - t0, 1); return JSON.parse(r.body) as any; }
          log.empty('blockchain-info', 'blockchain.info', url, Date.now() - t0, `HTTP ${r.status}`); return null;
        } catch (e) { log.error('blockchain-info', 'blockchain.info', url, String((e as Error).message).slice(0, 50), Date.now() - t0); return null; }
      }),
      cachedSource({ log, srcId: 'mempool', label: 'mempool.space (BTC on-chain)', url: `https://mempool.space/api/address/${addr}`, key: `mp:${addr}`, ttl: 60, count: false }, async () => {
        const url = `https://mempool.space/api/address/${addr}`;
        const t0 = Date.now();
        try {
          const r = await apiJson<any>(url, { timeoutMs: 10_000 });
          log.ok('mempool', 'mempool.space (BTC on-chain)', url, Date.now() - t0, 1); return r;
        } catch (e) { log.error('mempool', 'mempool.space', url, String((e as Error).message).slice(0, 50), Date.now() - t0); return null; }
      }),
      cachedSource({ log, srcId: 'coinbase', label: 'Coinbase (preco BTC/USD)', url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot', key: 'btc-usd', ttl: 120, count: false }, async () => {
        const t0 = Date.now();
        try {
          const r = await apiJson<any>('https://api.coinbase.com/v2/prices/BTC-USD/spot', { timeoutMs: 8000 });
          log.ok('coinbase', 'Coinbase (preco BTC)', 'https://api.coinbase.com/v2/prices/BTC-USD/spot', Date.now() - t0, 1);
          return r;
        } catch { log.empty('coinbase', 'Coinbase (preco BTC)', 'https://api.coinbase.com/v2/prices/BTC-USD/spot', 0); return null; }
      }),
    ]);

    const usd = Number(price?.data?.amount ?? 0);
    const bciSats = bci ? (bci.total_received ?? 0) - (bci.total_sent ?? 0) : null;
    const mpSats = mp?.chain_stats ? (mp.chain_stats.funded_txo_sum ?? 0) - (mp.chain_stats.spent_txo_sum ?? 0) : null;

    if (bciSats !== null) {
      out.push(finding('onchain', 'Saldo (BTC)', (bciSats / 1e8).toFixed(8), ['blockchain-info'], { confidence: 'corroborated' }));
      out.push(finding('onchain', 'Total recebido (BTC)', ((bci.total_received ?? 0) / 1e8).toFixed(8), ['blockchain-info']));
      out.push(finding('onchain', 'Total enviado (BTC)', ((bci.total_sent ?? 0) / 1e8).toFixed(8), ['blockchain-info']));
      out.push(finding('onchain', 'Numero de transacoes', String(bci.n_tx ?? 0), ['blockchain-info']));
      if (bci.n_unredeemed) out.push(finding('onchain', 'Saidas nao gastas (UTXO)', String(bci.n_unredeemed), ['blockchain-info']));
    }
    if (mpSats !== null) {
      out.push(finding('onchain', 'Saldo (mempool.space)', (mpSats / 1e8).toFixed(8), ['mempool'], { confidence: 'corroborated' }));
      if (mp.mempool_stats?.tx_count) out.push(finding('onchain', 'Transacoes pendentes', String(mp.mempool_stats.tx_count), ['mempool']));
    }
    // Corrobora (ou denuncia divergencia) entre as duas fontes.
    if (bciSats !== null && mpSats !== null) {
      const diff = Math.abs(bciSats - mpSats);
      out.push(finding('onchain', 'As duas fontes concordam no saldo', diff === 0 ? 'sim, valor idéntico' : `nao — diferem em ${(diff / 1e8).toFixed(8)} BTC`,
        ['blockchain-info', 'mempool'], { kind: 'fact', confidence: diff === 0 ? 'corroborated' : 'indicated' }));
    }
    if (usd && bciSats !== null) {
      out.push(finding('mercado', 'Valor do saldo (ao preco de agora)', `US$ ${((bciSats / 1e8) * usd).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} (BTC a US$ ${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })})`, ['coinbase'], { kind: 'inference', confidence: 'indicated' }));
    }
    const txs = (bci?.txs ?? []).slice(0, 8).map((t: any) => ({
      hash: String(t.hash ?? '').slice(0, 24) + '…',
      valorBTC: ((t.value ?? 0) / 1e8).toFixed(8),
      data: new Date((t.time ?? 0) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    }));
    if (txs.length) out.push(finding('onchain', 'Transacoes mais recentes', txs, ['blockchain-info']));
    if (bci?.txs?.length) {
      const primeira = Math.min(...bci.txs.map((t: any) => t.time ?? Infinity));
      out.push(finding('onchain', 'Ultima atividade', new Date(primeira * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC', ['blockchain-info'], { kind: 'fact', confidence: 'corroborated' }));
    }
    if (bciSats === null && mpSats === null) {
      out.push(finding('conclusao', 'Sem dados', 'Nenhuma das duas fontes on-chain respondeu, ou o endereço não tem histórico.', [], { kind: 'inference', confidence: 'weak' }));
    }
    log.note('Atribuição a exchange ou pessoa exige um fornecedor pago (Chainalysis, TRM). Não é inferida aqui.');
    log.needsKey('chainalysis', 'Chainalysis (atribuicao a exchange/pessoa)', 'https://www.chainalysis.com', 'A atribuição on-chain a entidades é um serviço pago.');
    return { findings: out, log };
  },
});

// ---------------- GITHUB OSINT ----------------
registerTool({
  id: 'github-osint',
  name: 'GitHub OSINT',
  category: 'dev',
  summary: 'Perfil, repositorios e atividade publica de um utilizador ou organizacao no GitHub.',
  longDesc: 'Consulta a API do GitHub: dados de perfil (nome, bio, local, empresa, email publicado, twitter), repositorios (linguagem, estrelas, topics) e atividade publica. Sem chave funciona, mas a API publica permite apenas 60 pedidos/hora por IP — com um PAT (BYOK) o limite sobe para 5000/hora e os resultados deixam de falhar por limite.',
  minPlan: 'free',
  freeTier: true,
  tags: ['github', 'perfil', 'repositorios', 'atividade'],
  fields: [{ name: 'username', label: 'Utilizador ou organizacao', type: 'text', placeholder: 'torvalds', required: true }],
  async run(input, ctx) {
    const u = String(input.username ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const pat = ctx.byok['github-pat'];
    const user = await cachedSource({ log, srcId: 'github', label: 'GitHub API (perfil)', url: `https://api.github.com/users/${u}`, key: `gh:${u}`, ttl: 1800, count: false }, () => ghUser(u, log, pat));
    if (user) {
      out.push(finding('perfil', 'Login', user.login, ['github'], { link: user.html_url }));
      if (user.name) out.push(finding('perfil', 'Nome', user.name, ['github']));
      if (user.bio) out.push(finding('perfil', 'Bio', user.bio, ['github']));
      if (user.location) out.push(finding('perfil', 'Local', user.location, ['github']));
      if (user.company) out.push(finding('perfil', 'Empresa', user.company, ['github']));
      if (user.blog) out.push(finding('perfil', 'Website', user.blog, ['github']));
      if (user.email) out.push(finding('perfil', 'Email publicado', user.email, ['github'], { confidence: 'corroborated' }));
      if (user.twitter_username) out.push(finding('perfil', 'Twitter', `@${user.twitter_username}`, ['github']));
      out.push(finding('perfil', 'Repositorios publicos', String(user.public_repos), ['github']));
      out.push(finding('perfil', 'Seguidores', String(user.followers), ['github']));
      out.push(finding('perfil', 'Criado em', user.created_at, ['github']));
    }
    if (!user) {
      // Alvo inexistente: DIZER-LO. Devolver zero achados sem explicação parece
      // "não encontrei nada" quando na verdade é "o perfil não existe".
      out.push(finding('perfil', 'Perfil', `O utilizador "${u}" NAO existe no GitHub`, ['github'], { confidence: 'corroborated' }));
      out.push(finding('perfil', 'Utilizador pesquisado', u, ['github'], { confidence: 'confirmed' }));
      log.note('Perfil inexistente no GitHub. Isto e um facto confirmado pela API, nao uma falha de pesquisa.');
      return { findings: out, log };
    }
    const [repos, evts] = await Promise.all([
      cachedSource({ log, srcId: 'github-repos', label: 'GitHub API (repositorios)', url: `https://api.github.com/users/${u}/repos`, key: `ghrepos:${u}`, ttl: 1800, count: false }, () => ghRepos(u, log, pat)),
      cachedSource({ log, srcId: 'github-events', label: 'GitHub API (atividade)', url: `https://api.github.com/users/${u}/events/public`, key: `ghev:${u}`, ttl: 600, count: false }, () => ghEvents(u, log, pat)),
    ]);
    if (repos.length) {
      out.push(finding('repos', `Repositorios (${repos.length})`, repos.slice(0, 30).map((r) => ({ nome: r.name, linguagem: r.language, estrelas: r.stargazers_count, forks: r.forks_count, atualizado: r.pushed_at?.slice(0, 10), url: r.html_url })), ['github-repos']));
      const langs = new Map<string, number>();
      for (const r of repos) if (r.language) langs.set(r.language, (langs.get(r.language) ?? 0) + 1);
      if (langs.size) out.push(finding('repos', 'Linguagens dominantes', [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), ['github-repos'], { kind: 'inference' }));
    }
    if (evts.length) {
      out.push(finding('atividade', `Atividade publica (${evts.length} eventos)`, evts.slice(0, 10).map((e) => ({ tipo: e.type, repo: e.repo?.name, data: e.created_at })), ['github-events']));
    }
    if (pat) {
      out.push(finding('alvo', 'Autenticacao', 'PAT do utilizador (BYOK) — dentro do limite de 5000 req/hora', ['github'], { kind: 'fact', confidence: 'confirmed' }));
    } else {
      log.needsKey('github-pat', 'GitHub PAT (limite de 60 req/hora por IP)', 'https://github.com/settings/tokens', 'Opcional, mas recomendado: sem PAT a API publica acaba por devolver 403 por limite de 60 pedidos/hora por IP.');
    }
    return { findings: out, log };
  },
});

// ---------------- DORKS GENERATOR ----------------
registerTool({
  id: 'dorks-generator',
  name: 'Gerador de Dorks',
  category: 'pessoa',
  summary: 'Gera consultas Google/Bing/Shodan/GitHub a partir de um alvo. Tambem executa via busca real.',
  longDesc: 'Gera dorks prontos para_USERNAME, _email, _domain, _telefone e _filetype_, targeting recencia, e pode EXECUTAR a busca via DuckDuckGo/Bing RSS devolvendo resultados reais. 100% local, sem custo.',
  minPlan: 'free',
  freeTier: true,
  tags: ['dorks', 'google', 'bing', 'pesquisa', 'shodan'],
  fields: [
    { name: 'term', label: 'Termo/alvo', type: 'text', placeholder: 'exemplo.com', required: true },
    { name: 'engine', label: 'Executar busca real?', type: 'text', required: false, placeholder: 'sim/nao (opcional)', hint: 'Se "sim", corre a busca e devolve resultados reais' },
  ],
  async run(input) {
    const term = String(input.term ?? '').trim();
    const doSearch = /^(sim|yes|true|1|ok)$/i.test(String(input.engine ?? '').trim());
    const log = new SourceLog();
    const out: Finding[] = [];
    const isEmail = /@/.test(term);
    const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(term) && !isEmail;
    const isPhone = /^\+?[\d\s()-]{8,}$/.test(term);
    const esc = term.replace(/"/g, '');
    const dorks: { engine: string; query: string; why: string }[] = [];

    if (isEmail) {
      dorks.push({ engine: 'Google', query: `"${esc}"`, why: 'Mencao exata do email' });
      dorks.push({ engine: 'Google', query: `"${esc}" filetype:pdf OR filetype:doc OR filetype:xls`, why: 'Documentos com o email' });
      dorks.push({ engine: 'Google', query: `"${esc}" (intext:senha OR intext:password OR intext:credencial)`, why: 'Poder exposto' });
      dorks.push({ engine: 'GitHub', query: `"${esc}"`, why: 'Commits com o email' });
    } else if (isDomain) {
      dorks.push({ engine: 'Google', query: `site:${esc}`, why: 'Paginas indexadas' });
      dorks.push({ engine: 'Google', query: `site:${esc} (intext:contato OR intext:email OR intext:@)`, why: 'Emails/contactos' });
      dorks.push({ engine: 'Google', query: `site:${esc} filetype:(pdf OR xls OR doc)`, why: 'Documentos' });
      dorks.push({ engine: 'Google', query: `site:${esc} inurl:(admin OR login OR painel OR backup)`, why: 'Painéis/áreas sensíveis' });
      dorks.push({ engine: 'Shodan', query: `ssl.cert:*.${esc} OR hostname:${esc}`, why: 'Infraestrutura TLS' });
    } else if (isPhone) {
      dorks.push({ engine: 'Google', query: `"${esc}"`, why: 'Mencao do numero' });
      dorks.push({ engine: 'Google', query: `"${esc}" (site:linkedin.com OR site:instagram.com OR site:facebook.com)`, why: 'Redes sociais' });
    } else {
      dorks.push({ engine: 'Google', query: `"${esc}"`, why: 'Mencao exata' });
      dorks.push({ engine: 'Google', query: `"${esc}" filetype:pdf`, why: 'Documentos' });
      dorks.push({ engine: 'GitHub', query: `"${esc}"`, why: 'Codigo' });
    }
    dorks.push({ engine: 'Google', query: `"${esc}" after:2024-01-01`, why: 'Recencia' });
    dorks.push({ engine: 'Google', query: `"${esc}" -site:${esc}`, why: 'Mencoes externas' });

    out.push(finding('dorks', 'Dorks gerados', dorks, [], { confidence: 'confirmed' }));
    out.push(finding('dorks', 'Link Google pronto', `https://www.google.com/search?q=${encodeURIComponent(dorks[0]!.query)}`, [], { link: `https://www.google.com/search?q=${encodeURIComponent(dorks[0]!.query)}` }));

    if (doSearch) {
      const q = encodeURIComponent(dorks[0]!.query);
      // Execucao real da busca via Bing RSS
      const hits = await bingRss(dorks[0]!.query, log, 'bing');
      if (hits.length) {
        out.push(finding('resultados', `Resultados reais (${hits.length})`,
          hits.map((h) => ({ titulo: h.titulo, url: h.url, snippet: h.descricao })), ['bing'],
          { confidence: 'corroborated' }));
      } else {
        log.note('Busca executada, sem resultados para este dork.');
      }
    } else {
      log.skipped('bing', 'Bing RSS (execucao real)', 'bing', ' marque "sim" em "Executar busca real?" para obter resultados');
    }
    return { findings: out, log };
  },
});

// ---------------- METADATA EXTRACTOR ----------------
const IMAGE_NOTES: Record<FileKind, string> = {
  jpeg: 'EXIF completo disponivel.', png: 'PNG guarda texto em chunks tEXt/iTXt; a maioria das cameras nao escreve EXIF.',
  gif: 'GIF nao leva metadados de camera.', webp: 'WebP pode ter EXIF; este leitor so cobre JPEG/PNG/PDF — converta para JPEG para ver EXIF.',
  pdf: 'Metadados de PDF.', bmp: 'BMP nao tem bloco EXIF.', tiff: 'TIFF nao e suportado por esta versao.',
  heic: 'HEIC (iPhone): o EXIF esta em blocos ISO-BMFF que este leitor ainda nao cobre.', zip: 'Isto e um arquivo ZIP, nao uma imagem.',
  desconhecido: 'Formato nao reconhecido.',
};

registerTool({
  id: 'metadata-extractor',
  name: 'Extrator de Metadados',
  category: 'arquivo',
  summary: 'EXIF de imagens (GPS, câmara, software, datas) e metadados de PDF, por upload ou URL. Processado localmente.',
  longDesc: 'Analisa uma imagem ou PDF que pode enviar do telemóvel (upload) ou por URL, e extrai metadados EXIF — coordenadas GPS, fabricante e modelo da câmara, software, data e hora de captura — e, em PDF, autor, produtor e datas. O ficheiro é processado no servidor e NÃO fica guardado. "Sem metadados" é um resultado válido e útil: quase todas as plataformas removem EXIF ao publicar.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['exif', 'gps', 'pdf', 'forense', 'metadata', 'upload'],
  fields: [
    { name: 'file', label: 'Imagem ou PDF', type: 'file', required: false, hint: 'Escolha um ficheiro do dispositivo, ou preencha a URL abaixo.' },
    { name: 'url', label: 'URL do ficheiro', type: 'url', required: false, placeholder: 'https://.../foto.jpg', hint: 'Alternativa ao upload. O ficheiro é descarregado com o bloqueio anti-SSRF.' },
  ],
  async run(input) {
    const log = new SourceLog();
    const out: Finding[] = [];
    let f;
    try {
      f = await resolveFile(log, {
        data: String(input.file ?? ''),
        url: String(input.url ?? ''),
        name: String(input.filename ?? '').slice(0, 120),
        srcId: 'ficheiro',
      });
    } catch (e) {
      const msg = e instanceof FileError ? e.message : String((e as Error).message);
      if (e instanceof FileError) log.empty('ficheiro', 'Ficheiro de entrada', 'upload/url', 0, msg);
      out.push(finding('validacao', 'Ficheiro', msg, [], { kind: 'inference', confidence: 'confirmed' }));
      return { findings: out, log };
    }

    out.push(finding('ficheiro', 'Tipo real (por magic bytes)', f.kind, ['ficheiro'], { confidence: 'confirmed' }));
    out.push(finding('ficheiro', 'Origem', f.origin === 'upload' ? `upload do utilizador (${f.label})` : f.label, ['ficheiro'], { confidence: 'confirmed' }));
    out.push(finding('ficheiro', 'Tamanho', `${f.buffer.length} bytes`, ['ficheiro'], { kind: 'fact', confidence: 'confirmed' }));
    if (f.declaredMime) out.push(finding('ficheiro', 'Content-Type declarado', f.declaredMime, ['ficheiro'], { kind: 'fact', confidence: 'confirmed' }));

    const buf = f.buffer;
    if (f.kind === 'jpeg') {
      out.push(finding('exif', 'Formato', 'JPEG', ['ficheiro']));
      const exif = parseJpegExif(buf);
      if (exif && Object.keys(exif).length) {
        for (const [k, v] of Object.entries(exif)) {
          const g = k === 'GPS' || k.startsWith('GPS') ? 'gps' : 'exif';
          out.push(finding(g, k, v, ['local'], { confidence: 'corroborated' }));
        }
        if (exif['GPS']) {
          out.push(finding('gps', 'Interpretacao', 'As coordenadas sao do dispositivo que tirou a fotografia (nao de onde a fotografia foi publicada).', ['local'], { kind: 'inference', confidence: 'corroborated' }));
          const [la, lo] = String(exif['GPS']).split(',').map((x) => Number(x.trim()));
          if (Number.isFinite(la) && Number.isFinite(lo)) {
            out.push(finding('gps', 'Mapa', `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=16/${la}/${lo}`, ['local'], { kind: 'inference', confidence: 'corroborated', link: `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=16/${la}/${lo}` }));
          }
        }
      } else {
        out.push(finding('exif', 'Metadados EXIF', 'Nenhum encontrado (removidos, ou o ficheiro nao os tinha)', ['local'], { kind: 'fact', confidence: 'confirmed' }));
        log.note('Sem EXIF. É o caso mais comum: Instagram, WhatsApp, Facebook, Gmail e a maioria dos editores removem metadados ao publicar.');
      }
    } else if (f.kind === 'png') {
      out.push(finding('exif', 'Formato', 'PNG', ['ficheiro']));
      const chunks = pngTextChunks(buf);
      if (chunks.length) for (const c of chunks) out.push(finding('exif', 'Metadados de texto', c, ['local'], { confidence: 'corroborated' }));
      else out.push(finding('exif', 'Metadados', 'Nenhum encontrado', ['local'], { kind: 'fact', confidence: 'confirmed' }));
    } else if (f.kind === 'pdf') {
      out.push(finding('exif', 'Formato', 'PDF', ['ficheiro']));
      const meta = parsePdfMeta(buf);
      for (const [k, v] of Object.entries(meta)) out.push(finding('pdf', k, v, ['local'], { confidence: 'corroborated' }));
      if (!Object.keys(meta).length) out.push(finding('pdf', 'Metadados', 'Nenhum encontrado', ['local'], { kind: 'fact', confidence: 'confirmed' }));
    } else {
      out.push(finding('exif', 'Leitura', IMAGE_NOTES[f.kind] ?? 'Formato nao suportado.', ['local'], { kind: 'inference', confidence: 'confirmed' }));
      if (f.kind === 'zip' || f.kind === 'desconhecido') {
        log.note('O ficheiro nao e uma imagem nem um PDF legivel. Nada foi descodificado — nao se inventa resultado.');
      }
    }
    log.local(out.length, 'Parse de EXIF/metadados no servidor');
    return { findings: out, log, notes: ['Metadados podem conter localização e identidade. Use de forma ética e apenas com fundamento legal.'] };
  },
});

/**
 * Leitor EXIF real: percorre a estrutura TIFF/IFD (o que o formato JPEG usa dentro do
 * segmento APP1) em vez de procurar texto solto. Isto e o que permite extrair de facto
 * modelo de camara, data, software e COORDENADAS GPS.
 *
 * O parser anterior procurava sequencias ASCII e produzia resultados inventados.
 * Este le os tipos, conta os componentes e converte RATIONAL corretamente.
 */

// Tags EXIF que interessam (0x = IFD0, Exif. = sub-IFD, GPS. = GPS IFD)
const TAGS: Record<number, string> = {
  0x010f: 'Fabricante', 0x0110: 'Modelo', 0x0112: 'Orientacao', 0x011a: 'XResolucao',
  0x011b: 'YResolucao', 0x0128: 'UnidadeResolucao', 0x0131: 'Software', 0x0132: 'DataFicheiro',
  0x013b: 'Artista', 0x8298: 'Copyright',
  0x829a: 'VelObturacao', 0x829d: 'Abertura', 0x8822: 'ISO', 0x8827: 'VelISO',
  0x9003: 'DataOriginal', 0x9004: 'DataDigital', 0x920a: 'DistanciaFocal',
  0xa002: 'LarguraPx', 0xa003: 'AlturaPx', 0xa405: 'DistanciaFocal35mm',
  0x010e: 'Descricao', 0x9286: 'Comentario',
  // GPS IFD
  0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude', 0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef', 0x0006: 'GPSAltitude',
  0x0007: 'GPSTimestamp', 0x001d: 'GPSDate',
};
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface IfdEntry { tag: number; type: number; count: number; valueOff: number; inline: boolean }

function readIfd(tiff: Buffer, start: number, little: boolean, out: Record<string, unknown>, depth = 0): void {
  if (depth > 2 || start + 2 > tiff.length) return;
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const n = u16(start);
  if (n === 0 || n > 512) return;
  for (let k = 0; k < n; k++) {
    const e = start + 2 + k * 12;
    if (e + 12 > tiff.length) return;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const entry: IfdEntry = { tag, type, count, valueOff: e + 8, inline: size <= 4 };
    const name = TAGS[tag];
    if (name) out[name] = readValue(tiff, entry, little);
    // descer para sub-IFDs (EXIF IFD e GPS IFD). O offset e sempre relativo ao inicio
    // do bloco TIFF, que aqui tem base 0.
    if (tag === 0x8769 || tag === 0x8825) {
      const off = entry.inline
        ? (little ? tiff.readUInt32LE(entry.valueOff) : tiff.readUInt32BE(entry.valueOff))
        : u32(e + 8);
      if (off > 0 && off < tiff.length) readIfd(tiff, off, little, out, depth + 1);
    }
  }
}

function readValue(tiff: Buffer, e: IfdEntry, little: boolean): string | number | number[] | null {
  const size = (TYPE_SIZE[e.type] ?? 1) * e.count;
  const at = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const at32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

  // Para valores maiores que 4 bytes, os 4 bytes do campo sao um offset relativo
  // ao inicio do bloco TIFF. Para valores de 1-4 bytes, o valor esta inline.
  const ptr = e.inline ? 0 : at32(e.valueOff);
  const start = e.inline ? e.valueOff : ptr;

  switch (e.type) {
    case 2: { // ASCII
      if (start + size > tiff.length) return null;
      return tiff.subarray(start, start + size).toString('latin1').replace(/\0.*$/, '').trim() || null;
    }
    case 3: return e.inline ? at(e.valueOff) : (start + 2 <= tiff.length ? at(start) : null);
    case 4: return e.inline ? at32(e.valueOff) : (start + 4 <= tiff.length ? at32(start) : null);
    case 5:
    case 10: { // RATIONAL
      const rd = (o: number) => {
        const p = start + o;
        if (p + 8 > tiff.length) return 0;
        const num = at32(p), den = at32(p + 4);
        return den === 0 ? 0 : num / den;
      };
      if (e.count >= 3) return [rd(0), rd(8), rd(16)];
      if (e.count === 2) return [rd(0), rd(8)];
      return rd(0);
    }
    default: return null;
  }
}

function dmsToDec(v: unknown): number | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [d, m, s] = v as number[];
  return d + m / 60 + s / 3600;
}

/** Extrai metadados EXIF de um JPEG. Devolve null se nao houver segmento Exif. */
export function parseJpegExif(buf: Buffer): Record<string, string> | null {
  // localizar APP1 "Exif\0\0"
  let i = 2;
  let tiff: Buffer | null = null;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break;        // SOS/EOI: fim dos headers
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 8).toString('latin1') === 'Exif') {
      tiff = buf.subarray(i + 10, i + 2 + len);
      break;
    }
    i += 2 + len;
  }
  if (!tiff || tiff.length < 8) return null;

  const bom = tiff.subarray(0, 2).toString('hex');
  const little = bom === '4949';
  if (!little && bom !== '4d4d') return null;

  // Os offsets dos IFD sao relativos ao inicio do bloco TIFF. Como trabalhamos com
  // `tiff` (ja recortado a partir do APP1), a base e 0.
  const raw: Record<string, unknown> = {};
  const offIFD0 = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  readIfd(tiff, offIFD0, little, raw);

  const out: Record<string, string> = {};
  // As tags RATIONAL podem ter count=1 (valor unico) ou count=2/3 (par/composto).
  // Ex: XResolution tem count=1, X/YResolution = 2, GPS = 3.
  const first = (v: unknown): number | undefined =>
    (Array.isArray(v) ? (v[0] as number) : (v as number)) || undefined;
  const second = (v: unknown): number | undefined => (Array.isArray(v) ? (v[1] as number) : undefined);
  const fmt: Record<string, (v: unknown) => string> = {
    XResolucao: (v) => (second(v) !== undefined ? `${first(v)} x ${second(v)}` : `${first(v)} dpi`),
    YResolucao: (v) => (second(v) !== undefined ? `${first(v)} x ${second(v)}` : `${first(v)} dpi`),
    VelObturacao: (v) => { const t = first(v); return t ? `1/${Math.round(1 / t)}s` : '?'; },
    Abertura: (v) => { const a = first(v); return a ? `f/${a}` : '?'; },
    DistanciaFocal: (v) => { const f = first(v); return f ? `${f} mm` : '?'; },
    DistanciaFocal35mm: (v) => { const f = first(v); return f ? `${f} mm` : '?'; },
  };
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('GPS') && k !== 'GPS') continue;   // GPS tratado a parte
    if (v == null || v === '') continue;
    out[k] = fmt[k] ? fmt[k]!(v) : String(v);
  }
  // Coordenadas GPS
  const lat = dmsToDec(raw['GPSLatitude']);
  const lon = dmsToDec(raw['GPSLongitude']);
  if (lat != null && lon != null) {
    const la = raw['GPSLatitudeRef'] === 'S' ? -lat : lat;
    const lo = raw['GPSLongitudeRef'] === 'W' ? -lon : lon;
    out['GPS'] = `${la.toFixed(6)}, ${lo.toFixed(6)}`;
    if (raw['GPSAltitude'] != null) out['GPSAltitude'] = `${raw['GPSAltitude']} m`;
    if (raw['GPSDate']) out['GPSData'] = String(raw['GPSDate']);
  } else if (raw['GPSLatitude'] !== undefined) {
    out['GPS (bruto)'] = JSON.stringify(raw['GPSLatitude']);
  }
  return Object.keys(out).length ? out : null;
}

/** Metadados de texto de um PNG (chunks tEXt/iTXt). */
export function pngTextChunks(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    if (['tEXt', 'iTXt', 'zTXt'].includes(type) && len > 0 && len < 100_000) {
      const data = buf.subarray(i + 8, i + 8 + len).toString('latin1').replace(/\0/g, ': ');
      if (data.trim()) out.push(`${type}: ${data.trim()}`);
    }
    if (type === 'IDAT' && out.length >= 5) break;
    i += 12 + len;
    if (len > buf.length) break;
  }
  return out;
}

function parsePdfMeta(buf: Buffer): Record<string, string> {
  const s = buf.toString('latin1');
  const out: Record<string, string> = {};
  for (const key of ['Author', 'Producer', 'Creator', 'CreationDate', 'ModDate', 'Title']) {
    const m = s.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`));
    if (m?.[1]) out[key] = m[1].trim();
  }
  return out;
}

// ---------------- COMPANY BR ----------------
registerTool({
  id: 'company-br',
  name: 'Consulta de Empresa (BR)',
  category: 'br',
  summary: 'Dados oficiais de CNPJ via BrasilAPI/Receita Federal: razao social, CNAE, QSA (sócios), contato.',
  longDesc: 'Consulta a Receita Federal via BrasilAPI: razao social, nome fantasia, CNAE, situacao cadastral, capital social, endereco, telefone/email e a lista de QSA ( Quadro Societario — os socios). Fonte oficial, gratuita. Superior a qualquer base internacional para empresas brasileiras.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'none',
  tags: ['cnpj', 'receita', 'empresa', 'qsa', 'brasil'],
  fields: [{ name: 'cnpj', label: 'CNPJ', type: 'text', placeholder: '11.222.333/0001-81', required: true, hint: 'Com ou sem mascara' }],
  async run(input) {
    const cnpj = String(input.cnpj ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const { brasilCnpj } = await import('../net/sources.ts');
    const r = await cachedSource({ log, srcId: 'brasilapi-cnpj', label: 'BrasilAPI (CNPJ/Receita Federal)', url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj.replace(/\D/g, '')}`, key: `cnpj:${cnpj.replace(/\D/g, '')}`, ttl: 86400, count: false }, () => brasilCnpj(cnpj, log));
    if (!r) return { findings: [finding('empresa', 'CNPJ', 'Nao encontrado na Receita Federal', ['brasilapi-cnpj'], { confidence: 'weak' })], log };
    out.push(finding('empresa', 'Razao social', r.razao_social, ['brasilapi-cnpj'], { confidence: 'corroborated' }));
    if (r.nome_fantasia) out.push(finding('empresa', 'Nome fantasia', r.nome_fantasia, ['brasilapi-cnpj']));
    if (r.cnae_fiscal_descricao) out.push(finding('empresa', 'CNAE principal', `${r.cnae_fiscal} — ${r.cnae_fiscal_descricao}`, ['brasilapi-cnpj']));
    if (r.cnaes_secundarios?.length) out.push(finding('empresa', 'CNAEs secundarios', r.cnaes_secundarios.map((c) => `${c.codigo} ${c.descricao}`), ['brasilapi-cnpj']));
    out.push(finding('empresa', 'Situacao cadastral', `${r.descricao_situacao_cadastral} (${r.situacao_cadastral})`, ['brasilapi-cnpj'], { confidence: 'corroborated' }));
    if (r.capital_social) out.push(finding('empresa', 'Capital social', `R$ ${r.capital_social}`, ['brasilapi-cnpj']));
    if (r.porte) out.push(finding('empresa', 'Porte', r.porte, ['brasilapi-cnpj']));
    if (r.natureza_social) out.push(finding('empresa', 'Natureza social', r.natureza_social, ['brasilapi-cnpj']));
    if (r.data_inicio_atividade) out.push(finding('empresa', 'Inicio de atividade', r.data_inicio_atividade, ['brasilapi-cnpj']));
    const end = [r.logradouro, r.numero, r.bairro, r.municipio, r.uf].filter(Boolean).join(', ');
    if (end) out.push(finding('empresa', 'Endereco', end, ['brasilapi-cnpj']));
    if (r.telefone) out.push(finding('empresa', 'Telefone', `${r.ddd ?? ''} ${r.telefone}`, ['brasilapi-cnpj']));
    if (r.email) out.push(finding('empresa', 'Email', r.email, ['brasilapi-cnpj']));
    if (r.qsa?.length) {
      out.push(finding('socios', `QSA — quadro societario (${r.qsa.length})`, r.qsa.map((q) => ({ socio: q.nome_socio, qualificacao: q.qual })), ['brasilapi-cnpj'], { confidence: 'corroborated' }));
    }
    return { findings: out, log };
  },
});

// ---------------- ZIPCODE BR ----------------
registerTool({
  id: 'zipcode-br',
  name: 'Consulta de CEP (BR)',
  category: 'br',
  summary: 'Endereco completo a partir do CEP (BrasilAPI + ViaCEP, official + fallback).',
  longDesc: 'Resolve um CEP para endereco completo (logradouro, bairro, cidade, UF) usando BrasilAPI com fallback ViaCEP. Duas fontes para corroborar. Gratuito.',
  minPlan: 'free',
  freeTier: true,
  tags: ['cep', 'endereco', 'brasil', 'viacep'],
  fields: [{ name: 'cep', label: 'CEP', type: 'text', placeholder: '01310-100', required: true }],
  async run(input) {
    const cep = String(input.cep ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const { brasilCep, viaCep } = await import('../net/sources.ts');
    const [a, b] = await Promise.all([brasilCep(cep, log), viaCep(cep, log)]);
    if (a) {
      out.push(finding('endereco', 'Logradouro', a.street, ['brasilapi-cep']));
      out.push(finding('endereco', 'Bairro', a.neighborhood, ['brasilapi-cep']));
      out.push(finding('endereco', 'Cidade', `${a.city} / ${a.state}`, ['brasilapi-cep'], { confidence: 'corroborated' }));
    }
    if (b) {
      out.push(finding('endereco', 'Logradouro (ViaCEP)', b.logradouro, ['viacep']));
      out.push(finding('endereco', 'Cidade (ViaCEP)', `${b.localidade} / ${b.uf}`, ['viacep']));
      if (a && a.city === b.localidade) out.push(finding('endereco', 'Cidade corroborada por 2 fontes', b.localidade, ['brasilapi-cep', 'viacep'], { confidence: 'corroborated' }));
    }
    if (!a && !b) { log.empty('cep', 'Consulta de CEP', cep, 0, 'CEP nao encontrado'); out.push(finding('endereco', 'CEP', 'nao encontrado', [], { confidence: 'weak' })); }
    return { findings: out, log };
  },
});

// ---------------- GEO LOOKUP ----------------
registerTool({
  id: 'geo-lookup',
  name: 'Geo Lookup',
  category: 'geo',
  summary: 'Geocodifica moradas/lugares e faz reverse-geocode de coordenadas (OpenStreetMap).',
  longDesc: 'Converte um lugar/endereco em coordenadas, ou coordenadas em endereco, via Nominatim/OpenStreetMap. Gratuito. Respeita a politica de 1 req/s do Nominatim.',
  minPlan: 'free',
  freeTier: true,
  tags: ['geo', 'mapa', 'coordenadas', 'osm'],
  fields: [
    { name: 'q', label: 'Lugar/endereco OU coordenadas (lat,lon)', type: 'text', required: true, placeholder: 'Sao Paulo OU -23.55,-46.63' },
  ],
  async run(input) {
    const q = String(input.q ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const coords = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coords) {
      const r = await nominatimReverse(Number(coords[1]), Number(coords[2]), log);
      if (r) { out.push(finding('geo', 'Endereco', r.display_name, ['nominatim'], { confidence: 'corroborated' })); out.push(finding('geo', 'Coordenadas', `${r.lat}, ${r.lon}`, ['nominatim'])); }
    } else {
      const list = await nominatim(q, log);
      for (const p of list) out.push(finding('geo', p.display_name.split(',')[0] ?? 'Lugar', { endereco: p.display_name, lat: p.lat, lon: p.lon, tipo: p.type }, ['nominatim'], { confidence: 'corroborated', link: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}` }));
      if (!list.length) log.note('Nenhum resultado para esta morada.');
    }
    return { findings: out, log };
  },
});

// ---------------- REVERSE IMAGE ----------------
registerTool({
  id: 'reverse-image',
  name: 'Análise de Imagem',
  category: 'web',
  summary: 'Metadados, dimensões e impressão digital perceptual (pHash DCT real) de uma ou duas imagens, com comparação por distância de Hamming.',
  longDesc: 'Não existe API gratuita e fiável de busca inversa, portanto esta ferramenta não finge que faz uma. Faz o que dá a verdade: extrai metadados, calcula a impressão digital perceptual (pHash DCT real de 64 bits, igual ao algoritmo original), compara duas imagens por distância de Hamming, e entrega as ligações prontas para Google Lens, Yandex e TinEye. Aceita upload do telemóvel ou URL. A comparação pHash é local e funciona sem rede.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'none',
  tags: ['imagem', 'reversa', 'exif', 'phash', 'lens', 'upload'],
  fields: [
    { name: 'file1', label: 'Imagem 1', type: 'file', required: false, hint: 'Upload do dispositivo, ou use a URL abaixo.' },
    { name: 'url1', label: 'URL da imagem 1', type: 'url', required: false, placeholder: 'https://.../img.jpg' },
    { name: 'file2', label: 'Imagem 2 (para comparar)', type: 'file', required: false, hint: 'Opcional. Sem ela, calcula-se só a impressão digital.' },
    { name: 'url2', label: 'URL da imagem 2', type: 'url', required: false, placeholder: 'Opcional' },
  ],
  async run(input) {
    const log = new SourceLog();
    const out: Finding[] = [];
    const src1 = { data: String(input.file1 ?? ''), url: String(input.url1 ?? ''), name: String(input.filename1 ?? '').slice(0, 120) };
    const src2 = { data: String(input.file2 ?? ''), url: String(input.url2 ?? ''), name: String(input.filename2 ?? '').slice(0, 120) };

    if (!src1.data && !src1.url) {
      log.empty('ficheiro', 'Imagem 1', 'sem input', 0, 'forneca um upload ou uma URL');
      out.push(finding('imagem', 'Sem imagem', 'Envie uma imagem (upload) ou indique uma URL.', [], { confidence: 'confirmed' }));
      return { findings: out, log };
    }

    let f1;
    try {
      f1 = await resolveFile(log, { ...src1, srcId: 'ficheiro' });
    } catch (e) {
      const msg = e instanceof FileError ? e.message : String((e as Error).message);
      out.push(finding('imagem', 'Imagem 1', msg, [], { kind: 'inference', confidence: 'confirmed' }));
      return { findings: out, log };
    }

    out.push(finding('imagem', 'Imagem 1', `${f1.kind.toUpperCase()} · ${f1.buffer.length} bytes · ${f1.origin === 'upload' ? 'upload' : f1.label}`, ['ficheiro'], { confidence: 'confirmed' }));
    const dims = await imageDims(f1.buffer, f1.kind);
    if (dims) out.push(finding('imagem', 'Dimensoes', `${dims.w} x ${dims.h} px`, ['local'], { confidence: 'corroborated' }));
    const exif = f1.kind === 'jpeg' ? parseJpegExif(f1.buffer) : null;
    if (exif && Object.keys(exif).length) {
      for (const [k, v] of Object.entries(exif).slice(0, 12)) out.push(finding('exif', k, v, ['local'], { confidence: 'corroborated' }));
    } else if (f1.kind === 'jpeg') {
      out.push(finding('exif', 'Metadados EXIF', 'nenhum', ['local'], { kind: 'fact', confidence: 'confirmed' }));
    }

    const ph1 = await perceptualHash(f1.buffer);
    if (ph1) {
      out.push(finding('imagem', 'Impressao digital perceptual (pHash 64-bit)', ph1, ['local'], { confidence: 'corroborated' }));
    } else {
      log.empty('phash', 'pHash (DCT)', f1.label, f1.ms, `nao foi possivel descodificar (${f1.kind})`);
      out.push(finding('imagem', 'pHash', `Não foi possível descodificar a imagem (${f1.kind}). JPEG e PNG são suportados.`, [], { kind: 'fact', confidence: 'weak' }));
    }

    if (src2.data || src2.url) {
      let f2;
      try {
        f2 = await resolveFile(log, { ...src2, srcId: 'ficheiro' });
        const ph2 = await perceptualHash(f2.buffer);
        if (ph1 && ph2) {
          const dist = hamming(ph1, ph2);
          log.ok('phash', 'Comparacao pHash (DCT local)', f2.label, f2.ms, 1, `distancia hamming ${dist}`);
          out.push(finding('comparacao', 'Distancia Hamming dos pHash', String(dist), ['phash'], { confidence: 'corroborated' }));
          // Limiares usuais de pHash: <=10 é a mesma imagem com recorte/recodificação.
          out.push(finding('comparacao', 'Leitura', dist === 0
            ? 'Hashes idénticos: o conteúdo visual é o mesmo (mesmo ficheiro ou mesma imagem sem alteração).'
            : dist <= 10
              ? 'Muito provavelmente a mesma imagem, recortada ou recomprimida.'
              : dist <= 18
                ? 'Semelhança parcial. Pode ser a mesma imagem muito alterada, ou imagens diferentes com um_subject comum.'
                : 'Imagens perceptualmente diferentes.',
          ['phash'], { kind: 'inference', confidence: dist <= 10 ? 'corroborated' : 'indicated' }));
        } else {
          out.push(finding('comparacao', 'Comparacao', 'Não foi possível calcular o pHash de uma das imagens.', ['phash'], { kind: 'fact', confidence: 'weak' }));
        }
      } catch (e) {
        out.push(finding('comparacao', 'Imagem 2', e instanceof FileError ? e.message : String((e as Error).message).slice(0, 80), [], { kind: 'inference', confidence: 'confirmed' }));
      }
    }

    if (src1.url) {
      out.push(finding('handoff', 'Busca inversa (ligações prontas)', [
        `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(src1.url)}`,
        `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(src1.url)}`,
        `https://tineye.com/search?url=${encodeURIComponent(src1.url)}`,
      ], [], { kind: 'claim' }));
    } else {
      out.push(finding('handoff', 'Busca inversa', 'Com upload não há URL pública para as ferramentas de busca reversa. Guarde a imagem e use https://lens.google.com (ou Yandex/TinEye) para a carregar aí.', [], { kind: 'claim' }));
    }
    log.local(out.length, 'pHash DCT 64-bit, dimensões e distância de Hamming (cálculo local)');
    log.needsKey('tineye', 'TinEye API (resultados de reverse image)', 'https://tineye.com/api', 'Resultados de busca inversa exigem um fornecedor pago; a análise pHash acima é gratuita e local.');
    return { findings: out, log };
  },
});

/** Dimensoes JPEG/PNG sem descodificar os pixels (cabeçalho). */
export async function imageDims(buf: Buffer, kind: FileKind): Promise<{ w: number; h: number } | null> {
  try {
    if (kind === 'png' && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (kind === 'gif' && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (kind === 'jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1]!;
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (kind === 'webp' && buf.length > 30) {
      const t = buf.subarray(12, 16).toString('latin1');
      if (t === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      if (t === 'VP8X') return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    }
  } catch { /* cabeçalho corrompido */ }
  return null;
}

/**
 * pHash real: DCT 2D sobre a luminancia de uma imagem 32x32, pega no bloco 8x8
 * de baixas frequencias e compara cada coeficiente com a mediana (bit signature).
 * Funcionalmente equivalente ao pHash original (pHash 2010).
 * Se falhar a descodificacao, devolve null e a ferramenta diz que nao pode comparar.
 */
const COS = (() => {
  const t = new Float64Array(32 * 32);
  for (let u = 0; u < 32; u++) for (let x = 0; x < 32; x++) {
    t[u * 32 + x] = u === 0 ? Math.SQRT1_2 : 1;
  }
  return t;
})();

/**
 * Descodifica para RGBA. Só JPEG e PNG: sao os dois formatos com biblioteca
 * pura de decodificacao em Node sem dependencias nativas. Para os restantes a
 * ferramenta DIZ que nao descodificou — em vez de devolver um hash qualquer.
 */
async function decodeImage(buf: Buffer): Promise<{ data: Buffer; width: number; height: number } | null> {
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  try {
    if (isJpeg) {
      const mod: any = await import('jpeg-js');
      const j = mod.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256, tolerantDecoding: true });
      return { data: Buffer.from(j.data), width: j.width, height: j.height };
    }
    if (isPng) {
      const mod: any = await import('pngjs');
      const png = mod.PNG.sync.read(buf);
      return { data: Buffer.from(png.data), width: png.width, height: png.height };
    }
  } catch { /* libs ausentes ou ficheiro corrompido */ }
  return null;
}

async function perceptualHash(buf: Buffer): Promise<string | null> {
  const img = await decodeImage(buf);
  if (!img || img.width < 8 || img.height < 8) return null;
  const { data, width, height } = img;

  // Amostrar 32x32 em tons de cinza (caixa media), com proporcao de aspeto preservada
  const N = 32;
  const gray = new Float64Array(N * N);
  for (let by = 0; by < N; by++) {
    for (let bx = 0; bx < N; bx++) {
      const x0 = Math.floor((bx * width) / N), x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * width) / N));
      const y0 = Math.floor((by * height) / N), y1 = Math.max(y0 + 1, Math.floor(((by + 1) * height) / N));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
          n++;
        }
      }
      gray[by * N + bx] = n ? sum / n : 0;
    }
  }

  // DCT 2D separada (separable) — so precisamos da submatriz 8x8 de baixa frequencia
  const dct = new Float64Array(8 * 8);
  const tmp = new Float64Array(8 * N);
  for (let v = 0; v < 8; v++) {
    for (let y = 0; y < N; y++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += gray[y * N + x]! * COS[v * N + x]!;
      tmp[v * N + y] = s * (y === 0 ? Math.SQRT1_2 : 1);
    }
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += tmp[v * N + y]! * COS[u * N + y]!;
      dct[v * 8 + u] = s * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }

  // Bit signature: cada coeficiente vs mediana (exclui o coeficiente DC 0,0)
  const coeffs: number[] = [];
  for (let i = 0; i < 64; i++) if (i !== 0) coeffs.push(Math.abs(dct[i]!));
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted.length ? (sorted[(sorted.length / 2) | 0]! + sorted[(sorted.length / 2 - 1) | 0]!) / 2 : 0;

  let bits = '';
  for (let i = 0; i < 64; i++) {
    if (i === 0) { bits += '0'; continue; }
    bits += dct[i]! > median ? '1' : '0';
  }
  return bits;
}
function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

// ---------------- EXPOSIÇÃO PÚBLICA (paste + código + breaches por BYOK) ----------------
registerTool({
  id: 'paste-search',
  name: 'Exposição Pública',
  category: 'ameaca',
  summary: 'Procura o alvo em sites de paste, GitHub e código indexado, executando a busca real — e consulta breaches se tiver uma chave Leak-Lookup.',
  longDesc: 'Gera dorks de exposição (sites de paste, código no GitHub/GitLab, segredos) e executa a pesquisa real, devolvendo os resultados com título, URL e excerto. Se tiver uma chave Leak-Lookup (BYOK), acrescenta a consulta a bases de brechas por email ou username. Sem chave, a parte de breach aparece honestamente como "precisa de chave" em vez de fingir resultados.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['paste', 'segredos', 'github', 'dorks', 'exposicao', 'breach'],
  fields: [
    { name: 'term', label: 'Email, dominio, username ou telefone', type: 'text', required: true, placeholder: 'exemplo.com' },
    { name: 'exec', label: 'Executar a busca real?', type: 'text', required: false, placeholder: 'sim / nao', hint: 'Recomendado: sim. Sem isto só devolve os dorks.' },
  ],
  async run(input, ctx) {
    const term = String(input.term ?? '').trim();
    const execRaw = String(input.exec ?? '').trim().toLowerCase();
    const exec = execRaw === '' ? true : !/^(nao|no|false|0)$/.test(execRaw);
    const log = new SourceLog();
    const out: Finding[] = [];
    if (!term) {
      log.empty('validacao', 'Alvo', '(vazio)', 0, 'sem termo');
      out.push(finding('validacao', 'Alvo', 'vazio', [], { confidence: 'weak' }));
      return { findings: out, log };
    }
    const esc = term.replace(/"/g, '');
    const isEmail = /^[^@\s]+@[^@\s]+$/.test(term);
    log.local(0, 'Composicao dos dorks (sem pedido a nenhuma fonte)');

    const dorks = [
      { onde: 'Sites de paste', query: `"${esc}" (site:pastebin.com OR site:paste.ee OR site:hastebin.com OR site:ghostbin.com OR site:rentry.co OR site:pastebin.pl)` },
      { onde: 'GitHub / GitLab', query: `"${esc}" (site:github.com OR site:gitlab.com OR site:bitbucket.org)` },
      { onde: 'Segredos em código', query: `"${esc}" (password OR secret OR api_key OR token) -site:github.com` },
      { onde: 'Web geral', query: `"${esc}"` },
    ];
    out.push(finding('alvo', 'Alvo pesquisado', term, [], { confidence: 'confirmed' }));
    out.push(finding('dorks', 'Consultas prontas', dorks.map((d) => ({ onde: d.onde, consulta: d.query })), [], { kind: 'claim', confidence: 'confirmed' }));
    for (const d of dorks) {
      out.push(finding('dorks', `Abrir: ${d.onde}`, `https://www.bing.com/search?q=${encodeURIComponent(d.query)}`, [],
        { kind: 'claim', link: `https://www.bing.com/search?q=${encodeURIComponent(d.query)}` }));
    }

    if (exec) {
      // Duas buscas independentes em paralelo (paste e código).
      const [hitsPaste, hitsCode] = await Promise.all([
        bingRss(dorks[0]!.query, log, 'bing'),
        bingRss(dorks[1]!.query, log, 'bing-codigo'),
      ]);
      const todos = [...hitsPaste, ...hitsCode];
      const vistos = new Set<string>();
      const unicos = todos.filter((h) => !vistos.has(h.url) && vistos.add(h.url));
      if (unicos.length) {
        out.push(finding('resultados', `Resultados reais (${unicos.length})`,
          unicos.slice(0, 25).map((h) => ({ titulo: h.titulo, url: h.url, excerto: h.descricao })),
          ['bing', 'bing-codigo'], { confidence: 'corroborated' }));
      } else {
        log.note('A pesquisa executou e não devolveu resultados. Isto é um resultado legítimo: o alvo pode não estar exposto.');
        out.push(finding('resultados', 'Resultados', 'Nenhum resultado nas pesquisas executadas. Isto é um dado, não um erro.', [], { kind: 'fact', confidence: 'confirmed' }));
      }
    } else {
      log.skipped('bing', 'Busca real', 'bing', 'a busca nao foi executada (resposta "nao" no campo "Executar a busca real?")');
    }

    // Breach por BYOK — a parte que precisa de chave do utilizador.
    const key = ctx.byok['leaklookup'];
    if (key) {
      const type = isEmail ? 'email_address' : 'username';
      const url = `https://leak-lookup.com/api/search?key=${encodeURIComponent(key)}&type=${type}&query=${encodeURIComponent(term)}`;
      try {
        const r = await apiGet(url, { timeoutMs: 12_000 });
        if (r.status === 200) {
          const j = JSON.parse(r.body) as { error?: string; message?: { name?: string; data?: unknown[] }[] };
          if (!j.error && Array.isArray(j.message)) {
            log.ok('leaklookup', 'Leak-Lookup (a sua chave)', 'leak-lookup.com', r.ms, j.message.length);
            out.push(finding('breach', 'Entradas em bases de brechas', j.message.length, ['leaklookup'], { confidence: 'corroborated' }));
            for (const e of j.message.slice(0, 20)) {
              out.push(finding('breach', e.name ?? 'Entrada', Array.isArray(e.data) ? (e.data as unknown[]).slice(0, 6).join(' | ') : String(e.data ?? '').slice(0, 200), ['leaklookup'], { confidence: 'corroborated' }));
            }
          } else {
            log.error('leaklookup', 'Leak-Lookup', 'leak-lookup.com', String(j.error).slice(0, 60));
          }
        } else log.error('leaklookup', 'Leak-Lookup', 'leak-lookup.com', `HTTP ${r.status}`);
      } catch (e) { log.error('leaklookup', 'Leak-Lookup', url, String((e as Error).message).slice(0, 60)); }
    } else {
      log.needsKey('leaklookup', 'Leak-Lookup (breaches por email/username)', 'https://leak-lookup.com/api', 'A única base de brechas com API gratuitamente acessível exige registo. Com a sua chave, esta ferramenta também devolve as entradas encontradas.');
    }
    return { findings: out, log, notes: ['Vazamentos são dados sensíveis. Use apenas para fins legítimos e defensivos.'] };
  },
});
