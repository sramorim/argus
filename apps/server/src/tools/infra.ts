/** Ferramentas de infraestrutura: dominio, IP, portas, ASN, URL, crawler. */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch, SsrfError, apiJson } from '../net/ssrf.ts';
import {
  doh, rdapDomain, rdapIp, vcardValues, freeIpApi, ipInfo, ipwhois, internetDb, shodanHost,
  ripeAsOverview, ripeWhois, ripeAnnouncedPrefixes, certspotter, crtsh, rrLabel,
} from '../net/sources.ts';
import { cachedSource } from '../net/cached-source.ts';

// ---------------- DOMAIN ANALYZER ----------------
registerTool({
  id: 'domain-analyzer',
  name: 'Analisador de Dominio',
  category: 'infra',
  summary: 'RDAP, DNS completo, subdominios via Certificate Transparency e emails expostos.',
  longDesc: 'Coleta registo do dominio (RDAP, sem WHOIS), todos os registos DNS relevantes, subdominios discovered em logs de transparencia de certificados e emails publicados no RDAP. Sem mock: cada campo tem fonte.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'none',
  tags: ['dns', 'rdap', 'whois', 'certificados', 'subdominios'],
  fields: [{ name: 'domain', label: 'Dominio', type: 'text', placeholder: 'exemplo.com.br', required: true }],
  async run(input) {
    const domain = String(input.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const log = new SourceLog();
    const out: Finding[] = [];

    // RDAP
    const rdap = await cachedSource({ log, srcId: 'rdap', label: 'RDAP (registro de dominio)', url: `https://rdap.org/domain/${domain}`, key: `rdap:dom:${domain}`, ttl: 86400, count: false }, () => rdapDomain(domain, log));
    if (rdap) {
      const ev = Object.fromEntries((rdap.events ?? []).map((e) => [e.eventAction, e.eventDate]));
      out.push(finding('rdap', 'Dominio registado', domain, ['rdap'], { link: `https://rdap.org/domain/${domain}` }));
      out.push(finding('rdap', 'Estado', rdap.status ?? [], ['rdap']));
      if (ev.registration) out.push(finding('rdap', 'Registado em', ev.registration, ['rdap']));
      if (ev.expiration) out.push(finding('rdap', 'Expira em', ev.expiration, ['rdap']));
      if (ev['last changed']) out.push(finding('rdap', 'Ultima alteracao', ev['last changed'], ['rdap']));
      const ns = (rdap.nameservers ?? []).map((n) => n.ldhName ?? n.unicodeName).filter(Boolean);
      if (ns.length) out.push(finding('rdap', 'Servidores de nome', ns, ['rdap']));
      const emails = vcardValues(rdap.entities);
      if (emails.length) out.push(finding('rdap', 'Contactos RDAP', emails, ['rdap'], { kind: 'fact' }));
      const roles = (rdap.entities ?? []).flatMap((e) => e.roles ?? []);
      if (roles.length) out.push(finding('rdap', 'Entidades/roles', [...new Set(roles)], ['rdap']));
    }

    // DNS
    const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'SOA', 'CAA'];
    const TYPE_NUM: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };
    const dnsRows: string[] = [];
    // Consultas DNS em paralelo: 7 pedidos sequenciais sao lentos e nao dependem uns dos outros
    const dnsResults = await Promise.all(types.map((t) => doh(domain, t, log)));
    types.forEach((t, i) => {
      const want = TYPE_NUM[t];
      for (const a of dnsResults[i]?.Answer ?? []) {
        // include CNAMEs in A/AAAA queries (they explain the resolution chain)
        if (a.type === want || ((t === 'A' || t === 'AAAA') && a.type === 5)) {
          dnsRows.push(`${rrLabel(a.type)}: ${a.data}`);
        }
      }
    });
    if (dnsRows.length) out.push(finding('dns', 'Registos DNS', [...new Set(dnsRows)], ['doh']));

    // Certificate Transparency -> subdominios.
    //
    // crt.sh só é consultado quando o CertSpotter troux pouco. Medido em
    // 2026-09-29: o CertSpotter responde em ~1,6 s com 33 KB; o crt.sh devolveu
    // 502 duas vezes e timeout uma em tres tentativas. Consultar os dois sempre
    // enchia a matriz de fontes de vermelho sem acrescentar subdominios.
    const subs = new Set<string>();
    const cs = await cachedSource({ log, srcId: 'certspotter', label: 'CertSpotter (Certificate Transparency)', url: 'api.certspotter.com', key: `cs:${domain}`, ttl: 6 * 3600, count: false }, () => certspotter(domain, log));
    for (const c of cs) for (const d of c.dns_names ?? []) addSub(subs, d, domain);
    const ctSources: string[] = ['certspotter'];
    if (cs.length < 3) {
      log.note('Poucos nomes no CertSpotter; a consultar crt.sh como segunda fonte de CT.');
      const crt = await cachedSource({ log, srcId: 'crtsh', label: 'crt.sh (Certificate Transparency)', url: 'crt.sh', key: `crt:${domain}`, ttl: 24 * 3600, count: false }, () => crtsh(domain, log));
      if (crt.length) ctSources.push('crtsh');
      for (const c of crt) for (const d of (c.name_value ?? '').split('\n')) addSub(subs, d, domain);
    } else {
      log.skipped('crtsh', 'crt.sh (Certificate Transparency)', 'crt.sh', 'o CertSpotter ja devolveu nomes suficientes; crt.sh fica como suplente (e e lento/ instavel)');
    }
    if (subs.size) {
      out.push(finding('subdominios', `Subdominios via CT (${subs.size})`, [...subs].sort(), ctSources,
        { kind: 'fact', confidence: ctSources.length > 1 ? 'corroborated' : 'indicated' }));
    } else {
      log.note('Nenhum subdominio encontrado nos logs de CT para este dominio.');
    }

    // Nenhuma fonte respondeu: dizer isso explicitamente. Devolver zero achados sem
    // explicacao e enganador — o utilizador nao sabe se o dominio nao existe ou se
    // as fontes falharam.
    if (!out.length) {
      out.push(finding('conclusao', 'Sem dados',
        `Nenhuma fonte respondeu sobre "${domain}". Ou o dominio nao existe, ou as fontes publicas nao o conhecem.`,
        ['rdap', 'doh'], { kind: 'inference', confidence: 'weak' }));
    }
    const usados = log.sources.filter((x) => x.status === 'ok').map((x) => x.id);
    out.push(finding('alvo', 'Dominio pesquisado', domain, usados.length ? usados : ['doh'], { confidence: 'confirmed' }));

    return { findings: out, log };
  },
});

