/** Ameaça: reputação, hash, CVE, auditoria de pacotes. */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding, type FindingValue } from '../net/provenance.ts';
import { apiGet } from '../net/ssrf.ts';
import { cachedSource } from '../net/cached-source.ts';
import { threatFox, urlhaus, openPhish, torExits } from '../net/feeds.ts';

// ---------------- REPUTATION CHECK ----------------
/**
 * Feeds usados — escolha feita depois de medir o que cada um devolvia de facto:
 *
 *  - Feodo Tracker (`ipblocklist.txt`): REMOVIDO. Em 2026-09-29 devolvia 565 bytes:
 *    só o cabeçalho de comentários, zero entradas. Um feed "ok" e vazio é pior do
 *    que não ter feed — faz a ferramenta parecer que viu tudo.
 *  - ThreatFox: 7.700+ IOCs de C2/malware nos últimos 7 dias. Substitui o Feodo.
 *  - URLhaus: ~15.000 URLs de malware adicionadas recentemente.
 *  - OpenPhish: feed gratuito de phishing (pequeno, ~100 URLs, mas atualizado).
 *  - Tor Project: nós de saída. Não é malware, mas é a explicação mais comum
 *    para um IP que "não é" nada.
 *
 * Os quatro são HTTPS, públicos e sem chave; todos com cache de 1 h (6 h no Tor).
 */
