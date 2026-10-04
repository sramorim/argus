# ARGUS — CHECKPOINT

**Data:** 2026-10-04 · **Estado:** verde · **Fase:** créditos e Pix fechados, pronto a deploy
**Repositório:** https://github.com/sramorim/argus (código na raiz) · **Guia:** `COMO-POR-ONLINE.md`
**Detalhe máquina-legível:** `ARGUS-STATE.json` (`fase` ainda descreve a reconstrução de interface)
**Conclusão:** `CONCLUSAO-ARGUS.md` · **Contexto completo:** `CONTEXTO-ARGUS.md`

---

## Reconstrução da interface

Feita a partir da referência OSINT-UI, com implementação e identidade próprias:

- **Sistema visual novo**: azul profissional (`#07111F` / `#0D1B2A` / `#1677FF`),
  sem verde Matrix, sem neon, sem gamer. Superfícies quase neutras com tom azul
  muito baixo, para o azul ter peso sem a interface ficar toda azul.
- **Sidebar por camadas**: 7 grupos expansíveis, com o grupo da ferramenta aberta
  sempre marcado. Nada de lista de 26 botões.
- **Painel como primeiro ecrã**: "Nova investigação" em grande, cota real, sessões
  recentes, atalhos e as ferramentas **agrupadas** (nunca 26 cartões soltos).
- **Páginas de ferramenta** com a ordem: título → o que faz → limitações → campo →
  analisar → resultados → matriz de fontes.
- **Rodapé SR. Amorim** em todas as páginas.
- **`ia.ts` é a fonte única** da organização: sidebar, painel e busca leem dela,
  por isso não podem discordar entre si.

**Organização final** (só o que existe e funciona — 26 ferramentas):

| Grupo | N.º | Ferramentas |
|---|---|---|
| Investigação | 1 | Investigação (Grafo) |
| Identidade | 4 | Username · E-mail · Telefone · Dorks |
| Redes e Comunicação | 2 | GitHub · Telegram |
| Web e Ficheiros | 4 | URL · Crawler · Metadata · Imagem |
| Domínio e Infraestrutura | 5 | Domínio · IP · TLS · Portas · ASN |
| Segurança | 6 | Reputação · Hash · CVE · Pacotes · Password · Exposição |
| Fontes Especiais | 4 | Crypto · Geo · CEP · Empresa |

> Instagram, TikTok, X, Reddit, YouTube e **Leak Check** não são ferramentas do ARGUS
> e não aparecem na navegação nem na landing. A `leak-check` saiu do catálogo por não
> entregar nada sem chave BYOK. Não se promete o que não existe.

Também se corrigiu o **número de WhatsApp**, que estava escrito à mão no frontend e
com um dígito em falta. Passou a vir do servidor e a ser validado no arranque: um
número de 8 dígitos a começar por 9 é recusado como "celular com um dígito em falta".

---

## Onde ficou

O projeto **não foi reiniciado nem recriado**. Nenhuma peça de trabalho anterior foi
desfeita.

O checkpoint anterior (2026-09-29 22:11) estava **desatualizado**: registava 26
ferramentas, 61 testes e um painel de administração por fazer, mas o código já tinha o
painel de administração construído, o `render.yaml`, o `.env.example`, o logo, os
ícones, o `site.webmanifest`, a capa social e 79 testes unitários. A primeira coisa
desta sessão foi verificar o código real em vez de acreditar no registo — e a diferença
era grande.

## O que foi feito nesta sessão

1. **Verificação completa do estado real.** `npm test` (79 + 16), `npm run test:api`
   (48), `npm run test:prod` (15), `npm run typecheck`, `npm run build`,
   `npm run test:audit` (49 casos com alvos reais) e uma sessão manual ponta a ponta
   contra um servidor real. Detalhe em `CONCLUSAO-ARGUS.md`.

2. **Dez defeitos reais corrigidos**, dos quais **cinco eram suficientes para
   impedir o deploy**:
   - o `render.yaml` declarava `rootDir: probe`, herdado do layout antigo, e o
     Render recusava criar o serviço com *"Root directory 'probe' does not exist"*;
   - o `ToastHost` nunca era montado e **todos os avisos da aplicação estavam mudos**;
   - `@types/jpeg-js@^0.4.1` não existe no registo, por isso **o `npm ci` do Render
     falhava** e o serviço nunca subia;
   - o `render.yaml` punha `NODE_ENV=production`, o que faz o `npm ci` **omitir as
     devDependencies** — sem vite nem typescript o build morria (verificado: 9 pacotes
     em vez de 98);
   - os `.db` **não estavam no `.gitignore`** e um `git add .` punha contas, hashes de
     senha e chaves BYOK no histórico do Git.
   Os outros cinco: arranque dependente de uma flag experimental que já não é precisa,
   menu de telemóvel preso ao último render, capa social de formato errado e com URL
   relativa, botão de plano que confirmava um pedido inexistente, e quatro defeitos
   menores (comentário corrompido, chave de erro errada no formulário,
   duas classes de CSS inexistentes, tempo dos feeds reportado como 1 ms).