function addSub(set: Set<string>, raw: string, domain: string): void {
  for (const piece of raw.split('\n').map((s) => s.trim().toLowerCase())) {
    if (!piece || piece.startsWith('*.')) continue;
    const h = piece.replace(/^\*\./, '').replace(/\.$/, '');
    if (h === domain || h.endsWith('.' + domain)) set.add(h);
  }
}

// ---------------- IP ANALYZER ----------------
registerTool({
  id: 'ip-analyzer',
  name: 'Analisador de IP',
  category: 'infra',
  summary: 'Geolocalização, ASN/ISP, portas abertas, proxies, alocação RDAP e histórico de análise.',
  longDesc: 'Cruza quatro fontes públicas de geolocalização e rede (ipwho.is, freeipapi, ipinfo.io, RDAP) com o Shodan InternetDB para as portas e o Shodan para o que a última análise viu. Quando duas ou mais fontes concordam, o campo é marcado como corroborado. Nenhum campo é preenchido com "?" quando a fonte não responde.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'none',
  tags: ['ip', 'asn', 'geo', 'portas', 'reputacao'],
  fields: [{ name: 'ip', label: 'Endereco IP', type: 'text', placeholder: '8.8.8.8', required: true }],
  async run(input, ctx) {
    const ip = String(input.ip ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[0-9a-f:]+$/i.test(ip)) {
      log.error('validacao', 'Endereco IP', ip, 'formato invalido');
      out.push(finding('validacao', 'Endereco', ip, [], { confidence: 'weak' }));
      return { findings: out, log };
    }
    out.push(finding('alvo', 'IP analisado', ip, [], { confidence: 'confirmed' }));

    const [a, b, c] = await Promise.all([
      cachedSource({ log, srcId: 'freeipapi', label: 'freeipapi.com (geolocalizacao/ISP)', url: `freeipapi.com/api/json/${ip}`, key: `freeipapi:${ip}`, ttl: 3600, count: false }, () => freeIpApi(ip, log)),
      cachedSource({ log, srcId: 'ipwho.is', label: 'ipwho.is (geolocalizacao/ASN)', url: `https://ipwho.is/${ip}`, key: `ipwhois:${ip}`, ttl: 3600, count: false }, () => ipwhois(ip, log)),
      cachedSource({ log, srcId: 'ipinfo', label: 'ipinfo.io (geolocalizacao/ASN)', url: `https://ipinfo.io/${ip}/json`, key: `ipinfo:${ip}`, ttl: 3600, count: false }, () => ipInfo(ip, log)),
    ]);

    /** Consolida um campo entre fontes: se duas concordam, corrobora. */
    const merge = (label: string, group: string, values: { v: string; src: string }[]) => {
      const vals = values.filter((x) => x.v && x.v !== '—' && x.v.toLowerCase() !== 'null' && x.v.toLowerCase() !== 'n/a');
      if (!vals.length) return;
      const counts = new Map<string, number>();
      for (const x of vals) counts.set(x.v, (counts.get(x.v) ?? 0) + 1);
      const [best, n] = [...counts.entries()].sort((p, q) => q[1] - p[1])[0]!;
      const ids = vals.filter((x) => x.v === best).map((x) => x.src);
      const divergem = [...new Set(vals.map((x) => x.v))].length > 1;
      out.push(finding(group, label, best, ids, {
        confidence: n >= 2 ? 'corroborated' : 'indicated',
        kind: n >= 2 ? 'fact' : 'inference',
        ...(n >= 2 && !divergem ? {} : {}),
      }));
      if (divergem) {
        out.push(finding(group, `${label} (todas as fontes)`, [...new Set(vals.map((x) => `${x.v} [${x.src}]`))], vals.map((x) => x.src), { kind: 'fact', confidence: 'indicated' }));
      }
    };

    merge('Pais', 'geo', [
      { v: a?.countryName ?? '', src: 'freeipapi' },
      { v: b?.country ?? '', src: 'ipwho.is' },
      { v: c?.country ?? '', src: 'ipinfo' },
    ]);
    merge('Regiao', 'geo', [
      { v: a?.regionName ?? '', src: 'freeipapi' },
      { v: b?.region ?? '', src: 'ipwho.is' },
      { v: c?.region ?? '', src: 'ipinfo' },
    ]);
    merge('Cidade', 'geo', [
      { v: a?.cityName ?? '', src: 'freeipapi' },
      { v: b?.city ?? '', src: 'ipwho.is' },
      { v: c?.city ?? '', src: 'ipinfo' },
    ]);
    merge('ISP / organizacao', 'asn', [
      { v: b?.connection?.isp ?? b?.connection?.org ?? '', src: 'ipwho.is' },
      { v: c?.org?.replace(/^AS\d+\s+/, '') ?? '', src: 'ipinfo' },
    ]);
    merge('ASN', 'asn', [
      { v: b?.connection?.asn ? `AS${b.connection.asn}` : '', src: 'ipwho.is' },
      { v: c?.org?.match(/^AS(\d+)/)?.[1] ? `AS${c.org.match(/^AS(\d+)/)![1]}` : '', src: 'ipinfo' },
    ]);
    merge('Fuso horario', 'geo', [
      { v: b?.timezone?.id ?? '', src: 'ipwho.is' },
      { v: c?.timezone ?? '', src: 'ipinfo' },
    ]);
    const lat = a?.latitude ?? b?.latitude ?? Number(c?.loc?.split(',')[0]);
    const lon = a?.longitude ?? b?.longitude ?? Number(c?.loc?.split(',')[1]);
    if (Number.isFinite(lat as number) && Number.isFinite(lon as number) && (lat as number) !== 0) {
      out.push(finding('geo', 'Coordenadas (aproximadas)', `${(lat as number).toFixed(5)}, ${(lon as number).toFixed(5)}`,
        [a?.latitude != null ? 'freeipapi' : '', b?.latitude != null ? 'ipwho.is' : '', c?.loc ? 'ipinfo' : ''].filter(Boolean),
        { kind: 'inference', confidence: 'weak' }));
    }
    if (b?.security?.vpn || b?.security?.tor) out.push(finding('risco', 'VPN/TOR', 'sim', ['ipwho.is'], { confidence: 'corroborated' }));
    if (b?.security?.proxy) out.push(finding('risco', 'Proxy', 'sim', ['ipwho.is'], { confidence: 'corroborated' }));
    if (b?.security?.hosting) out.push(finding('risco', 'Datacenter/hosting', 'sim', ['ipwho.is'], { confidence: 'corroborated' }));
    if (a && !b?.security?.proxy && !b?.security?.hosting && !b?.security?.vpn) {
      out.push(finding('risco', 'Proxy/hosting/VPN', 'nenhuma das fontes sinalizou', ['ipwho.is'], { kind: 'inference', confidence: 'indicated' }));
    }
    if (c?.postal) out.push(finding('geo', 'Codigo postal', c.postal, ['ipinfo']));
    if (c?.hostname) out.push(finding('dns', 'Hostname inverso', c.hostname, ['ipinfo'], { kind: 'inference', confidence: 'indicated' }));

    // portas via InternetDB (sem chave)
    const idb = await cachedSource({ log, srcId: 'shodan-idb', label: 'Shodan InternetDB (portas/hostnames)', url: `https://internetdb.shodan.io/${ip}`, key: `idb:${ip}`, ttl: 3600, count: false }, () => internetDb(ip, log));
    if (idb?.ports?.length) {
      out.push(finding('portas', `Portas abertas (${idb.ports.length})`, idb.ports, ['shodan-idb'], { confidence: 'corroborated' }));
      if (idb.hostnames?.length) out.push(finding('portas', 'Hostnames', idb.hostnames, ['shodan-idb']));
      if (idb.cpes?.length) out.push(finding('portas', 'CPEs (software)', idb.cpes, ['shodan-idb']));
      if (idb.vulns?.length) out.push(finding('vulns', 'CVEs asociadas (Shodan)', idb.vulns, ['shodan-idb'], { kind: 'inference', confidence: 'indicated' }));
    } else {
      log.note('Shodan InternetDB sem portas registadas para este IP (ou IP que a Shodan não conhece).');
    }

    // Shodan host: com a chave do utilizador se existir, senão no modo best-effort
    // (que devolve dados reais mas cujo uso nao e documentado pela Shodan).
    const shodanKey = ctx.byok['shodan'];
    const sh = await cachedSource({ log, srcId: 'shodan', label: 'Shodan (ficha do host)', url: `api.shodan.io/shodan/host/${ip}`, key: `shodan:${ip}`, ttl: 6 * 3600, count: false },
      () => shodanHost(ip, log, shodanKey));
    if (sh?.host) {
      const h = sh.host;
      const conf = sh.authed ? 'corroborated' as const : 'indicated' as const;
      if (h.os) out.push(finding('infra', 'OS detetado', h.os, ['shodan'], { confidence: conf }));
      if (h.tags?.length) out.push(finding('infra', 'Tags', h.tags, ['shodan'], { confidence: conf }));
      if (h.hostnames?.length) out.push(finding('infra', 'Hostnames (Shodan)', h.hostnames, ['shodan'], { confidence: conf }));
      if (h.last_update) out.push(finding('infra', 'Ultima atualizacao no Shodan', h.last_update, ['shodan'], { kind: 'fact', confidence: 'confirmed' }));
      if (h.last_scan) out.push(finding('infra', 'Ultima varredura do Shodan', h.last_scan, ['shodan'], { kind: 'fact', confidence: 'confirmed' }));
      out.push(finding('infra', 'Procedencia desta ficha', sh.authed ? 'consulta autenticada (a sua chave Shodan)' : 'resposta obtida SEM chave; a Shodan nao documenta este uso, por isso a confianza e reduzida', ['shodan'], { kind: 'inference', confidence: conf }));
    }
    if (!shodanKey) log.needsKey('shodan', 'Shodan (chave oficial)', 'https://account.shodan.io', 'Com a sua chave a ficha do host passa a ser consultada de forma documentada (e com os campos completos).');

    // RDAP IP
    const rd = await cachedSource({ log, srcId: 'rdap', label: 'RDAP (alocacao de IP)', url: `https://rdap.org/ip/${ip}`, key: `rdapip:${ip}`, ttl: 86400, count: false }, () => rdapIp(ip, log));
    if (rd) {
      if (rd.name) out.push(finding('rdap', 'Titular da alocacao', rd.name, ['rdap'], { confidence: 'corroborated' }));
      if (rd.country) out.push(finding('rdap', 'Pais do registo', rd.country, ['rdap']));
      if (rd.startAddress && rd.endAddress) out.push(finding('rdap', 'Faixa alocada', `${rd.startAddress} - ${rd.endAddress}`, ['rdap']));
      const remarks = (rd.remarks ?? []).flatMap((r) => r.description ?? []);
      if (remarks.length) out.push(finding('rdap', 'Notas do registo', [...new Set(remarks)].slice(0, 6), ['rdap']));
    }

    if (out.length <= 1) {
      out.push(finding('conclusao', 'Sem dados',
        `Nenhuma fonte respondeu sobre ${ip}. Pode ser um endereco que as bases publicas nao conhecem (por exemplo, um IP residencial recem-atribuido).`,
        [], { kind: 'inference', confidence: 'weak' }));
    }
    return { findings: out, log };
  },
});