registerTool({
  id: 'reputation-check',
  name: 'Verificador de Reputação',
  category: 'ameaca',
  summary: 'Compara o alvo contra blocklists públicas reais (ThreatFox, URLhaus, OpenPhish), lista do Tor e OTX.',
  longDesc: 'Consulta quatro listas abertas e mantidas — ThreatFox (C2 e malware), URLhaus (URLs de malware), OpenPhish (phishing) e a lista de nós de saída do Tor — e compara o IP, domínio ou URL com cada uma. Soma a reputação do AlienVault OTX quando disponível. Aviso explícito: não constar destas listas NÃO significa que o alvo seja seguro; significa apenas que nenhuma delas o lista hoje.',
  minPlan: 'pro',
  freeTier: false,
  tags: ['reputacao', 'blocklist', 'phishing', 'c2', 'tor'],
  fields: [
    { name: 'target', label: 'IP, dominio ou URL', type: 'text', placeholder: 'exemplo.com ou 8.8.8.8', required: true },
  ],
  async run(input) {
    const raw = String(input.target ?? '').trim().toLowerCase();
    const log = new SourceLog();
    const out: Finding[] = [];

    // Extrair o host: um URL reduz-se ao hostname; um host simples fica como está.
    let host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !/^[a-z0-9.-]+$/.test(host)) {
      try { host = new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).hostname; } catch { /* fica como estava */ }
    }
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (!host) {
      log.error('validacao', 'Alvo', raw, 'alvo vazio');
      return { findings: [finding('validacao', 'Alvo', 'vazio', [], { confidence: 'weak' })], log };
    }
    out.push(finding('alvo', 'Alvo analisado', host, [], { confidence: 'confirmed' }));

    const hits: { source: string; label: string; detail: FindingValue }[] = [];

    const [tf, uh, op, tor] = await Promise.all([
      cachedSource({ log, srcId: 'threatfox', label: 'abuse.ch ThreatFox (C2/malware)', url: 'threatfox.abuse.ch/export/csv/recent/', key: 'threatfox', ttl: 3600, count: false }, () => threatFox(log)),
      cachedSource({ log, srcId: 'urlhaus', label: 'abuse.ch URLhaus (URLs de malware)', url: 'urlhaus.abuse.ch/downloads/csv_recent/', key: 'urlhaus', ttl: 3600, count: false }, () => urlhaus(log)),
      cachedSource({ log, srcId: 'openphish', label: 'OpenPhish (URLs de phishing)', url: 'openphish.com/feed.txt', key: 'openphish', ttl: 3600, count: false }, () => openPhish(log)),
      cachedSource({ log, srcId: 'tor-exits', label: 'Tor Project (nos de saida)', url: 'check.torproject.org/torbulkexitlist', key: 'tor-exits', ttl: 21600, count: false }, () => torExits(log)),
    ]);

    if (isIp) {
      for (const i of tf.filter((x) => x.ip === host).slice(0, 5)) {
        hits.push({ source: 'threatfox', label: 'ThreatFox (C2/malware)', detail: { ioc: `${i.ip}${i.port ? ':' + i.port : ''}`, tipo: i.type, ameaca: i.threat, malware: i.malware, vistoEm: i.lastSeen, confianca: i.confidence } });
      }
      for (const r of uh.filter((x) => x.host === host).slice(0, 3)) {
        hits.push({ source: 'urlhaus', label: 'URLhaus (malware)', detail: { url: r.url, estado: r.status, familia: r.malware, adicionada: r.added } });
      }
      if (tor.includes(host)) {
        hits.push({ source: 'tor-exits', label: 'Tor Project (no de saida)', detail: 'O IP consta da lista oficial de nos de saida do Tor: trafego anonimizado por desenho (nao e, por si so, malicioso).' });
      }
    } else {
      for (const i of tf.filter((x) => x.domain && (x.domain === host || x.domain.endsWith('.' + host))).slice(0, 5)) {
        hits.push({ source: 'threatfox', label: 'ThreatFox (C2/malware)', detail: { ioc: i.domain, tipo: i.type, ameaca: i.threat, malware: i.malware, vistoEm: i.lastSeen } });
      }
      for (const r of uh.filter((x) => x.host === host || x.host.endsWith('.' + host)).slice(0, 3)) {
        hits.push({ source: 'urlhaus', label: 'URLhaus (malware)', detail: { url: r.url, estado: r.status, familia: r.malware, adicionada: r.added } });
      }
      for (const r of op.filter((x) => x.host === host || x.host.endsWith('.' + host)).slice(0, 3)) {
        hits.push({ source: 'openphish', label: 'OpenPhish (phishing)', detail: { url: r.url } });
      }
    }

    for (const h of hits) out.push(finding('lista', `Presente em ${h.label}`, h.detail, [h.source], { confidence: 'corroborated' }));

    // OTX best-effort: o endpoint de IPv4 do OTX é historicamente instável.
    const otxUrl = isIp
      ? `https://otx.alienvault.com/api/v1/indicators/IPv4/${host}/general`
      : `https://otx.alienvault.com/api/v1/indicators/domain/${host}/general`;
    try {
      const r = await apiGet(otxUrl, { timeoutMs: 7_000 });
      if (r.status === 200) {
        const j = JSON.parse(r.body) as { reputation?: number; pulse_info?: { count?: number } };
        log.ok('otx', 'AlienVault OTX (reputacao)', otxUrl, r.ms, 1);
        if (typeof j.reputation === 'number') {
          out.push(finding('otx', 'OTX reputation', String(j.reputation), ['otx'], { confidence: 'corroborated' }));
          if (j.reputation < 0) out.push(finding('otx', 'Sinal negativo do OTX', 'reputacao negativa', ['otx'], { kind: 'inference', confidence: 'indicated' }));
        }
        if (j.pulse_info?.count) out.push(finding('otx', 'Pulsos OTX', String(j.pulse_info.count), ['otx']));
      } else {
        log.empty('otx', 'AlienVault OTX', otxUrl, r.ms, `HTTP ${r.status}`);
      }
    } catch (e) { log.error('otx', 'AlienVault OTX', otxUrl, String((e as Error).message).slice(0, 60)); }

    // O veredicto cita as fontes que o sustentam — nunca uma conclusão sem evidência.
    const consulted = ['threatfox', 'urlhaus', 'openphish', 'tor-exits'].filter((id) => {
      const s = log.sources.find((x) => x.id === id);
      return s && (s.status === 'ok' || s.status === 'empty');
    });
    const labels = [...new Set(hits.map((h) => h.label))];
    if (!hits.length) {
      out.push(finding('veredicto', 'Não consta nas listas consultadas',
        'Verificado em ' + consulted.length + ' lista(s) publica(s): ' + (consulted.join(', ') || 'nenhuma respondeu') +
        '. NÃO significa seguro — apenas que nenhuma o lista hoje.',
        consulted, { kind: 'inference', confidence: consulted.length ? 'corroborated' : 'weak' }));
    } else {
      out.push(finding('veredicto', 'ALERTADO em ' + labels.length + ' lista(s)', labels, [...new Set(hits.map((h) => h.source))], { confidence: 'corroborated' }));
    }
    if (!consulted.length) log.note('Nenhuma das listas respondeu. O resultado NÃO significa que o alvo esteja limpo — significa que as fontes falharam.');
    log.needsKey('urlhaus-key', 'URLhaus API (historico completo)', 'https://urlhaus.abuse.ch/api', 'A API do URLhaus da historico completo; o dump CSV publico so traz o que e recente.');
    return { findings: out, log, notes: ['Ausência em blocklist NÃO é prova de segurança.'] };
  },
});