3. **Testes de interface novos** (`apps/web/test/`) — 14 verificações, das quais 3 com
   **DOM real** montado por `linkedom`. Foi o que apanhou o bug dos avisos: nenhum
   teste de backend o veria, porque o servidor estava perfeito. O teste de regressão
   foi validado à partida e ao contrário (revertendo o conserto, o teste falha).

4. **Reynield de ícones**: `scripts/make-icons.mjs` passou a gerar também a capa social
   1200×630 com o logótipo "ARGUS" desenhado em traço. Os ícones antigos eram
   512×512 — as plataformas cortam a 1.91:1 e a partilha do link saía minúscula.

5. **`typecheck` de 5 minutos para segundos.** No Termux, `tsc` é limitado por I/O (2m33s de
   relógio para 31s de CPU). `scripts/typecheck.mjs` corre as duas workspaces em
   paralelo e com cache incremental. Exit code 1 em erro, verificado. A 2.ª passagem
   é de 6 s.

6. **Smoke test de produção** passou de ~290 s para ~155 s: deixou de fazer uma
   investigação com grafo contra a rede (agora usa `phone-analyzer`, que é cálculo
   local) e passou a ser determinístico.

7. **Código morto removido**: quatro scripts de depuração de sessões antigas e um
   rascunho de teste. Criado `probe/.gitignore`.

## Créditos, Pix e recarga — fechado nesta sessão

O trabalho estava feito mas **por fechar**: o `definirLimite()` do servidor não
tinha rota que o chamasse (código morto), e o caminho do 402 não tinha teste. O
que esta sessão fez foi fechar isso, sem mexer no que já funcionava.

**O modelo, tal como está implementado:**

| | Chave partilhada do ARGUS | Chave própria da pessoa |
|---|---|---|
| Quem paga | o dono do serviço | a própria pessoa, na DataLikers |
| Tecto mensal | 200 (PRO) · 1000 (PRO Max) · 0 (Free) | o do plano dela lá — **o nosso não se aplica** |
| Onde se guarda | só no ambiente do servidor | cifrada em disco (AES-256-GCM), nunca devolvida |
| Como se ativa | Pix + recarga **escrita à mão** pelo admin | colar a chave em Conta › Gerenciar limites |

Regras que valem a pena knowing porque são contra-intuitivas:

1. **A chave própria é preferida, não alternativa.** Quem traz a chave não gasta
   o crédito partilhado com mais ninguém — por isso não tem tecto nosso. Se
   tivesse, a pessoa estaria a pagar duas vezes pelo mesmo pedido.
2. **Só se conta o que saiu.** O crédito é debitado depois do pedido ao
   fornecedor, nunca antes: validação local e recurso inválido não custam nada.
3. **A chave nunca sai do servidor.** Nem em resposta, nem em log, nem em URL.
   A validação é um pedido ao healthcheck do gateway com a chave em questão, e
   a resposta é só "aceitou" ou "recusou".
4. **A chave Pix vem do ambiente (`PIX_KEY`)**, nunca escrita no bundle. Trocar
   a chave é mudar uma variável, não um deploy.

**O que foi acrescentado agora:**

- `POST /api/admin/user/:id/limite` — a recarga que não tem gateway de pagamento.
  `null` volta ao limite do plano, que é o botão de desfazer: um limite
  escrito à mão e esquecido é um cliente que nunca mais bate no tecto.
  Só aceita número inteiro de 0 a 100000: `Number()` aceitaria `true` como 1 e
  `[]` como 0, e um limite de zero chegado por um booleano é uma pessoa
  trancada sem nenhum pedido visível.
- `creditos.limiteDefinido()` — distingue "o limite é 200 porque é o que o PRO
  dá" de "o limite é 200 porque o admin o pôs". Sem isto o painel mostrava um
  número e não dizia se mexer nele mudava alguma coisa.