// ---------------- PORT SCANNER (PASSIVO) ----------------
registerTool({
  id: 'port-scanner',
  name: 'Scanner de Portas (passivo)',
  category: 'infra',
  summary: 'Portas e servicos expostos via Shodan InternetDB. Sem varredura ativa.',
  longDesc: 'Consulta a base de dados publica do Shodan InternetDB (sem chave) para listar portas abertas, hostnames e CVEs associados. E 100% passivo: nao envia um unico pacote ao alvo. Nao faz varredura ativa por decisao de seguranca e legal.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'none',
  tags: ['portas', 'passivo', 'shodan', 'servicos'],
  fields: [{ name: 'target', label: 'IP ou dominio', type: 'text', placeholder: '8.8.8.8', required: true }],
  async run(input) {
    const target = String(input.target ?? '').trim();
    const log = new SourceLog();
    let ip = target;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) {
      const r = await doh(target, 'A', log);
      ip = r?.Answer?.find((x) => x.type === 1)?.data ?? target;
    }
    const out: Finding[] = [];
    const idb = await internetDb(ip, log);
    if (idb?.ports?.length) {
      const COMMON: Record<number, string> = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 9200: 'Elasticsearch', 27017: 'MongoDB' };
      out.push(finding('portas', 'IP alvo', ip, ['shodan-idb']));
      out.push(finding('portas', 'Portas abertas', idb.ports, ['shodan-idb'], { confidence: 'corroborated' }));
      const named = idb.ports.map((p) => ({ porta: p, servicoProvavel: COMMON[p] ?? 'desconhecido' }));
      out.push(finding('portas', 'Portas (servico provavel)', named, ['shodan-idb'], { kind: 'inference' }));
      if (idb.hostnames?.length) out.push(finding('portas', 'Hostnames', idb.hostnames, ['shodan-idb']));
      if (idb.cpes?.length) out.push(finding('portas', 'Software identificado', idb.cpes, ['shodan-idb']));
      if (idb.vulns?.length) out.push(finding('vulns', 'CVEs', idb.vulns, ['shodan-idb'], { confidence: 'indicated' }));
    } else {
      log.note('Nenhuma porta registada pelo Shodan InternetDB para este IP.');
    }
    return { findings: out, log, notes: ['Scanner 100% passivo. Nenhum pacote foi enviado ao alvo.'] };
  },
});