// ---------------- HASH ANALYZER ----------------
interface HashType { name: string; test: (h: string) => boolean; example: string; weakness?: string }
const HASH_TYPES: HashType[] = [
  { name: 'MD5', test: (h) => /^[a-f0-9]{32}$/i.test(h), example: '32 hex', weakness: 'Quebrado — colisoes praticas' },
  { name: 'SHA-1', test: (h) => /^[a-f0-9]{40}$/i.test(h), example: '40 hex', weakness: 'Quebrado para colisoes' },
  { name: 'SHA-224', test: (h) => /^[a-f0-9]{56}$/i.test(h), example: '56 hex' },
  { name: 'SHA-256', test: (h) => /^[a-f0-9]{64}$/i.test(h), example: '64 hex' },
  { name: 'SHA-384', test: (h) => /^[a-f0-9]{96}$/i.test(h), example: '96 hex' },
  { name: 'SHA-512', test: (h) => /^[a-f0-9]{128}$/i.test(h), example: '128 hex' },
  { name: 'bcrypt', test: (h) => /^\$2[aby]\$\d{2}\$/.test(h), example: '$2b$10$...' },
  { name: 'Argon2', test: (h) => /^\$argon2(id|i|d)\$/.test(h), example: '$argon2id$...' },
  { name: 'scrypt', test: (h) => /^\$scrypt\$/.test(h), example: '$scrypt$...' },
  { name: 'PBKDF2', test: (h) => /^\$pbkdf2(-sha\d+)?\$/.test(h), example: '$pbkdf2-sha256$...' },
  { name: 'NTLM', test: (h) => /^([a-f0-9]{32})$/i.test(h), example: '32 hex (igual a MD5)' },
  { name: 'MySQL', test: (h) => /^\*[A-F0-9]{40}$/i.test(h), example: '*ABC...' },
  { name: 'CRC32', test: (h) => /^[a-f0-9]{8}$/i.test(h), example: '8 hex' },
];

