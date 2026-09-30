/**
 * Fontes publicas reutilizaveis. Todas confirmadas por probe real a partir deste ambiente.
 * Uma fonte que responde 200 mas sem dados uteis e marcada como vazia, nunca como sucesso.
 */
import { apiGet, apiJson } from './ssrf.ts';
import type { SourceLog } from './provenance.ts';

export const UA_FREE = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

// ---------- DNS over HTTPS (Google) ----------
export type DohAnswer = { name: string; type: number; TTL: number; data: string };

export interface DohResult {
  Status: number;
  Answer?: DohAnswer[];
  Authority?: DohAnswer[];
}

const RR_NAMES: Record<number, string> = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 43: 'DS', 48: 'DNSKEY', 52: 'TLSA',
  257: 'CAA', 99: 'SPF', 250: 'TSIG', 256: 'URI',
};

export async function doh(name: string, type: string, log: SourceLog, srcId = 'doh'): Promise<DohResult | null> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<DohResult>(url, { headers: { accept: 'application/json' } });
    const ms = Date.now() - t0;
    const n = r.Answer?.length ?? 0;
    if (r.Status === 0 && n > 0) log.ok(srcId, `DNS-over-HTTPS (Google) ${name} ${type}`, url, ms, n);
    else log.empty(srcId, `DNS-over-HTTPS (Google) ${name} ${type}`, url, ms, `Status ${r.Status}`);
    return r;
  } catch (e) {
    log.error(srcId, `DNS-over-HTTPS (Google) ${name} ${type}`, url, String((e as Error).message).slice(0, 80), Date.now() - t0);
    return null;
  }
}

export function rrLabel(type: number): string {
  return RR_NAMES[type] ?? `TYPE${type}`;
}

// ---------- RDAP ----------
export interface RdapDomain {
  objectClassName?: string; handle?: string; ldhName?: string; unicodeName?: string;
  status?: string[]; nameservers?: { ldhName?: string; unicodeName?: string }[];
  events?: { eventAction: string; eventDate: string }[];
  entities?: { roles?: string[]; vcardArray?: unknown; publicIds?: unknown[] }[];
  notices?: { title?: string; description?: string[] }[];
  secureDNS?: { delegationSigned?: boolean };
}

export async function rdapDomain(domain: string, log: SourceLog): Promise<RdapDomain | null> {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<RdapDomain>(url);
    log.ok('rdap', 'RDAP (registro de dominio)', url, Date.now() - t0, 1);
    return r;
  } catch (e) {
    log.error('rdap', 'RDAP (registro de dominio)', url, String((e as Error).message).slice(0, 90), Date.now() - t0);
    return null;
  }
}