// ---------------- ASN LOOKUP ----------------
registerTool({
  id: 'asn-lookup',
  name: 'Consulta de ASN',
  category: 'infra',
  summary: 'Autonomous System completa: titular, anuncio, rotas e prefixos anunciados em BGP, via RIPEstat.',
  longDesc: 'Consulta tres chamadas a base de dados publica do RIPEstat (a fonte de referencia do RIPE): o resumo do AS, o WHOIS do recurso e os prefixos efetivamente anunciados em BGP. Sem chave. Mostrar a lista de prefixos e o espaco total que ocupam e o que permite saber que dimensao tem uma rede de facto.',
  minPlan: 'free',
  freeTier: true,
  tags: ['asn', 'ripe', 'rotas', 'bgp', 'prefixos'],
  fields: [{ name: 'asn', label: 'Numero AS', type: 'text', placeholder: 'AS13335 (ou 13335)', required: true }],
  async run(input) {
    const raw = String(input.asn ?? '').trim();
    const asn = raw.toUpperCase().startsWith('AS') ? raw : `AS${raw}`;
    const log = new SourceLog();
    const out: Finding[] = [];
    if (!/^AS\d{1,10}$/.test(asn)) {
      log.error('validacao', 'Numero AS', raw, 'formato invalido (use AS followed de digitos)');
      out.push(finding('validacao', 'Numero AS', raw || '(vazio)', [], { confidence: 'weak' }));
      return { findings: out, log };
    }
    out.push(finding('alvo', 'AS pesquisado', asn, [], { confidence: 'confirmed' }));

    // Três consultas independentes ao mesmo serviço: em paralelo.
    const [r, w, prefixes] = await Promise.all([
      ripeAsOverview(asn, log),
      ripeWhois(asn, log),
      ripeAnnouncedPrefixes(asn, log),
    ]);

    if (r?.data) {
      out.push(finding('asn', 'ASN', r.data.resource ?? asn, ['ripe']));
      for (const a of r.data.asns ?? []) out.push(finding('asn', 'Titular (holder)', `${a.holder} (AS${a.asn})`, ['ripe'], { confidence: 'corroborated' }));
      out.push(finding('asn', 'Anunciado', r.data.announced ? 'sim' : 'nao', ['ripe'], { kind: 'fact', confidence: 'corroborated' }));
      if (r.data.block?.length) out.push(finding('asn', 'Blocos', r.data.block.map((b) => b.resource), ['ripe']));
    } else {
      log.note('AS não encontrado ou sem dados no RIPEstat (as-overview).');
    }

    if (w?.data) {
      if (w.data.first_announced) out.push(finding('asn', 'Primeiro anuncio', w.data.first_announced, ['ripe-whois']));
      const origins = [...new Set((w.data.routes ?? []).map((x) => x.origin).filter(Boolean))];
      if (origins.length) out.push(finding('asn', 'Origens de rota que o anunciam', origins, ['ripe-whois']));
      if (w.data.asns?.length) out.push(finding('asn', 'ASNs registados', [...new Set(w.data.asns)], ['ripe-whois']));
    }

    if (prefixes.length) {
      // Soma do tamanho de cada prefixo (2^(32-bits) em IPv4, 2^(128-bits) em IPv6).
      const total = prefixes.reduce((acc, p) => {
        const bits = Number(p.prefix.split('/')[1] ?? 32);
        const fam = p.prefix.includes(':') ? 128 : 32;
        return acc + Math.pow(2, fam - bits);
      }, 0);
      out.push(finding('prefixos', `Prefixos anunciados (${prefixes.length})`, prefixes.map((p) => p.prefix).slice(0, 60), ['ripe-prefixes']));
      out.push(finding('prefixos', 'Espaco total anunciado', `${total.toLocaleString('pt-BR')} enderecos (soma dos prefixos)`, ['ripe-prefixes'], { kind: 'inference', confidence: 'corroborated' }));
      const v4 = prefixes.filter((p) => !p.prefix.includes(':')).length;
      const v6 = prefixes.length - v4;
      if (v4 || v6) out.push(finding('prefixos', 'IPv4 / IPv6', { ipv4: v4, ipv6: v6 }, ['ripe-prefixes'], { kind: 'fact', confidence: 'corroborated' }));
    }

    if (out.length <= 1) {
      out.push(finding('conclusao', 'Sem dados', `O RIPEstat não devolveu dados para ${asn}. Ou o AS não existe, ou nunca foi anunciado no BGP.`, ['ripe'], { kind: 'inference', confidence: 'weak' }));
    }
    return { findings: out, log };
  },
});

