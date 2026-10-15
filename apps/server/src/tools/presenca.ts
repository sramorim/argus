/**
 * Presença por cadastro — reimplementação em Node da ideia do socialscan
 * (github.com/iojw/socialscan, MIT): pergunta a cada plataforma, pelo mesmo
 * endpoint público que o formulário de registo usa, se um username ou e-mail
 * JÁ ESTÁ cadastrado ali. "Registado" quer dizer que existe uma conta com
 * aquele identificador — não diz de quem é, nem abre a conta.
 *
 * Só endpoints públicos e estáveis, sem login, sem chave e sem scraping:
 *   - E-mail:   Mozilla (contas Firefox) e Pinterest
 *   - Username: GitLab e Reddit
 *
 * Porque não Instagram/Twitter aqui: os endpoints de registo dessas redes
 * exigem um token de sessão por pedido e bloqueiam o IP de servidores de
 * datacenter em poucas tentativas — dariam "erro" quase sempre. A presença
 * pública nessas redes já é coberta pelo Localizador de Username, que lê a
 * própria página do perfil. Nada aqui é limitado a pago: é o que funciona de
 * graça sem violar os termos de ninguém.
 */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { safeFetch } from '../net/ssrf.ts';

export type EstadoCadastro = 'registado' | 'livre' | 'erro' | 'na';
export interface Veredito { estado: EstadoCadastro; detalhe: string; link?: string }

// --------------------------------------------------------- parsers (puros)

/** Mozilla/Firefox: POST account/status → {exists:boolean}. */
export function lerMozilla(status: number, corpo: string): Veredito {
  if (status !== 200) return { estado: 'erro', detalhe: `HTTP ${status}` };
  try {
    const j = JSON.parse(corpo) as { exists?: boolean; error?: number };
    if (j.error) return { estado: 'erro', detalhe: `recusado (erro ${j.error})` };
    return j.exists ? { estado: 'registado', detalhe: 'há conta Mozilla com este e-mail' } : { estado: 'livre', detalhe: 'sem conta Mozilla' };
  } catch { return { estado: 'erro', detalhe: 'resposta inesperada' }; }
}

/** Pinterest: resource_response.data === true quando o e-mail já existe. */
export function lerPinterest(status: number, corpo: string): Veredito {
  if (status !== 200) return { estado: 'erro', detalhe: `HTTP ${status}` };
  try {
    const j = JSON.parse(corpo) as { resource_response?: { data?: boolean } };
    const existe = j.resource_response?.data;
    if (typeof existe !== 'boolean') return { estado: 'erro', detalhe: 'resposta inesperada' };
    return existe ? { estado: 'registado', detalhe: 'há conta Pinterest com este e-mail' } : { estado: 'livre', detalhe: 'sem conta Pinterest' };
  } catch { return { estado: 'erro', detalhe: 'resposta inesperada' }; }
}

/** GitLab: GET /users/{u}/exists → {exists:boolean}; 401 também significa que existe. */
export function lerGitlab(status: number, corpo: string, username: string): Veredito {
  const link = `https://gitlab.com/${username}`;
  if (status === 401) return { estado: 'registado', detalhe: 'username em uso no GitLab', link };
  if (status !== 200) return { estado: 'erro', detalhe: `HTTP ${status}` };
  try {
    const j = JSON.parse(corpo) as { exists?: boolean };
    return j.exists ? { estado: 'registado', detalhe: 'username em uso no GitLab', link } : { estado: 'livre', detalhe: 'username livre no GitLab' };
  } catch { return { estado: 'erro', detalhe: 'resposta inesperada' }; }
}

/** Reddit: check_username.json → {} livre; json.errors[0] com "taken" = registado. */
const REDDIT_TAKEN = /already taken|taken by a deleted/i;
export function lerReddit(status: number, corpo: string, username: string): Veredito {
  if (status === 429) return { estado: 'erro', detalhe: 'Reddit limitou os pedidos (429)' };
  if (status !== 200) return { estado: 'erro', detalhe: `HTTP ${status}` };
  try {
    const j = JSON.parse(corpo) as { error?: number; json?: { errors?: [string, string][] } };
    if (j.error === 429) return { estado: 'erro', detalhe: 'Reddit limitou os pedidos (429)' };
    const msg = j.json?.errors?.[0]?.[1];
    if (!msg) return { estado: 'livre', detalhe: 'username livre no Reddit' };
    if (REDDIT_TAKEN.test(msg)) return { estado: 'registado', detalhe: 'username em uso no Reddit', link: `https://www.reddit.com/user/${username}` };
    return { estado: 'livre', detalhe: msg.slice(0, 80) };
  } catch { return { estado: 'erro', detalhe: 'resposta inesperada' }; }
}