- O mesmo controlo no **painel de administração**, ao lado do "uso do mês" de
  cada pessoa: aparece só quando o limite não é o do plano, para não encher a
  tabela com um campo por conta que nunca precisou dele.
- **Testes**: a escrita do limite pela pessoa errada é recusada (403), um valor
  que não é número não entra (400) e não altera o estado, `null` volta ao
  plano, e a conta inexistente dá 404. No `datalikers.test.ts` ficou provado
  que, com o tecto no chão, a execução **morre antes de sair** para o
  fornecedor — se saísse, o teste-passaria por um 401 do gateway em vez de
  lançar o erro de créditos, e é essa a distinção que interessa.

O pagamento continua a ser o que era: **Pix por fora, ativação por dentro**.
Nenhum cartão passa pelo site e nenhum valor é inventado.

## Estado verificado

| Verificação | Resultado |
|---|---|
| `npm test` | segurança 74 · username-intel 10 · osint-engine 63 · apify 42 · datalikers 65 · parsers 36 · intel 101 · planos 156 · pdf 65 = **612/612** |
| `npm run test:api` | **70/70** |
| `npm run test` (web) | **43/43** |
| `npm run test:prod` | **15/15** |
| `npm run test:audit` | **49/49**, 26/26 ferramentas · mediana 375 ms · máx 31,9 s |
| `npm run typecheck` | server ok · web ok |
| `npm run build` | ok → `apps/web/dist` (189 kB gzip no total) |
| `npm ci` | ok de raiz; **98 pacotes** com `NODE_ENV=production --include=dev` (sem o `--include=dev` seriam 9 e o build do Render falharia) |
| **Total** | **740 verificações** |

Comandos: `npm test` · `npm run test:api` · `npm run test:prod` · `npm run typecheck` ·
`npm run build` · `npm run test:audit` · `npm run icons` · `./run.sh start|stop|restart|status|log|reset`

> Neste dispositivo o `typecheck` e o `build` demoram 2 a 4 min **na primeira vez** —
> é I/O do Android (2m33s de relógio para 31s de CPU), não bloqueio. Com o cache
> incremental a segunda passagem do `typecheck` é de segundos. Não usar timeout curto
> na primeira.
>
> **Não corras `npm run build` enquanto o `test:prod` está a correr.** O smoke test
> arranca um servidor que aponta para `apps/web/dist` e falha se o build estiver a meio
> (aconteceu nesta sessão: foi assim que apareceu um falso negativo).

## O que está por fazer — e é tudo teu

**O passo a passo está em `COMO-POR-ONLINE.md`.** Resumo em dez linhas:

```bash
cd ~/argus
openssl rand -hex 32                 # anotar: é o ARGUS_SECRET
```
Depois, no browser: **render.com → New + → Blueprint → sramorim/argus**, com
`ARGUS_SECRET` = o valor anotado e `ARGUS_ADMIN_EMAILS` = o teu e-mail. Esperar 3-6 min,
abrir `/api/health`, registar-te com esse e-mail, e em Settings → Custom Domains apontar
`argus.senhoramorim.com.br` com o CNAME que o Render der.

Nada disto foi feito por iniciativa própria, de propósito: deploy, DNS e contas
externas são tuas. Os detalhes e o que fazer se algo correr mal estão em
`COMO-POR-ONLINE.md` e `CONCLUSAO-ARGUS.md` §6.

O **pagamento** está resolvido como produto: é **Pix mostrado no ecrã de Planos**
(chave vinda do ambiente, com botão de copiar e QR code desenhado no browser) e a
ativação é feita à mão — pelo WhatsApp para o PRO, e pelo painel de administração
para as recargas de créditos. Nenhum cartão passa pelo site. O que falta é só
decidires o **valor da chave Pix** e apontares `PIX_KEY` no Render.

## Limites conhecidos e já decididos

`phone-analyzer` sem operadora/titularidade (API paga) · `reputation-check` 7 s a frio
(feeds grandes, cache de 1 h resolve) · `tls-audit` 8,8 s no pior caso · `crt.sh` lento,
`CertSpotter` é a fonte primária · `reverse-image` só faz pHash local · BYOK limitado a
3 provedores (lista fechada) · guard anti-SSRF com janela TOCTOU de DNS rebinding
documentada no código.

## Regras que continuam de pé

Zero dados inventados · proveniência obrigatória · só fontes testadas · nada de códigos de
terceiros · o que não entrega, sai · port scanner passivo · sem Tor backend · só dados
públicos (LGPD) · deploy/DNS/produção/contas externas/dinheiro → parar e perguntar.
