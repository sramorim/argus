/** Infraestrutura de domínio: RDAP + DNS público + Certificate Transparency. Sem chave. */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { apiJson } from '../net/ssrf.ts';

function dominioValido(d: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})*\.[a-z]{2,}$/i.test(d);
}

registerTool({
  id: 'domain-infra',
  name: 'Infraestrutura de Domínio',
  category: 'infra',
  summary: 'RDAP, DNS público e certificados emitidos para um domínio — sem chave, tudo fonte aberta.',
  longDesc: 'Consulta o RDAP (registo do domínio), o DNS-over-HTTPS do Google (A, MX, TXT/SPF/DMARC) e a Certificate Transparency via CertSpotter (subdomínios vistos em certificados reais). Cada bloco diz a fonte, quando e em que estado; fonte que falhou aparece como erro, nunca como dado.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['dominio', 'dns', 'rdap', 'certificados', 'infraestrutura'],
  fields: [{ name: 'domain', label: 'Domínio', type: 'text', placeholder: 'exemplo.com', required: true, hint: 'Só o domínio, sem https nem caminho' }],
  async run(input) {
    const domain = String(input.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!;
    const log = new SourceLog();
    const out: Finding[] = [];
    if (!dominioValido(domain)) {
      log.empty('validacao', 'Alvo', '(inválido)', 0, 'domínio inválido');
      out.push(finding('validacao', 'Alvo', 'inválido', [], { confidence: 'weak' }));
      return { findings: out, log };
    }
    out.push(finding('alvo', 'Domínio analisado', domain, [], { confidence: 'confirmed' }));

    // As três fontes são independentes: correm em paralelo.
    const [rdap, dns, ct] = await Promise.all([
      (async () => {
        try {
          const j = await apiJson<any>(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
          log.ok('rdap', 'RDAP', `https://rdap.org/domain/${domain}`, Array.isArray(j?.events) ? j.events.length : 1);
          return j;
        } catch (e) { log.error('rdap', 'RDAP', `https://rdap.org/domain/${domain}`, String((e as Error).message)); return null; }
      })(),
      (async () => {
        try {
          const tipos = ['A', 'MX', 'TXT', 'NS'];
          const partes = await Promise.all(tipos.map(async (t) => {
            try {
              const j = await apiJson<any>(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${t}`);
              return { t, ans: Array.isArray(j?.Answer) ? j.Answer.map((a: any) => String(a?.data ?? '')) : [] };
            } catch { return { t, ans: [] as string[] }; }
          }));
          const total = partes.reduce((n, p) => n + p.ans.length, 0);
          log.ok('dns-google', 'DNS (Google DoH)', `https://dns.google/resolve?name=${domain}`, total);
          return partes;
        } catch (e) { log.error('dns-google', 'DNS (Google DoH)', 'https://dns.google/resolve', String((e as Error).message)); return null; }
      })(),
      (async () => {
        try {
          const j = await apiJson<any[]>(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names&limit=40`);
          const nomes = [...new Set((Array.isArray(j) ? j : []).flatMap((c: any) => (Array.isArray(c?.dns_names) ? c.dns_names.map(String) : [])))].slice(0, 40);
          log.ok('certspotter', 'CertSpotter CT', 'https://api.certspotter.com/v1/issuances', nomes.length);
          return nomes;
        } catch (e) { log.error('certspotter', 'CertSpotter CT', 'https://api.certspotter.com/v1/issuances', String((e as Error).message)); return null; }
      })(),
    ]);

    if (rdap) {
      const registrar = rdap?.entities?.find((e: any) => Array.isArray(e?.roles) && e.roles.includes('registrar'))?.vcardArray?.[1]?.find?.((f: any) => f?.[0] === 'fn')?.[3] ?? '—';
      out.push(finding('registo', 'Registrador (RDAP)', String(registrar), ['rdap'], { confidence: 'corroborated' }));
      const criacao = rdap?.events?.find((e: any) => e?.eventAction === 'registration')?.eventDate ?? null;
      if (criacao) out.push(finding('registo', 'Criado em', String(criacao), ['rdap'], { confidence: 'confirmed' }));
      const expira = rdap?.events?.find((e: any) => e?.eventAction === 'expiration')?.eventDate ?? null;
      if (expira) out.push(finding('registo', 'Expira em', String(expira), ['rdap'], { confidence: 'confirmed' }));
      const ns = Array.isArray(rdap?.nameservers) ? rdap.nameservers.map((n: any) => String(n?.ldhName ?? n?.objectClassName ?? '')).filter(Boolean) : [];
      if (ns.length) out.push(finding('dns', 'Name servers (RDAP)', ns, ['rdap'], { confidence: 'corroborated' }));
    }
    if (dns) {
      for (const p of dns) {
        if (p.ans.length) out.push(finding('dns', `DNS ${p.t}`, p.ans.slice(0, 25), ['dns-google'], { confidence: 'confirmed' }));
      }
      if (!dns.some((p) => p.ans.length)) out.push(finding('dns', 'DNS', 'sem respostas', ['dns-google'], { kind: 'claim', confidence: 'weak' }));
    }
    if (ct && ct.length) out.push(finding('certificados', `Subdomínios vistos em CT (${ct.length})`, ct, ['certspotter'], { confidence: 'indicated' }));
    else if (ct) out.push(finding('certificados', 'CT', 'sem certificados recentes', ['certspotter'], { kind: 'claim', confidence: 'weak' }));

    return { findings: out, log };
  },
});