registerTool({
  id: 'hash-analyzer',
  name: 'Analisador de Hash',
  category: 'arquivo',
  summary: 'Identifica o algoritmo de um hash e verifica se a password esta exposta.',
  longDesc: 'Identifica o algoritmo por formato (MD5, SHA-1/256/512, bcrypt, Argon2, NTLM, MySQL...). Se fornecer tambem a password correspondente, verifica expoicao via Pwned Passwords. Nao quebra hashes.',
  minPlan: 'free',
  freeTier: true,
  tags: ['hash', 'algoritmo', 'password', 'forense'],
  fields: [
    { name: 'hash', label: 'Hash', type: 'hash', placeholder: '5f4dcc3b5aa765d61d8327deb882cf99', required: true },
    { name: 'password', label: 'Password (opcional, p/ verificar)', type: 'text', required: false, hint: 'Verificada localmente (k-anonymity)' },
  ],
  async run(input) {
    const hash = String(input.hash ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const matches = HASH_TYPES.filter((t) => t.test(hash));
    if (matches.length) {
      for (const m of matches) {
        out.push(finding('algoritmo', `Algoritmo: ${m.name}`, `${m.name} (${m.example})`, ['local'], { confidence: 'confirmed' }));
        if (m.weakness) out.push(finding('seguranca', `Fraqueza ${m.name}`, m.weakness, ['local'], { confidence: 'corroborated' }));
      }
      if (matches.length > 1 && matches.some((m) => m.name === 'MD5') && matches.some((m) => m.name === 'NTLM')) {
        log.note('32 hex pode ser MD5 OU NTLM — indistinguiveis so pelo formato.');
      }
    } else {
      out.push(finding('algoritmo', 'Algoritmo', 'formato nao reconhecido', ['local'], { confidence: 'weak' }));
    }
    out.push(finding('local', 'Comprimento', `${hash.length} caracteres`, ['local'], { confidence: 'confirmed' }));
    // Regista que o reconhecimento de algoritmo e calculo local, nao fonte remota
    log.local(matches.length, 'Deteccao de algoritmo por formato');

    // password exposure
    const { pwnedPasswords } = await import('../net/sources.ts');
    const pw = String(input.password ?? '');
    if (pw) {
      const c = await pwnedPasswords(pw, log);
      if (c !== null) {
        out.push(finding('exposicao', 'Password em vazamentos', `${c} ocorrencias`, ['hibp-pw'], { confidence: 'confirmed' }));
        if (c > 0) {
          // NÃO se tenta confirmar hash↔password aqui: isso é cracking, e exigiria
          // um dicionário no servidor. Dizemos o que dá para fazer e onde.
          out.push(finding('confirmacao', 'Confirmar hash ↔ password',
            ['john --format=raw  (dicionário local)', 'hashcat -m 0  (dicionário local)', ' crackstation.net (dicionário grande)'],
            [], { kind: 'claim', confidence: 'weak' }));
          log.note('Confirmar se a password corresponde ao hash é cracking: só é fiável com um dicionário, local, offline.');
        }
      }
    }
    return { findings: out, log, notes: ['Esta ferramenta NAO quebra hashes. Identifica e verifica exposicao.'] };
  },
});

// ---------------- CVE LOOKUP ----------------
/**
 * Duas fontes independentes, com fallback: o NIST NVD é a fonte primária
 * (curada, com CVSS) e o CIRCL (cve.circl.lu) cobre o que o NVD ainda não
 * ingeriu. Se o NVD não responder, o CIRCL assume — e o resultado fica
 * marcado como vindo de uma só fonte, nunca como "confirmado por duas".
 */
registerTool({
  id: 'cve-lookup',
  name: 'Consulta de CVE',
  category: 'ameaca',
  summary: 'Detalhe e pesquisa de vulnerabilidades no NVD e no CIRCL, com CVSS, produtos afetados e referências.',
  longDesc: 'Busca vulnerabilidades por identificador (CVE-2021-44228) ou por palavra-chave. Dados do NIST NVD com severidade CVSS, descrição, referências e produtos afetados, com o CIRCL como segunda fonte e como suplente quando o NVD falha. Sem chave, sem custo.',
  minPlan: 'free',
  freeTier: true,
  tags: ['cve', 'nvd', 'cvss', 'vulnerabilidade'],
  fields: [
    { name: 'query', label: 'CVE ou palavra-chave', type: 'text', placeholder: 'CVE-2021-44228 ou log4j', required: true },
  ],
  async run(input) {
    const q = String(input.query ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const { nvdCve, nvdSearch } = await import('../net/sources.ts');

    if (/^CVE-\d{4}-\d{4,7}$/i.test(q)) {
      const id = q.toUpperCase();
      const c = await nvdCve(id, log);
      if (c) {
        out.push(finding('cve', 'ID', c.id, ['nvd'], { link: `https://nvd.nist.gov/vuln/detail/${c.id}` }));
        out.push(finding('cve', 'Descricao', c.descriptions?.find((d) => d.lang === 'en')?.value ?? c.descriptions?.[0]?.value ?? '', ['nvd']));
        const v31 = c.metrics?.cvssMetricV31?.[0]?.cvssData;
        const v2 = c.metrics?.cvssMetricV2?.[0]?.cvssData;
        if (v31) out.push(finding('cvss', 'CVSS v3.1', `${v31.baseScore} (${v31.baseSeverity}) — ${v31.vectorString}`, ['nvd'], { confidence: 'corroborated' }));
        else if (v2) out.push(finding('cvss', 'CVSS v2', String(v2.baseScore), ['nvd']));
        if (c.published) out.push(finding('cve', 'Publicado', c.published, ['nvd']));
        if (c.vulnStatus) out.push(finding('cve', 'Estado', c.vulnStatus, ['nvd']));
        if (c.references?.length) out.push(finding('cve', 'Referencias', c.references.slice(0, 12).map((r) => r.url), ['nvd']));
        const products = new Set<string>();
        for (const conf of c.configurations ?? []) for (const n of conf.nodes ?? []) for (const m of n.cpeMatch ?? []) if (m.vulnerable) products.add(m.criteria);
        if (products.size) out.push(finding('cve', `Produtos afetados (${products.size})`, [...products].slice(0, 30), ['nvd']));
      } else {
        log.note(`O NVD nao devolveu dados para ${id}. A consultar o CIRCL.`);
      }
      // CIRCL: fonte independente quando existe, suplente quando o NVD falha.
      try {
        const r = await apiGet(`https://cve.circl.lu/api/cve/${id}`, { timeoutMs: 10_000 });
        if (r.status === 200) {
          log.ok('circl', 'CIRCL (CVE)', r.url, r.ms, 1, c ? 'confirmacao independente' : 'fonte unica: o NVD nao respondeu');
          const j = JSON.parse(r.body) as { cvss?: string; summary?: string; published?: string; references?: string[] };
          if (!c) {
            // Sem NVD: o que o CIRCL tem é o que há. Fica marcado como tal.
            out.push(finding('cve', 'ID', id, ['circl'], { link: `https://nvd.nist.gov/vuln/detail/${id}` }));
            if (j.summary) out.push(finding('cve', 'Descricao (CIRCL)', j.summary.slice(0, 600), ['circl']));
            if (j.cvss) out.push(finding('cvss', 'CVSS (CIRCL)', j.cvss, ['circl'], { confidence: 'indicated' }));
            if (j.published) out.push(finding('cve', 'Publicado (CIRCL)', j.published, ['circl']));
            if (j.references?.length) out.push(finding('cve', 'Referencias (CIRCL)', j.references.slice(0, 10), ['circl']));
            log.note('Dados apenas do CIRCL (fonte única): o NVD não devolveu esta CVE.');
          }
        } else log.empty('circl', 'CIRCL', r.url, r.ms, `HTTP ${r.status}`);
      } catch { log.empty('circl', 'CIRCL', `https://cve.circl.lu/api/cve/${id}`, 0); }

      if (!out.length) {
        out.push(finding('cve', 'Resultado', `Nenhuma das duas fontes (NVD, CIRCL) tem dados para ${id}. Ou a CVE não existe, ou ainda não foi ingerida.`, ['nvd', 'circl'], { kind: 'inference', confidence: 'weak' }));
      }
    } else {
      const list = await nvdSearch(q, 10, log);
      for (const c of list) {
        const v31 = c.metrics?.cvssMetricV31?.[0]?.cvssData;
        out.push(finding('cve', c.id, {
          descricao: (c.descriptions?.find((d) => d.lang === 'en')?.value ?? '').slice(0, 200),
          cvss: v31 ? `${v31.baseScore} ${v31.baseSeverity}` : 'n/d',
          publicado: c.published,
        }, ['nvd'], { link: `https://nvd.nist.gov/vuln/detail/${c.id}` }));
      }
      if (!list.length) log.note(`Nenhuma CVE encontrada no NVD para "${q}".`);
    }
    return { findings: out, log };
  },
});

// ---------------- PACKAGE AUDIT (OSV) ----------------
const ECOSYSTEMS: Record<string, string> = { npm: 'npm', pypi: 'PyPI', pip: 'PyPI', go: 'Go', maven: 'Maven', 'crates.io': 'crates.io', cargo: 'crates.io', rubygems: 'RubyGems', gem: 'RubyGems', nuget: 'NuGet', packagist: 'Packagist', composer: 'Packagist', pub: 'Pub', hex: 'Hex' };

registerTool({
  id: 'package-audit',
  name: 'Auditoria de Pacotes',
  category: 'dev',
  summary: 'Verifica vulnerabilidades de um pacote+versao via OSV.dev (gratuito, sem chave).',
  longDesc: 'Consulta a base de dados aberta OSV.dev para vulnerabilidades conhecidas de um pacote e versao (npm, PyPI, Go, Maven, crates.io, RubyGems, NuGet...). Inclui GHSA/CVE, severidade e versao corrigida. 100% gratuito.',
  minPlan: 'free',
  freeTier: true,
  tags: ['osv', 'dependencias', 'supply-chain', 'cve'],
  fields: [
    { name: 'ecosystem', label: 'Ecossistema', type: 'text', placeholder: 'npm', required: true, hint: Object.keys(ECOSYSTEMS).join(', ') },
    { name: 'name', label: 'Nome do pacote', type: 'package', placeholder: 'express', required: true },
    { name: 'version', label: 'Versao', type: 'text', placeholder: '4.17.1', required: true },
  ],
  async run(input) {
    const ecoRaw = String(input.ecosystem ?? '').trim().toLowerCase();
    const eco = ECOSYSTEMS[ecoRaw] ?? ecoRaw;
    const name = String(input.name ?? '').trim();
    const version = String(input.version ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];

    // Ecossistema desconhecido: NÃO se consulta. Sem isto a ferramenta devolvia
    // "nenhuma vulnerabilidade" para um pacote de um ecossistema que o OSV nao
    // conhece — o que se lê como "está limpo" e é mentira.
    if (!ECOSYSTEMS[ecoRaw]) {
      log.empty('validacao', 'Ecossistema', ecoRaw || '(vazio)', 0, 'nao reconhecido');
      out.push(finding('validacao', 'Ecossistema nao reconhecido', ecoRaw || '(vazio)', [], { confidence: 'confirmed' }));
      out.push(finding('validacao', 'Valores aceites', Object.keys(ECOSYSTEMS).join(', '), [], { kind: 'fact', confidence: 'confirmed' }));
      return { findings: out, log };
    }
    if (!name || !version) {
      log.empty('validacao', 'Pacote', `${name}@${version}`, 0, 'faltam nome ou versao');
      out.push(finding('validacao', 'Faltam dados', 'Indique nome e versao do pacote (ex.: express 4.21.2).', [], { confidence: 'confirmed' }));
      return { findings: out, log };
    }
    out.push(finding('alvo', 'Pacote', `${name}@${version} (${eco})`, [], { confidence: 'confirmed' }));

    const { osvQuery } = await import('../net/sources.ts');
    const vulns = await osvQuery(eco, name, version, log);
    const osvSrc = log.sources.find((s) => s.id === 'osv');
    if (!vulns.length) {
      if (osvSrc?.status === 'error') {
        out.push(finding('auditoria', 'Resultado', `A base OSV nao respondeu, portanto NAO foi feita auditoria a ${name}@${version}. Isto nao significa que o pacote esteja limpo.`, ['osv'], { kind: 'inference', confidence: 'weak' }));
      } else {
        out.push(finding('auditoria', 'Resultado',
          `Nenhuma vulnerabilidade registada na base OSV para ${name}@${version} (${eco}). NÃO significa que o pacote seja seguro — só que não há registo.`,
          ['osv'], { confidence: 'corroborated' }));
      }
    } else {
      for (const v of vulns) {
        const fixed = new Set<string>();
        for (const a of v.affected ?? []) for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixed.add(e.fixed);
        out.push(finding('vulnerabilidade', v.id, {
          resumo: v.summary?.slice(0, 220),
          severidade: v.severity?.[0]?.score ?? v.database_specific?.severity,
          versaoCorrigida: [...fixed].slice(0, 3).join(', ') || 'nao indicada',
          publicado: v.published,
          detalhe: v.references?.[0]?.url,
        }, ['osv'], { confidence: 'corroborated', link: `https://osv.dev/vulnerability/${v.id}` }));
      }
      out.push(finding('auditoria', 'Total de vulnerabilidades', vulns.length, ['osv'], { confidence: 'corroborated' }));
    }
    return { findings: out, log };
  },
});