// ---------------- URL SCANNER ----------------
registerTool({
  id: 'url-scanner',
  name: 'Scanner de URL',
  category: 'web',
  summary: 'Cabecalhos, cadeia de redirects, TLS, tecnologia e registos publicos da URL.',
  longDesc: 'Faz fetch controlado da URL (com guarda anti-SSRF), reporta codigo, cabecalhos, redirects, tecnologia detetada, tamanho e consulta historico no Wayback. Nunca executa o JS do alvo.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'none',
  tags: ['url', 'headers', 'tls', 'redirect'],
  fields: [{ name: 'url', label: 'URL', type: 'url', placeholder: 'https://exemplo.com', required: true }],
  async run(input) {
    let url = String(input.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const log = new SourceLog();
    const out: Finding[] = [];
    try {
      const r = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 400_000 });
      log.ok('fetch', 'HTTP fetch direto (protegido)', r.url, r.ms, 1, `HTTP ${r.status}`);
      out.push(finding('http', 'URL final', r.url, ['fetch']));
      out.push(finding('http', 'Codigo de estado', String(r.status), ['fetch']));
      out.push(finding('http', 'Tamanho', `${r.bytes} bytes${r.truncated ? ' (truncado)' : ''}`, ['fetch']));
      if (r.redirects.length) out.push(finding('http', 'Redirections', r.redirects, ['fetch']));
      const h = r.headers;
      if (h['server']) out.push(finding('tecnologia', 'Server', h['server'], ['fetch']));
      if (h['x-powered-by']) out.push(finding('tecnologia', 'X-Powered-By', h['x-powered-by'], ['fetch']));
      if (h['content-type']) out.push(finding('http', 'Content-Type', h['content-type'], ['fetch']));
      const sec = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy'].filter((k) => h[k]);
      out.push(finding('seguranca', 'Cabecalhos de seguranca presentes', sec, ['fetch']));
      const tech = detectTech(h, r.body);
      if (tech.length) out.push(finding('tecnologia', 'Tecnologias detetadas', tech, ['fetch'], { kind: 'inference' }));
      // title
      const m = r.body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
      if (m) out.push(finding('meta', 'Titulo', m[1]!.trim(), ['fetch']));
    } catch (e) {
      if (e instanceof SsrfError) { log.error('fetch', 'HTTP fetch', url, `Bloqueado (SSRF): ${e.message}`); }
      else log.error('fetch', 'HTTP fetch', url, String((e as Error).message).slice(0, 80));
    }
    // Wayback
    const { wayback } = await import('../net/sources.ts');
    const wb = await wayback(url, log);
    if (wb?.archived_snapshots?.closest) {
      const c = wb.archived_snapshots.closest;
      out.push(finding('historico', 'Snapshot mais proximo', c.url, ['wayback'], { link: c.url }));
    }
    return { findings: out, log };
  },
});

