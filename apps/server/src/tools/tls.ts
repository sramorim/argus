/**
 * Auditoria de TLS: faz um handshake real com o alvo e lê o certificado.
 *
 * Porquê esta ferramenta: é a única da família de infraestrutura que não depende
 * de nenhuma API de terceiros. O dado vem de (a) uma ligação TLS ao próprio
 * alvo e (b) Nothing Else. Isso torna-a infalível, sem chave e sem quota — e
 * o handshake passa pelo mesmo guard anti-SSRF das restantes.
 *
 * A ligação é feita ao IP validado, com `servername` = hostname, para que a
 * validação do certificado continue a ser feita contra o nome pedido.
 */
import { connect, type TLSSocket, type PeerCertificate } from 'node:tls';
import net from 'node:net';
import { resolvePublicHost } from '../net/ssrf.ts';
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { certspotter } from '../net/sources.ts';
import { cachedSource } from '../net/cached-source.ts';

export interface TlsReport {
  protocol: string | null;
  cipher: string | null;
  authorized: boolean;
  authorizationError: string | null;
  subject: Record<string, string | string[]>;
  issuer: Record<string, string | string[]>;
  validFrom: string;
  validTo: string;
  daysLeft: number | null;
  serialNumber: string;
  fingerprint256: string;
  keyType: string;
  keyBits: number | null;
  san: string[];
  ocsp: string[];
  caIssuers: string[];
  alpn: string[];
  ipUsed: string;
  ms?: number;
}

function flat(v: unknown): Record<string, string | string[]> {
  const o = v as Record<string, string | string[]> | undefined;
  const out: Record<string, string | string[]> = {};
  for (const [k, val] of Object.entries(o ?? {})) out[k] = Array.isArray(val) ? val.join(' / ') : String(val);
  return out;
}

