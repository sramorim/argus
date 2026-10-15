/**
 * Testes das buscas de contacto (sem rede): telefone, e-mail e Telegram.
 *   node test/contato.test.ts
 *
 * O que se protege: a leitura local do número (país, DDD, tipo de linha), a
 * recusa de entradas inválidas sem sair para a rede, e o parser da página
 * pública t.me — que tem de separar "existe" de "não existe" pelo bloco do
 * título, e não por o pedido ter dado 200 (dá sempre).
 */
import { getTool } from '../src/registry.ts';
import { lerTelefone, factosTelefone, lerPaginaTelegram } from '../src/tools/contato.ts';
import { TOOL_LOCKS } from '../src/plans.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}
const CTX = { userId: 't', plan: 'free' as const };

// ----------------------------------------------------------------- telefone
{
  const p = lerTelefone('(47) 99787-6098');
  ok(!!p, 'número brasileiro sem +55 é lido como Brasil');
  const f = factosTelefone(p!);
  ok(f.pais === 'BR' && f.codigoPais === '+55', 'país BR (+55)', JSON.stringify(f));
  ok(f.ddd === '47' && f.uf === 'SC', 'DDD 47 → SC', `${f.ddd} ${f.uf}`);
  ok(f.tipo === 'Móvel', 'celular com 9 é móvel', f.tipo);
  ok(f.e164 === '+5547997876098', 'formato E.164', f.e164);
  ok(f.valido, 'número válido');

  const sp = factosTelefone(lerTelefone('+55 11 3333-4444')!);
  ok(sp.uf === 'SP' && sp.tipo === 'Fixo', 'fixo de São Paulo', `${sp.uf} ${sp.tipo}`);
  const pt = factosTelefone(lerTelefone('+351 912 345 678')!);
  ok(pt.pais === 'PT' && pt.ddd === null, 'número de Portugal não ganha DDD brasileiro', JSON.stringify(pt));

  const r = await getTool('phone-intel')!.run({ phone: 'abc' }, CTX);
  ok(r.findings.some((x) => x.group === 'validacao'), 'texto que não é número é recusado sem rede');
  ok(!r.log.sources.some((s) => s.id.startsWith('web')), 'número inválido não chega a pesquisar na web');
}

// ------------------------------------------------------------------- e-mail
{
  const r = await getTool('email-intel')!.run({ email: 'isto-nao-e-email' }, CTX);
  ok(r.findings.some((x) => x.group === 'validacao'), 'e-mail mal formado é recusado sem rede');
  ok(r.log.sources.every((s) => s.id === 'local'), 'e-mail inválido não sai para a rede');
}

// ----------------------------------------------------------------- telegram
{
  const canal = `<html><head><meta property="og:title" content="Durov's Channel"></head><body>
    <div class="tgme_page_photo"><img class="tgme_page_photo_image" src="https://cdn4.telesco.pe/file/x.jpg"></div>
    <div class="tgme_page_title" dir="auto"><span dir="auto">Durov&#39;s Channel</span></div>
    <div class="tgme_page_extra">1 234 567 subscribers</div>
    <div class="tgme_page_description" dir="auto">Thoughts of the founder<br/>of Telegram</div></body></html>`;
  const c = lerPaginaTelegram(canal, 'durov');
  ok(c.existe && c.tipo === 'canal', 'canal público reconhecido', JSON.stringify(c));
  ok(c.nome === "Durov's Channel", 'nome com entidade HTML descodificada', String(c.nome));
  ok(c.membros === '1234567', 'inscritos sem espaços', String(c.membros));
  ok(c.descricao === 'Thoughts of the founder\nof Telegram', 'descrição com quebra de linha', JSON.stringify(c.descricao));
  ok(c.foto === 'https://cdn4.telesco.pe/file/x.jpg', 'foto do perfil');

  const grupo = lerPaginaTelegram('<div class="tgme_page_title"><span>Grupo X</span></div><div class="tgme_page_extra">532 members, 20 online</div>', 'grupox');
  ok(grupo.tipo === 'grupo' && grupo.membros === '532', 'grupo com membros', JSON.stringify(grupo));

  const bot = lerPaginaTelegram('<div class="tgme_page_title"><span>Ajuda</span></div><div class="tgme_page_extra">@ajuda_bot</div>', 'ajuda_bot');
  ok(bot.tipo === 'bot', 'username terminado em bot é bot');

  const inexistente = lerPaginaTelegram(`<html><head><meta property="og:title" content="Telegram: Contact @zzz_nao_existe">
    </head><body><div class="tgme_page_description">If you have <strong>Telegram</strong>, you can contact <a>@zzz_nao_existe</a> right away.</div></body></html>`, 'zzz_nao_existe');
  ok(!inexistente.existe, 'página genérica sem título = conta não existe', JSON.stringify(inexistente));

  const r = await getTool('telegram-intel')!.run({ username: 'a b' }, CTX);
  ok(r.findings.some((x) => x.group === 'validacao'), 'username inválido é recusado sem rede');
}

// --------------------------------------------------------------- catálogo
for (const id of ['phone-intel', 'email-intel', 'telegram-intel']) {
  ok(!!getTool(id), `${id} está registado`);
  ok(TOOL_LOCKS[id] === 'free', `${id} é Free`, String(TOOL_LOCKS[id]));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