function detectTech(h: Record<string, string>, body: string): string[] {
  const tech: string[] = [];
  const ck = h['set-cookie'] ?? '';
  if (/__cf_bm|cf-ray/i.test(ck) || /cloudflare/i.test(h['server'] ?? '')) tech.push('Cloudflare');
  if (/cloudflare/i.test(body.slice(0, 5000))) tech.push('Cloudflare');
  if (/Next\.js|__NEXT_DATA__/.test(body)) tech.push('Next.js');
  if (/_nuxt/.test(body)) tech.push('Nuxt');
  if (/wp-content|wp-includes/.test(body)) tech.push('WordPress');
  if (/Drupal\.settings|drupalSettings/.test(body)) tech.push('Drupal');
  if (/Shopify|cdn\.shopify/.test(body)) tech.push('Shopify');
  if (/_astro/.test(body)) tech.push('Astro');
  if (/vite|@vite\/client/.test(body)) tech.push('Vite');
  if (/react(-dom)?\.production|__REACT/.test(body)) tech.push('React');
  if (/vue/.test(body) && /data-v-/.test(body)) tech.push('Vue');
  if (h['x-graphql-event'] || /graphql/i.test(body.slice(0, 2000))) tech.push('GraphQL');
  return [...new Set(tech)];
}

