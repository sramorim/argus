/**
 * Testa o higienizador do reporter de erros.
 *
 * O que se garante: nenhum dado sensível sai do processo para o Sentry. Se o
 * `limpar()` deixar passar um e-mail, um token ou um cookie de sessão, este
 * teste falha — porque numa ferramenta OSINT o corpo de um erro pode conter o
 * próprio alvo da investigação.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limpar } from '../src/observability.ts';

test('remove e-mails', () => {
  const r = limpar('falha ao processar alvo@exemplo.com no passo 3');
  assert.ok(!r.includes('alvo@exemplo.com'), 'e-mail vazou');
  assert.match(r, /\[EMAIL\]/);
});

test('remove tokens Bearer e chaves de API', () => {
  assert.ok(!limpar('authorization: Bearer abc.def.ghi123456').includes('abc.def.ghi'), 'Bearer vazou');
  assert.ok(!limpar('apify_api_0123456789ABCDEFghij').includes('apify_api_0123456789'), 'token Apify vazou');
  assert.ok(!limpar('key sk-ABCDEFGHIJ0123456789').includes('sk-ABCDEFGHIJ'), 'chave sk- vazou');
});

test('remove JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiITESTE.eyJzdWIiOiIxMjM0NTYTESTE.SflKxwRTESTEsig';
  assert.ok(!limpar(`token=${jwt}`).includes('eyJhbGci'), 'JWT vazou');
});

test('remove o cookie de sessão do ARGOS', () => {
  const r = limpar('cookie: __Host-argus_session=abcdef123456; outra=coisa');
  assert.ok(!r.includes('abcdef123456'), 'valor do cookie vazou');
  assert.match(r, /argus_session=\[REMOVIDO\]/);
});

test('remove segredos nomeados por variável de ambiente', () => {
  assert.ok(!limpar('ARGUS_SECRET=deadbeefcafebabe0123').includes('deadbeefcafebabe'), 'ARGUS_SECRET vazou');
  assert.ok(!limpar('PIX_KEY=minha-chave-pix-real').includes('minha-chave-pix-real'), 'PIX_KEY vazou');
});

test('não destrói texto inócuo', () => {
  const msg = 'TypeError: cannot read property x of undefined na linha 42';
  assert.equal(limpar(msg), msg, 'texto normal não devia ser alterado');
});

test('string vazia continua vazia', () => {
  assert.equal(limpar(''), '');
});