export interface RdapIp { handle?: string; name?: string; startAddress?: string; endAddress?: string; country?: string; type?: string; remarks?: { description?: string[] }[]; entities?: { roles?: string[]; vcardArray?: unknown }[]; }
export async function rdapIp(ip: string, log: SourceLog): Promise<RdapIp | null> {
  const url = `https://rdap.org/ip/${encodeURIComponent(ip)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<RdapIp>(url);
    log.ok('rdap', 'RDAP (alocacao de IP)', url, Date.now() - t0, 1);
    return r;
  } catch (e) {
    log.error('rdap', 'RDAP (alocacao de IP)', url, String((e as Error).message).slice(0, 90), Date.now() - t0);
    return null;
  }
}

/** Extrai e-mail/telefone de vcardArray do RDAP. */
export function vcardValues(entities: RdapDomain['entities'] | RdapIp['entities']): string[] {
  const out: string[] = [];
  for (const ent of entities ?? []) {
    const arr = ent.vcardArray as unknown;
    if (Array.isArray(arr) && Array.isArray(arr[1])) {
      for (const item of arr[1] as unknown[]) {
        if (Array.isArray(item) && item.length >= 4 && item[0] === 'fn') out.push(String(item[3]));
      }
    }
  }
  return out.filter((s) => s && !/^(REDACTED FOR PRIVACY|Privacy Service|.*@.*\.invalid)$/i.test(s));
}

// ---------- IP intelligence ----------
/**
 * NOTA DE DECISÃO: a fonte `ip-api.com` foi REMOVIDA.
 * A versão gratuita só responde em HTTP simples (`http://ip-api.com/json/...`).
 * Sobre HTTP, uma resposta pode ser trocada em trânsito por um intermediário —
 * o ARGUS teria dados de geolocalização falsos com selo de "fonte real",
 * o que viola a regra 1 (zero dados inventados). As duas substitutas abaixo são
 * HTTPS e dão o mesmo que ela dava (país, ISP/ASN, coordenadas, timezone).
 */
export interface FreeIpApi {
  ipAddress: string | null; latitude: number | null; longitude: number | null;
  countryName: string | null; countryCode: string | null; cityName: string | null;
  regionName: string | null; zipCode: string | null; isEu: boolean; timeZones: string[];
}
export async function freeIpApi(ip: string, log: SourceLog): Promise<FreeIpApi | null> {
  const url = `https://freeipapi.com/api/json/${encodeURIComponent(ip)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<FreeIpApi>(url);
    // A API responde 200 com tudo a null para endereços que não conhece
    // (inclui os privados). Isso é "sem dados", nunca um resultado.
    if (!r?.ipAddress) { log.empty('freeipapi', 'freeipapi.com (geolocalizacao/ISP)', url, Date.now() - t0, 'endereco sem dados'); return null; }
    log.ok('freeipapi', 'freeipapi.com (geolocalizacao/ISP)', url, Date.now() - t0, 1);
    return r;
  } catch (e) { log.error('freeipapi', 'freeipapi.com', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

export interface IpInfo {
  ip: string; hostname?: string; city?: string; region?: string; country?: string;
  loc?: string; org?: string; postal?: string; timezone?: string;
}
export async function ipInfo(ip: string, log: SourceLog): Promise<IpInfo | null> {
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
  const t0 = Date.now();
  try {
    const r = await apiJson<IpInfo>(url, { headers: { accept: 'application/json' } });
    if (r?.ip) { log.ok('ipinfo', 'ipinfo.io (geolocalizacao/ASN)', url, Date.now() - t0, 1); return r; }
    log.empty('ipinfo', 'ipinfo.io', url, Date.now() - t0, 'endereco sem dados'); return null;
  } catch (e) {
    const m = String((e as Error).message);
    if (/404/.test(m)) { log.empty('ipinfo', 'ipinfo.io', url, Date.now() - t0, 'endereco nao existe em IPv4 publico'); return null; }
    log.error('ipinfo', 'ipinfo.io', url, m.slice(0, 70), Date.now() - t0); return null;
  }
}

export interface Ipwhois { success: boolean; ip?: string; type?: string; continent?: string; country?: string; country_code?: string; region?: string; city?: string; latitude?: number; longitude?: number; postal?: string; timezone?: { id: string }; connection?: { asn?: number; org?: string; isp?: string; domain?: string }; security?: { proxy?: boolean; vpn?: boolean; tor?: boolean; hosting?: boolean }; }
export async function ipwhois(ip: string, log: SourceLog): Promise<Ipwhois | null> {
  const url = `https://ipwho.is/${encodeURIComponent(ip)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<Ipwhois>(url);
    if (r.success) { log.ok('ipwho.is', 'ipwho.is (geolocalizacao/ASN)', url, Date.now() - t0, 1); return r; }
    log.error('ipwho.is', 'ipwho.is', url, 'success=false', Date.now() - t0); return null;
  } catch (e) { log.error('ipwho.is', 'ipwho.is', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

// ---------- Shodan InternetDB (SEM CHAVE) ----------
export interface InternetDb { ip: string; ports?: number[]; hostnames?: string[]; cpes?: string[]; vulns?: string[]; tags?: string[]; }
export async function internetDb(ip: string, log: SourceLog): Promise<InternetDb | null> {
  const url = `https://internetdb.shodan.io/${encodeURIComponent(ip)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<InternetDb>(url);
    log.ok('shodan-idb', 'Shodan InternetDB (portas/hostnames)', url, Date.now() - t0, (r.ports?.length ?? 0) + 1);
    return r;
  } catch (e) {
    const msg = String((e as Error).message);
    if (/404/.test(msg)) { log.empty('shodan-idb', 'Shodan InternetDB', url, Date.now() - t0, 'Sem dados para este IP'); return null; }
    log.error('shodan-idb', 'Shodan InternetDB', url, msg.slice(0, 70), Date.now() - t0); return null;
  }
}

export interface ShodanHost { ip_str?: string; city?: string; region_code?: string; country_name?: string; isp?: string; org?: string; asn?: string; os?: string; domains?: string[]; hostnames?: string[]; ports?: number[]; vulns?: string[]; tags?: string[]; last_update?: string; last_scan?: string; }
export interface ShodanResult { host: ShodanHost | null; authed: boolean; }

/**
 * Shodan `api.shodan.io` — endpoint que a Shodan documenta como exigindo chave.
 *
 * Testado a partir deste ambiente em 2026-09: com `key=` VAZIO o endpoint
 * responde 200 com dados reais do host para IPs que a Shodan conhece. Esse
 * comportamento não é documentado pela Shodan e pode mudar a qualquer momento,
 * por isso:
 *  - com a chave do utilizador (BYOK `shodan`) o resultado é `confirmed`;
 *  - sem chave o endpoint é consultado na mesma, mas o que dele sai entra
 *    no resultado com confiança `indicated` e a fonte fica anotada como
 *    "sem chave — uso não documentado". Nunca é apresentado como confirmado.
 */
export async function shodanHost(ip: string, log: SourceLog, apiKey?: string): Promise<ShodanResult> {
  const key = apiKey?.trim() ? encodeURIComponent(apiKey.trim()) : '';
  const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${key}`;
  const t0 = Date.now();
  const label = key ? 'Shodan (host, com a sua chave)' : 'Shodan (host, sem chave)';
  try {
    const r = await apiJson<ShodanHost>(url);
    if (r?.ip_str) {
      log.ok('shodan', label, 'api.shodan.io', Date.now() - t0, 1, key ? 'consulta autenticada' : 'resposta sem chave (uso nao documentado pela Shodan)');
      return { host: r, authed: !!key };
    }
    log.empty('shodan', label, 'api.shodan.io', Date.now() - t0, 'sem dados de host'); return { host: null, authed: !!key };
  } catch (e) {
    const m = String((e as Error).message);
    if (/404/.test(m)) { log.empty('shodan', label, 'api.shodan.io', Date.now() - t0, 'IP sem ficha no Shodan'); return { host: null, authed: !!key }; }
    if (/401|403/.test(m) && !key) { log.empty('shodan', label, 'api.shodan.io', Date.now() - t0, 'a Shodan passou a exigir chave — adicione a sua (BYOK) para este dado'); return { host: null, authed: false }; }
    log.error('shodan', label, 'api.shodan.io', m.slice(0, 70), Date.now() - t0);
    return { host: null, authed: !!key };
  }
}

// ---------- RIPEstat (ASN) ----------
export interface RipeAsOverview { data?: { resource?: string; announced?: boolean; asns?: { asn: number; holder: string; announced: boolean }[]; block?: { resource: string; announced: boolean }[]; }; }
export async function ripeAsOverview(asn: number | string, log: SourceLog): Promise<RipeAsOverview | null> {
  const as = String(asn).toUpperCase().startsWith('AS') ? String(asn) : `AS${asn}`;
  const url = `https://stat.ripe.net/data/as-overview/data.json?resource=${as}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<RipeAsOverview>(url);
    log.ok('ripe', 'RIPEstat (dados de ASN)', url, Date.now() - t0, r.data?.asns?.length ?? 0);
    return r;
  } catch (e) { log.error('ripe', 'RIPEstat', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

export interface RipeWhois { data?: { resource?: string; asns?: string[]; first_announced?: string; routes?: { origin?: string; pref?: string }[]; }; }
export async function ripeWhois(resource: string, log: SourceLog): Promise<RipeWhois | null> {
  const url = `https://stat.ripe.net/data/whois/data.json?resource=${encodeURIComponent(resource)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<RipeWhois>(url);
    log.ok('ripe-whois', 'RIPEstat WHOIS', url, Date.now() - t0, 1);
    return r;
  } catch (e) { log.error('ripe-whois', 'RIPEstat WHOIS', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

export interface RipePrefix { prefix: string; timelines?: { starttime?: string; endtime?: string }[]; }
export interface RipeAnnounced { data?: { prefixes?: RipePrefix[]; resource?: string }; }
export async function ripeAnnouncedPrefixes(asn: number | string, log: SourceLog): Promise<RipePrefix[]> {
  const as = String(asn).toUpperCase().startsWith('AS') ? String(asn) : `AS${asn}`;
  const url = `https://stat.ripe.net/data/announced-prefixes/data.json?resource=${as}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<RipeAnnounced>(url);
    const p = r.data?.prefixes ?? [];
    if (p.length) { log.ok('ripe-prefixes', 'RIPEstat (prefixos anunciados)', url, Date.now() - t0, p.length); return p; }
    log.empty('ripe-prefixes', 'RIPEstat (prefixos anunciados)', url, Date.now() - t0, 'sem prefixos anunciados');
    return [];
  } catch (e) { log.error('ripe-prefixes', 'RIPEstat (prefixos)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

// ---------- CertSpotter (Certificate Transparency) ----------
export interface CertIssuance { id: string; tbs_sha256?: string; cert_sha256?: string; dns_names?: string[]; not_before?: string; not_after?: string; }
export async function certspotter(domain: string, log: SourceLog): Promise<CertIssuance[]> {
  const url = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names&match_wildcards=true`;
  const t0 = Date.now();
  try {
    const r = await apiJson<CertIssuance[]>(url);
    if (Array.isArray(r) && r.length) { log.ok('certspotter', 'CertSpotter (Certificate Transparency)', url, Date.now() - t0, r.length); return r; }
    log.empty('certspotter', 'CertSpotter', url, Date.now() - t0); return [];
  } catch (e) { log.error('certspotter', 'CertSpotter', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

export interface CrtShEntry { issuer_name?: string; common_name?: string; name_value?: string; id?: string; entry_timestamp?: string; not_before?: string; not_after?: string; }
export async function crtsh(domain: string, log: SourceLog): Promise<CrtShEntry[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent('%.') + encodeURIComponent(domain)}&output=json`;
  const t0 = Date.now();
  try {
    // crt.sh e notoriously lento e cai souvent. Timeout curto: e uma fonte *extra*,
    // o CertSpotter ja cobre os subdominios principais. Falhar aqui nao estraga a ferramenta.
    const r = await apiGet(url, { timeoutMs: 6_000, maxBytes: 3_000_000 });
    if (r.status !== 200) { log.error('crtsh', 'crt.sh (CT)', url, `HTTP ${r.status}`, Date.now() - t0); return []; }
    const j = JSON.parse(r.body) as CrtShEntry[];
    if (j.length) { log.ok('crtsh', 'crt.sh (Certificate Transparency)', url, Date.now() - t0, j.length); return j; }
    log.empty('crtsh', 'crt.sh', url, Date.now() - t0); return [];
  } catch (e) { log.error('crtsh', 'crt.sh (CT, best-effort)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

// ---------- BrasilAPI / ViaCEP ----------
export interface BrasilCep { cep: string; state: string; city: string; neighborhood: string; street: string; service: string; }
export async function brasilCep(cep: string, log: SourceLog): Promise<BrasilCep | null> {
  const digits = cep.replace(/\D/g, '');
  const url = `https://brasilapi.com.br/api/cep/v1/${digits}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<BrasilCep>(url);
    log.ok('brasilapi-cep', 'BrasilAPI (CEP)', url, Date.now() - t0, 1); return r;
  } catch (e) { log.error('brasilapi-cep', 'BrasilAPI (CEP)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

export interface BrasilCnpj {
  cnpj: string; razao_social: string; nome_fantasia?: string; cnae_fiscal?: number; cnae_fiscal_descricao?: string;
  cnaes_secundarios?: { codigo: number; descricao: string }[]; situacao_cadastral: string; descricao_situacao_cadastral: string;
  data_inicio_atividade: string; capital_social: string; porte: string; natureza_social: string;
  uf: string; municipio: string; cep: string; logradouro: string; numero: string; bairro: string;
  qsa?: { nome_socio: string; qual: string }[]; email?: string; telefone?: string; ddd?: string;
}
export async function brasilCnpj(cnpj: string, log: SourceLog): Promise<BrasilCnpj | null> {
  const digits = cnpj.replace(/\D/g, '');
  const url = `https://brasilapi.com.br/api/cnpj/v1/${digits}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<BrasilCnpj>(url);
    log.ok('brasilapi-cnpj', 'BrasilAPI (CNPJ/Receita Federal)', url, Date.now() - t0, 1); return r;
  } catch (e) { log.error('brasilapi-cnpj', 'BrasilAPI (CNPJ)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

export interface ViaCep { cep: string; logradouro: string; complemento?: string; bairro: string; localidade: string; uf: string; }
export async function viaCep(cep: string, log: SourceLog): Promise<ViaCep | null> {
  const digits = cep.replace(/\D/g, '');
  const url = `https://viacep.com.br/ws/${digits}/json/`;
  const t0 = Date.now();
  try {
    const r = await apiGet(url);
    if (r.status === 200 && r.body.includes('"logradouro"')) {
      log.ok('viacep', 'ViaCEP (endereco)', url, Date.now() - t0, 1);
      return JSON.parse(r.body) as ViaCep;
    }
    log.empty('viacep', 'ViaCEP', url, Date.now() - t0); return null;
  } catch (e) { log.error('viacep', 'ViaCEP', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

// ---------- NVD / CIRCL (CVE) ----------
export interface NvdCve { id: string; sourceIdentifier?: string; published?: string; lastModified?: string; vulnStatus?: string; descriptions?: { lang: string; value: string }[]; metrics?: { cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string; vectorString: string }; exploitabilityScore?: number; impactScore?: number }[]; cvssMetricV2?: { cvssData: { baseScore: number }; exploitabilityScore?: number; impactScore?: number }[] }; weaknesses?: { description: { lang: string; value: string }[] }[]; references?: { url: string; source?: string }[]; configurations?: { nodes?: { cpeMatch?: { vulnerable: boolean; criteria: string }[] }[] }[]; }
export interface NvdResp {
  resultsPerPage?: number;
  totalResults?: number;
  /** formato historico */
  results?: { cve: NvdCve }[];
  /** formato atual (a partir de 2026) */
  vulnerabilities?: { cve: NvdCve }[];
}

/** O NVD usa `results` historicamente e `vulnerabilities` na API atual. Aceitar ambos. */
function nvdList(r: NvdResp): NvdCve[] {
  const arr = r.vulnerabilities ?? r.results ?? [];
  return arr.map((x) => x.cve).filter(Boolean);
}

export async function nvdCve(id: string, log: SourceLog): Promise<NvdCve | null> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(id)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<NvdResp>(url, { timeoutMs: 15_000 });
    const cve = nvdList(r)[0] ?? null;
    if (cve) log.ok('nvd', 'NVD (CVE detail)', url, Date.now() - t0, 1);
    else log.empty('nvd', 'NVD', url, Date.now() - t0, 'CVE nao encontrada na resposta');
    return cve;
  } catch (e) { log.error('nvd', 'NVD', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

export async function nvdSearch(keyword: string, resultsPerPage = 8, log: SourceLog): Promise<NvdCve[]> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=${resultsPerPage}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<NvdResp>(url, { timeoutMs: 15_000 });
    const list = nvdList(r);
    if (list.length) log.ok('nvd', 'NVD (pesquisa CVE)', url, Date.now() - t0, list.length);
    else log.empty('nvd', 'NVD', url, Date.now() - t0, 'sem resultados');
    return list;
  } catch (e) { log.error('nvd', 'NVD', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

// ---------- OSV (vulnerabilidades de pacotes) ----------
export interface OsvVuln { id: string; summary?: string; details?: string; published?: string; modified?: string; aliases?: string[]; severity?: { type: string; score: string }[]; database_specific?: { severity?: string }; references?: { type: string; url: string }[]; affected?: { package: { ecosystem: string; name: string }; ranges?: { type: string; events: { introduced?: string; fixed?: string }[] }[]; versions?: string[]; database_specific?: { severity?: string } }[]; }
export interface OsvQueryResp { vulns?: OsvVuln[] }
export async function osvQuery(ecosystem: string, name: string, version: string, log: SourceLog): Promise<OsvVuln[]> {
  const url = 'https://api.osv.dev/v1/query';
  const t0 = Date.now();
  try {
    const r = await apiGet(url, { method: 'POST', body: JSON.stringify({ package: { ecosystem, name }, version }) });
    const j = JSON.parse(r.body) as OsvQueryResp;
    const n = j.vulns?.length ?? 0;
    if (n) log.ok('osv', `OSV (${ecosystem})`, url, Date.now() - t0, n);
    else log.empty('osv', `OSV (${ecosystem})`, url, Date.now() - t0, 'sem vulnerabilidades conhecidas');
    return j.vulns ?? [];
  } catch (e) { log.error('osv', 'OSV', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

// ---------- Pwned Passwords (k-anonymity) ----------
export async function pwnedPasswords(password: string, log: SourceLog): Promise<number | null> {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const url = `https://api.pwnedpasswords.com/range/${prefix}`;
  const t0 = Date.now();
  try {
    const r = await apiGet(url, { headers: { 'user-agent': UA_FREE } });
    for (const line of r.body.split('\n')) {
      const [h, cnt] = line.trim().split(':');
      if (h && cnt && h.toUpperCase() === suffix) {
        log.ok('hibp-pw', 'Pwned Passwords (k-anonymity)', url, Date.now() - t0, 1, `${cnt} ocorrencias`);
        return Number(cnt);
      }
    }
    log.ok('hibp-pw', 'Pwned Passwords (k-anonymity)', url, Date.now() - t0, 0, '0 ocorrencias');
    return 0;
  } catch (e) { log.error('hibp-pw', 'Pwned Passwords', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

// ---------- Wayback ----------
export interface WaybackAvail { url: string; archived_snapshots: { closest?: { status: string; available: boolean; url: string; timestamp: string } }; }
export async function wayback(url: string, log: SourceLog): Promise<WaybackAvail | null> {
  const u = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<WaybackAvail>(u);
    if (r.archived_snapshots?.closest?.available) { log.ok('wayback', 'Wayback Machine', u, Date.now() - t0, 1); return r; }
    log.empty('wayback', 'Wayback Machine', u, Date.now() - t0, 'sem snapshot'); return r;
  } catch (e) { log.error('wayback', 'Wayback Machine', u, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

// ---------- Nominatim ----------
export interface NominatimPlace { place_id: number; osm_type: string; osm_id: number; lat: string; lon: string; display_name: string; class?: string; type?: string; }
export async function nominatim(q: string, log: SourceLog): Promise<NominatimPlace[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;
  const t0 = Date.now();
  try {
    const r = await apiJson<NominatimPlace[]>(url, { headers: { 'user-agent': 'ARGUS-OSINT/1.0' } });
    if (r.length) { log.ok('nominatim', 'OpenStreetMap/Nominatim', url, Date.now() - t0, r.length); return r; }
    log.empty('nominatim', 'Nominatim', url, Date.now() - t0); return [];
  } catch (e) { log.error('nominatim', 'Nominatim', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

export async function nominatimReverse(lat: number, lon: number, log: SourceLog): Promise<NominatimPlace | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
  const t0 = Date.now();
  try {
    const r = await apiJson<NominatimPlace>(url, { headers: { 'user-agent': 'ARGUS-OSINT/1.0' } });
    log.ok('nominatim', 'Nominatim (reverse)', url, Date.now() - t0, 1); return r;
  } catch (e) { log.error('nominatim', 'Nominatim (reverse)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return null; }
}

// ---------- Pesquisa web (Bing RSS) ----------
export interface WebHit { titulo: string; url: string; descricao?: string }

/**
 * Pesquisa web via Bing RSS.
 *
 * Porque Bing RSS e nao outros:
 *  - Bing RSS devolve ate 10 resultados reais em XML, sem chave e sem JS. Testado.
 *  - DuckDuckGo `html.duckduckgo.com/html` foi testado e hoje devolve apenas a casca
 *    da aplicacao (0 resultados). Nao e usado.
 *  - Scraping de Google/Bing HTML e contra os termos de servico. RSS e um interface
 *    publica e suportada.
 */
export async function bingRss(query: string, log: SourceLog, srcId = 'bing'): Promise<WebHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20`;
  const t0 = Date.now();
  try {
    const r = await apiGet(url, { timeoutMs: 12_000, maxBytes: 2_000_000 });
    if (r.status !== 200) { log.error(srcId, 'Bing RSS (pesquisa web)', url, `HTTP ${r.status}`, Date.now() - t0); return []; }
    const items: WebHit[] = [];
    for (const m of r.body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1]!;
      const t = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '';
      const u = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '';
      const d = /<description>([\s\S]*?)<\/description>/.exec(block)?.[1] ?? '';
      if (!u) continue;
      const clean = (s: string) => s
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, '').trim();
      items.push({ titulo: clean(t), url: clean(u), descricao: clean(d).slice(0, 300) });
    }
    if (items.length) { log.ok(srcId, 'Bing RSS (pesquisa web)', url, Date.now() - t0, items.length); return items; }
    log.empty(srcId, 'Bing RSS (pesquisa web)', url, Date.now() - t0, 'sem resultados');
    return [];
  } catch (e) { log.error(srcId, 'Bing RSS (pesquisa web)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}

// ---------- GitHub ----------
/**
 * `token` é o PAT do utilizador (BYOK `github-pat`). É opcional: a API pública
 * funciona sem chave, com limite de 60 pedidos/hora por IP. Com PAT o limite sobe
 * para 5000/hora — que é a razão de o ARGUS o aceitar.
 */
function ghAuth(token?: string): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token?.trim()) h.authorization = `Bearer ${token.trim()}`;
  return h;
}

export interface GhUser { login: string; id: number; name?: string; company?: string; blog?: string; location?: string; email?: string; bio?: string; twitter_username?: string; public_repos: number; public_gists: number; followers: number; following: number; created_at: string; updated_at: string; avatar_url?: string; html_url: string; type?: string; }
export interface GhRepo { name: string; full_name: string; html_url: string; description?: string; language?: string; stargazers_count: number; forks_count: number; created_at: string; updated_at: string; pushed_at: string; topics?: string[]; private: boolean; }
export async function ghUser(login: string, log: SourceLog, token?: string): Promise<GhUser | null> {
  const url = `https://api.github.com/users/${encodeURIComponent(login)}`;
  const t0 = Date.now();
  try {
    const r = await apiJson<GhUser>(url, { headers: ghAuth(token) });
    log.ok('github', 'GitHub API (perfil)', url, Date.now() - t0, 1, token ? 'consulta autenticada' : 'limite publico (60/hora por IP)');
    return r;
  } catch (e) {
    const m = String((e as Error).message);
    if (/404/.test(m)) { log.empty('github', 'GitHub API (perfil)', url, Date.now() - t0, 'utilizador inexistente'); return null; }
    if (/403/.test(m)) { log.error('github', 'GitHub API (perfil)', url, 'limite da API publica atingido — adicione um PAT (BYOK) para 5000/hora', Date.now() - t0); return null; }
    log.error('github', 'GitHub API (perfil)', url, m.slice(0, 70), Date.now() - t0);
    return null;
  }
}
export async function ghRepos(login: string, log: SourceLog, token?: string): Promise<GhRepo[]> {
  const url = `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`;
  const t0 = Date.now();
  try {
    const r = await apiJson<GhRepo[]>(url, { headers: ghAuth(token) });
    if (r.length) { log.ok('github-repos', 'GitHub API (repositorios)', url, Date.now() - t0, r.length); return r; }
    log.empty('github-repos', 'GitHub API (repositorios)', url, Date.now() - t0, 'nenhum repo publico'); return [];
  } catch (e) { log.error('github-repos', 'GitHub API (repos)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}
export interface GhEvent { id: string; type: string; created_at: string; repo?: { name: string }; actor?: { login: string }; payload?: Record<string, unknown>; }
export async function ghEvents(login: string, log: SourceLog, token?: string): Promise<GhEvent[]> {
  const url = `https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=30`;
  const t0 = Date.now();
  try {
    const r = await apiJson<GhEvent[]>(url, { headers: ghAuth(token) });
    if (r.length) { log.ok('github-events', 'GitHub API (atividade)', url, Date.now() - t0, r.length); return r; }
    log.empty('github-events', 'GitHub API (atividade)', url, Date.now() - t0); return [];
  } catch (e) { log.error('github-events', 'GitHub API (atividade)', url, String((e as Error).message).slice(0, 70), Date.now() - t0); return []; }
}