// ---------------- WEB CRAWLER ----------------
// Regex de atributo HTML que aceita valor com aspas (duplo/simples) OU sem aspas.
const ATTR_RE = /\b(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;
const SCRIPT_RE = /<script[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;

registerTool({
  id: 'web-crawler',
  name: 'Rastreador Web',
  category: 'web',
  summary: 'Extrai links, emails, subdominios, scripts e metadados de uma pagina (com teto).',
  longDesc: 'Rasteja o site ate um limite de paginas, extraindo links internos/externos, emails, subdominios, scripts, formulários e metadados. Respeita robots.txt. Anti-SSRF ativo em cada salto.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'none',
  tags: ['crawl', 'links', 'emails', 'subdominios'],
  fields: [{ name: 'url', label: 'URL inicial', type: 'url', placeholder: 'https://exemplo.com', required: true }],
  async run(input) {
    let seed = String(input.url ?? '').trim();
    if (!/^https?:\/\//i.test(seed)) seed = 'https://' + seed;
    const log = new SourceLog();
    const out: Finding[] = [];
    const MAXPAGES = 12;
    const seen = new Set<string>();
    const allLinks = new Set<string>();
    const allEmails = new Set<string>();
    const allSubs = new Set<string>();
    const host = new URL(seed).hostname;
    let robots = '';
    try {
      const rb = await safeFetch(new URL('/robots.txt', seed).toString(), { timeoutMs: 8000 });
      robots = rb.body;
      log.ok('robots', 'robots.txt', rb.url, rb.ms, 1);
    } catch { log.empty('robots', 'robots.txt', '/robots.txt', 0, 'indisponivel'); }
    const disallow = parseRobots(robots);

    const queue = [seed];
    let pages = 0;
    while (queue.length && pages < MAXPAGES) {
      const u = queue.shift()!;
      if (seen.has(u)) continue;
      seen.add(u);
      pages++;
      let r;
      try { r = await safeFetch(u, { timeoutMs: 10_000, maxBytes: 500_000 }); }
      catch (e) { log.error('crawl', 'Pagina', u, e instanceof SsrfError ? e.message : 'erro'); continue; }
      if (r.status >= 400) { log.empty('crawl', `Pagina ${u}`, u, r.ms, `HTTP ${r.status}`); continue; }
      log.ok('crawl', `Pagina ${r.url}`, r.url, r.ms, 1, `HTTP ${r.status}`);
      // links
      // Atributos HTML podem vir COM ou SEM aspas. Uma pagina bem formatada usa
      // aspas, mas HTML minificado (muito comum) usa `href=https://...`. Suportar os
      // dois casos — senao o crawler devolve zero links em metade da web.
      for (const m of r.body.matchAll(ATTR_RE)) {
        const href = m[2] ?? m[3] ?? m[4] ?? '';
        if (!href || href.startsWith('data:') || href.startsWith('#') || href.startsWith('javascript:')) continue;
        try {
          const abs = new URL(href, r.url);
          allLinks.add(abs.toString());
          if (abs.hostname.endsWith(host) && abs.hostname !== host) allSubs.add(abs.hostname);
          if (abs.hostname === host && !disallow.some((d) => abs.pathname.startsWith(d)) && !seen.has(abs.toString()) && abs.hostname === host) {
            if (abs.protocol.startsWith('http') && allLinks.size < 200) queue.push(abs.toString());
          }
        } catch {}
      }
      // emails
      for (const m of r.body.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
        const e = m[0]!.toLowerCase();
        if (!/^(example|test|noreply|no-reply|donotreply|sentry|wixpress)@/i.test(e)) allEmails.add(e);
      }
      // scripts/forms
      if (pages === 1) {
        const scripts = [...new Set([...r.body.matchAll(SCRIPT_RE)].map((m) => m[2] ?? m[3] ?? m[4] ?? '').filter(Boolean))];
        if (scripts.length) out.push(finding('crawl', `Scripts externos (${scripts.length})`, scripts.slice(0, 20), ['crawl']));
        const forms = [...r.body.matchAll(/<form[^>]+action=["']([^"']+)["']/gi)].map((m) => m[1]!);
        if (forms.length) out.push(finding('crawl', 'Formularios (action)', [...new Set(forms)].slice(0, 15), ['crawl']));
      }
    }
    out.unshift(finding('crawl', 'URL inicial', seed, ['crawl']));
    out.push(finding('crawl', `Paginas visitadas (teto ${MAXPAGES})`, pages, ['crawl']));
    out.push(finding('crawl', `Links encontrados (${allLinks.size})`, [...allLinks].slice(0, 150), ['crawl']));
    if (allSubs.size) out.push(finding('crawl', `Subdominios do site (${allSubs.size})`, [...allSubs], ['crawl']));
    if (allEmails.size) out.push(finding('crawl', `Emails encontrados (${allEmails.size})`, [...allEmails], ['crawl'], { confidence: 'indicated' }));
    if (!allEmails.size) log.note('Nenhum email encontrado nas paginas visitadas (paginas podem remover emails em JS).');
    return { findings: out, log, notes: [`Rastejo limitado a ${MAXPAGES} paginas para nao sobrecarregar o alvo.`] };
  },
});

export function parseRobots(txt: string): string[] {
  const dis: string[] = [];
  let applies = false;
  for (const line of txt.split('\n')) {
    const l = line.trim();
    if (/^user-agent:/i.test(l)) applies = /:\s*\*/.test(l);
    if (applies && /^disallow:/i.test(l)) {
      const v = l.split(':')[1]!.trim();
      if (v) dis.push(v);
    }
  }
  return dis;
}