function first(v: string | string[] | undefined): string {
  if (!v) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

/** Handshake TLS com timeout. Nunca lança: devolve null com o motivo. */
export function tlsProbe(host: string, port: number, timeoutMs = 10_000): Promise<{ rep: TlsReport | null; error?: string }> {
  return new Promise((resolve) => {
    const done = (v: { rep: TlsReport | null; error?: string }) => resolve(v);
    let sock: TLSSocket | null = null;
    let finished = false;
    const finish = (v: { rep: TlsReport | null; error?: string }) => { if (!finished) { finished = true; try { sock?.destroy(); } catch {} done(v); } };

    const started = Date.now();
    (async () => {
      let ipUsed: string;
      try {
        const h = await resolvePublicHost(host);
        ipUsed = h.ips[0]!;
      } catch (e) { finish({ rep: null, error: `destino bloqueado: ${(e as Error).message}` }); return; }

      sock = connect({
        host: ipUsed,
        port,
        servername: net.isIP(host) ? undefined : host,
        timeout: timeoutMs,
        // Não rejeitamos certificado inválido: o objetivo é MOSTRAR que está
        // inválido (expirado, auto-assinado, nome diferente), não recusar.
        rejectUnauthorized: false,
      });
      sock.setTimeout(Math.max(500, timeoutMs - (Date.now() - started)));
      sock.once('secureConnect', () => {
        const c: PeerCertificate = sock!.getPeerCertificate(true);
        const authErr: string | null = ((sock as unknown as { authorizationError?: string }).authorizationError) ?? null;
        const validTo = c.valid_to ?? '';
        const daysLeft = validTo ? Math.round((new Date(validTo).getTime() - Date.now()) / 86_400_000) : null;
        const sanRaw = c.subjectaltname ?? '';
        const rep: TlsReport = {
          protocol: sock!.getProtocol() ?? null,
          cipher: sock!.getCipher()?.name ?? null,
          authorized: !!sock!.authorized,
          authorizationError: authErr,
          subject: flat(c.subject),
          issuer: flat(c.issuer),
          validFrom: c.valid_from ?? '',
          validTo,
          daysLeft,
          serialNumber: c.serialNumber ?? '',
          fingerprint256: c.fingerprint256 ?? '',
          keyType: c.asn1Curve ?? (c.bits ? `rsa-${c.bits}` : 'desconhecida'),
          keyBits: typeof c.bits === 'number' ? c.bits : null,
          san: sanRaw.split(',').map((s) => s.trim().replace(/^DNS:/i, '')).filter(Boolean),
          ocsp: readOcsp(c),
          caIssuers: readIssuerCn(c),
          alpn: sock!.alpnProtocol ? [sock!.alpnProtocol] : [],
          ipUsed,
          ms: Date.now() - started,
        };
        finish({ rep });
      });
      sock.once('timeout', () => finish({ rep: null, error: 'timeout do handshake' }));
      sock.once('error', (e) => finish({ rep: null, error: e.message.slice(0, 80) }));
    })();
  });
}

/** Campos que existem no certificado real mas não no tipo do @types/node. */
function extra(c: PeerCertificate): Record<string, unknown> {
  return c as unknown as Record<string, unknown>;
}
function readOcsp(c: PeerCertificate): string[] {
  const v = extra(c)['OCSP'];
  return Array.isArray(v) ? v.map((o) => String((o as { uri?: string })?.uri ?? '')).filter(Boolean) : [];
}
function readIssuerCn(c: PeerCertificate): string[] {
  const v = extra(c)['issuerCertificate'] as { subject?: unknown } | undefined;
  return v ? [first(flat(v.subject).CN as string)].filter(Boolean) : [];
}

const PROTO_RANK: Record<string, number> = { 'TLSv1.3': 3, 'TLSv1.2': 2, 'TLSv1.1': 1, 'TLSv1': 0 };

registerTool({
  id: 'tls-audit',
  name: 'Auditoria TLS / Certificado',
  category: 'infra',
  summary: 'Handshake TLS real ao alvo: protocolo, cifra, cadeia, validade, SANs e dias que faltam para expirar.',
  longDesc: 'Abre uma ligação TLS ao alvo (passando pelo mesmo bloqueio anti-SSRF das restantes ferramentas) e lê o certificado que ele apresenta: protocolo negociado, cifra, chave pública, emissor, datas de validade, dias restantes, SANs e fingerprint SHA-256. Cruza os SANs com o Certificate Transparency (CertSpotter) para saber se o certificado foi emitido publicamente. Nenhum dado vem de inventário de terceiros: é o próprio servidor a apresentá-lo.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'none',
  tags: ['tls', 'ssl', 'certificado', 'x509', 'seguranca'],
  fields: [
    { name: 'host', label: 'Dominio ou IP', type: 'text', placeholder: 'github.com', required: true, hint: 'Porta 443 por omissão' },
    { name: 'port', label: 'Porta', type: 'text', placeholder: '443', required: false, hint: 'Opcional. Por omissão 443.' },
  ],
  async run(input) {
    const host = String(input.host ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const portRaw = String(input.port ?? '').trim();
    const port = portRaw ? Number(portRaw) : 443;
    const log = new SourceLog();
    const out: Finding[] = [];

    if (!host) return { findings: [finding('validacao', 'Alvo', 'vazio', [], { confidence: 'weak' })], log };
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      log.error('tls', 'Porta', portRaw, 'porta invalida');
      return { findings: [finding('validacao', 'Porta', `${portRaw} nao e valida (1-65535)`, [], { confidence: 'confirmed' })], log };
    }

    const { rep, error } = await tlsProbe(host, port);
    if (!rep) {
      log.error('tls', `Handshake TLS ${host}:${port}`, `tls://${host}:${port}`, error ?? 'falhou');
      out.push(finding('alvo', 'Alvo tentado', `${host}:${port}`, ['tls'], { kind: 'fact', confidence: 'confirmed' }));
      out.push(finding('conclusao', 'Handshake falhou',
        `Nao foi possivel completar o handshake TLS com ${host}:${port}. ${error ?? ''}`.trim(), ['tls'],
        { kind: 'inference', confidence: 'confirmed' }));
      return { findings: out, log };
    }

    const conf = rep.authorized ? 'confirmed' as const : 'corroborated' as const;
    // A fonte entra na matriz: os achados citam `tls` e um achado que cita uma
    // fonte ausente da matriz parece inventado.
    log.ok('tls', `Handshake TLS ${host}:${port}`, `tls://${host}:${port}`, rep.ms ?? 0, 1,
      `${rep.protocol} · ${rep.cipher}${rep.authorized ? '' : ' · cadeia NAO validada'}`);
    out.push(finding('alvo', 'Alvo', `${host}:${port}`, ['tls'], { confidence: 'confirmed' }));
    out.push(finding('tls', 'Protocolo negociado', rep.protocol ?? 'desconhecido', ['tls'], { confidence: 'confirmed' }));
    out.push(finding('tls', 'Cifra', rep.cipher ?? 'desconhecida', ['tls']));
    if (rep.alpn.length) out.push(finding('tls', 'ALPN', rep.alpn, ['tls']));
    out.push(finding('certificado', 'Valido para (CN)', first(rep.subject.CN) || '—', ['tls'], { confidence: conf }));
    if (rep.san.length) out.push(finding('certificado', 'Nomes alternativos (SAN)', rep.san, ['tls'], { confidence: conf }));
    out.push(finding('certificado', 'Emissor', `${first(rep.issuer.CN) || '—'}${first(rep.issuer.O) ? ` (${first(rep.issuer.O)})` : ''}`, ['tls']));
    if (rep.caIssuers.length) out.push(finding('certificado', 'Cadeia (AC intermedia)', rep.caIssuers, ['tls'], { kind: 'inference' }));
    out.push(finding('certificado', 'Valido de', rep.validFrom, ['tls']));
    out.push(finding('certificado', 'Valido ate', rep.validTo, ['tls']));
    if (rep.daysLeft !== null) {
      out.push(finding('certificado', 'Dias que faltam para expirar', String(rep.daysLeft), ['tls'], { kind: 'fact', confidence: 'confirmed' }));
    }
    out.push(finding('certificado', 'Chave publica', `${rep.keyType}${rep.keyBits ? ` ${rep.keyBits} bits` : ''}`, ['tls']));
    if (rep.fingerprint256) out.push(finding('certificado', 'SHA-256 (do certificado apresentado)', rep.fingerprint256, ['tls'], { kind: 'fact' }));
    if (rep.serialNumber) out.push(finding('certificado', 'Numero de serie', rep.serialNumber, ['tls']));

    // Julgamento de validade: isto é cálculo local sobre o que o servidor disse.
    const problemas: string[] = [];
    if (!rep.authorized) problemas.push('a cadeia nao validou (' + (rep.authorizationError ?? 'motivo desconhecido') + ')');
    if (rep.daysLeft !== null && rep.daysLeft < 0) problemas.push('certificado EXPIRADO ha ' + Math.abs(rep.daysLeft) + ' dias');
    else if (rep.daysLeft !== null && rep.daysLeft < 15) problemas.push('expira em ' + rep.daysLeft + ' dias');
    const protoRank = PROTO_RANK[rep.protocol ?? ''] ?? -1;
    if (protoRank >= 0 && protoRank < 2) problemas.push('protocolo antiquado (' + rep.protocol + ')');
    if (rep.keyBits && rep.keyBits < 2048) problemas.push('chave curta (' + rep.keyBits + ' bits)');
    if (problemas.length) {
      out.push(finding('seguranca', 'Problemas detetados', problemas, ['tls'], { kind: 'inference', confidence: 'corroborated' }));
    } else {
      out.push(finding('seguranca', 'Problemas detetados', 'nenhum', ['tls'], { kind: 'inference', confidence: 'corroborated' }));
    }

    // Correlação com Certificate Transparency: os nomes do SAN devem aparecer
    // nos logs públicos de emissão. Se não aparecem, o certificado é recente,
    // auto-emitido, ou emitido por uma CA que não publica.
    const sanHost = rep.san.find((s) => !s.includes('*')) ?? first(rep.subject.CN) ?? host;
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(sanHost) && !sanHost.includes('*')) {
      const cs = await cachedSource({ log, srcId: 'certspotter', label: 'CertSpotter (Certificate Transparency)', url: 'api.certspotter.com', key: `cs:${sanHost}`, ttl: 6 * 3600, count: false }, () => certspotter(sanHost, log));
      const encontrados = cs.filter((c) => c.dns_names?.some((d) => rep.san.includes(d) || d === sanHost));
      if (cs.length) {
        out.push(finding('transparencia', 'Emissoes em Certificate Transparency',
          `${encontrados.length} de ${cs.length} emissoes publicas incluem este nome`,
          ['certspotter'], { kind: 'inference', confidence: 'corroborated' }));
      } else {
        log.empty('certspotter', 'CertSpotter', `api.certspotter.com (${sanHost})`, 0, 'sem emissoes publicas com este nome');
      }
    }

    log.local(out.length, 'Leitura do certificado apresentado pelo servidor + calculo de validade');
    const notas = ['O certificado apresentado e o que o servidor devolveu agora: pode mudar a qualquer momento.'];
    if (!rep.authorized) notas.push('A cadeia NAO validou — o browser mostraria um aviso. Leia o motivo em "Problemas detetados".');
    return { findings: out, log, notes: notas };
  },
});