const EMAIL_RE = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const USER_RE = /^[a-z0-9._-]{2,39}$/i;
const UA = 'Mozilla/5.0 (compatible; ARGOS-OSINT/1.0; +https://argos.senhoramorim.com.br)';

function linhaFinding(plataforma: string, v: Veredito, srcId: string): Finding {
  const conf = v.estado === 'registado' ? 'confirmed' : v.estado === 'livre' ? 'confirmed' : 'weak';
  const rotulo = v.estado === 'registado' ? 'cadastrado' : v.estado === 'livre' ? 'não cadastrado' : 'não verificado';
  return finding(v.estado === 'registado' ? 'cadastrado' : v.estado === 'livre' ? 'livre' : 'nao-verificado',
    plataforma, `${rotulo} — ${v.detalhe}`, [srcId], { confidence: conf, link: v.link });
}

registerTool({
  id: 'social-presence',
  name: 'Presença por Cadastro',
  category: 'pessoa',
  summary: 'Em quais plataformas um e-mail ou username já está cadastrado, pelos endpoints públicos de registo.',
  longDesc: 'Reimplementa a ideia do socialscan (MIT, open source): pergunta a cada plataforma, pelo mesmo endpoint público que o formulário de cadastro usa, se um e-mail ou username já está em uso. Diz "cadastrado", "livre" ou "não verificado" — nunca de quem é a conta, e sem abrir nada. E-mail: Mozilla e Pinterest. Username: GitLab e Reddit. Tudo grátis, sem chave e sem scraping. Para mais redes por username, use o Localizador de Username.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['email', 'username', 'cadastro', 'presença', 'socialscan', 'redes'],
  fields: [{ name: 'alvo', label: 'E-mail ou username', type: 'text', placeholder: 'ex: nome@email.com ou @username', required: true }],
  async run(input) {
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];
    const bruto = String(input.alvo ?? '').trim();
    const ehEmail = bruto.includes('@') && bruto.indexOf('@') > 0;

    if (ehEmail) {
      const email = bruto.toLowerCase();
      if (!EMAIL_RE.test(email)) {
        log.local(0, 'e-mail inválido');
        out.push(finding('validacao', 'E-mail', `formato inválido: "${email.slice(0, 60)}"`, ['local'], { confidence: 'confirmed' }));
        return { findings: out, log, notes };
      }
      out.push(finding('resumo', 'E-mail', email, ['local'], { confidence: 'confirmed' }));
      const [moz, pin] = await Promise.all([
        (async (): Promise<Veredito> => {
          const url = 'https://api.accounts.firefox.com/v1/account/status';
          const t0 = Date.now();
          try {
            const r = await safeFetch(url, { method: 'POST', timeoutMs: 9000, maxBytes: 200_000, headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA }, body: JSON.stringify({ email }) });
            const v = lerMozilla(r.status, r.body);
            v.estado === 'erro' ? log.error('mozilla', 'Mozilla (contas Firefox)', url, v.detalhe, Date.now() - t0) : log.ok('mozilla', 'Mozilla (contas Firefox)', url, Date.now() - t0, v.estado === 'registado' ? 1 : 0);
            return v;
          } catch (e) { log.error('mozilla', 'Mozilla (contas Firefox)', url, String((e as Error).message), Date.now() - t0); return { estado: 'erro', detalhe: 'sem resposta' }; }
        })(),
        (async (): Promise<Veredito> => {
          const data = encodeURIComponent(`{"options": {"email": "${email}"}, "context": {}}`);
          const url = `https://www.pinterest.com/_ngjs/resource/EmailExistsResource/get/?source_url=/&data=${data}`;
          const t0 = Date.now();
          try {
            const r = await safeFetch(url, { timeoutMs: 9000, maxBytes: 300_000, headers: { accept: 'application/json', 'user-agent': UA } });
            const v = lerPinterest(r.status, r.body);
            v.estado === 'erro' ? log.error('pinterest', 'Pinterest (cadastro)', url, v.detalhe, Date.now() - t0) : log.ok('pinterest', 'Pinterest (cadastro)', url, Date.now() - t0, v.estado === 'registado' ? 1 : 0);
            return v;
          } catch (e) { log.error('pinterest', 'Pinterest (cadastro)', url, String((e as Error).message), Date.now() - t0); return { estado: 'erro', detalhe: 'sem resposta' }; }
        })(),
      ]);
      out.push(linhaFinding('Mozilla', moz, 'mozilla'));
      out.push(linhaFinding('Pinterest', pin, 'pinterest'));
      const reg = [['Mozilla', moz], ['Pinterest', pin]].filter(([, v]) => (v as Veredito).estado === 'registado').map(([n]) => n as string);
      out.push(finding('resumo', 'Cadastrado em', reg.length ? reg : 'nenhuma das plataformas verificadas', ['mozilla', 'pinterest'], { confidence: 'confirmed' }));
      notes.push('"Cadastrado" diz só que existe uma conta com este e-mail na plataforma — não diz de quem é, nem abre a conta.');
      notes.push('Para vazamentos deste e-mail, use a Busca de E-mail. Para perfis por nome de usuário, o Localizador de Username.');
      return { findings: out, log, notes };
    }

    // username
    const user = bruto.replace(/^@/, '').replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0]!;
    if (!USER_RE.test(user)) {
      log.local(0, 'username inválido');
      out.push(finding('validacao', 'Username', `inválido: "${user.slice(0, 40)}"`, ['local'], { confidence: 'confirmed' }));
      return { findings: out, log, notes };
    }
    out.push(finding('resumo', 'Username', `@${user}`, ['local'], { confidence: 'confirmed' }));
    const [gl, rd] = await Promise.all([
      (async (): Promise<Veredito> => {
        const url = `https://gitlab.com/users/${encodeURIComponent(user)}/exists`;
        const t0 = Date.now();
        try {
          const r = await safeFetch(url, { timeoutMs: 9000, maxBytes: 100_000, headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json', 'user-agent': UA } });
          const v = lerGitlab(r.status, r.body, user);
          v.estado === 'erro' ? log.error('gitlab', 'GitLab (cadastro)', url, v.detalhe, Date.now() - t0) : log.ok('gitlab', 'GitLab (cadastro)', url, Date.now() - t0, v.estado === 'registado' ? 1 : 0);
          return v;
        } catch (e) { log.error('gitlab', 'GitLab (cadastro)', url, String((e as Error).message), Date.now() - t0); return { estado: 'erro', detalhe: 'sem resposta' }; }
      })(),
      (async (): Promise<Veredito> => {
        const url = 'https://www.reddit.com/api/check_username.json';
        const t0 = Date.now();
        try {
          const r = await safeFetch(url, { method: 'POST', timeoutMs: 9000, maxBytes: 100_000, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': UA }, body: `user=${encodeURIComponent(user)}` });
          const v = lerReddit(r.status, r.body, user);
          v.estado === 'erro' ? log.error('reddit', 'Reddit (cadastro)', url, v.detalhe, Date.now() - t0) : log.ok('reddit', 'Reddit (cadastro)', url, Date.now() - t0, v.estado === 'registado' ? 1 : 0);
          return v;
        } catch (e) { log.error('reddit', 'Reddit (cadastro)', url, String((e as Error).message), Date.now() - t0); return { estado: 'erro', detalhe: 'sem resposta' }; }
      })(),
    ]);
    out.push(linhaFinding('GitLab', gl, 'gitlab'));
    out.push(linhaFinding('Reddit', rd, 'reddit'));
    // Mesmo formato "encontrado" que alimenta a grelha de perfis, quando há link.
    for (const [nome, v, src] of [['GitLab', gl, 'gitlab'], ['Reddit', rd, 'reddit']] as const) {
      if (v.estado === 'registado' && v.link) out.push(finding('encontrado', nome, { platform: nome, url: v.link, username: user }, [src], { confidence: 'corroborated', link: v.link }));
    }
    notes.push('"Cadastrado" diz só que o username está em uso na plataforma. Para checar muito mais redes por username, use o Localizador de Username.');
    return { findings: out, log, notes };
  },
});
