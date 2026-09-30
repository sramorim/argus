# ARGUS — CHECKPOINT

**Data:** 2026-09-30 06:30 UTC · **Estado:** verde · **Fase:** pronto a publicar
**Guia para pôr online:** `COMO-POR-ONLINE.md` · **Detalhe máquina-legível:** `ARGUS-STATE.json`
**Conclusão:** `CONCLUSAO-ARGUS.md` · **Contexto completo:** `CONTEXTO-ARGUS.md`

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

2. **Nove defeitos reais corrigidos**, dos quais **quatro eram suficientes para
   impedir o deploy**:
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

## Estado verificado

| Verificação | Resultado |
|---|---|
| `npm test` | 79 segurança + 16 parsers + 14 interface = **109/109** |
| `npm run test:api` | **48/48** |
| `npm run test:prod` | **15/15** |
| `npm run test:audit` | **49/49**, 26/26 ferramentas · mediana 375 ms · máx 31,9 s |
| `npm run typecheck` | server ok · web ok |
| `npm run build` | ok → `apps/web/dist` (94 kB gzip) |
| `npm ci` | ok de raiz; **98 pacotes** com `NODE_ENV=production --include=dev` (sem o `--include=dev` seriam 9 e o build do Render falharia) |
| **Total** | **221 verificações** |

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
cd ~/central-amorim
git add probe/ && git status          # confirmar que não aparece nenhum .db
git commit -m "ARGUS: plataforma OSINT" && git push origin main
openssl rand -hex 32                 # anotar: é o ARGUS_SECRET
```
Depois, no browser: **render.com → New + → Blueprint → sramorim/central-amorim**, com
`ARGUS_SECRET` = o valor anotado e `ARGUS_ADMIN_EMAILS` = o teu e-mail. Esperar 3-6 min,
abrir `/api/health`, registar-te com esse e-mail, e em Settings → Custom Domains apontar
`argus.senhoramorim.com.br` com o CNAME que o Render der.

Nada disto foi feito por iniciativa própria, de propósito: deploy, DNS e contas
externas são tuas. Os detalhes e o que fazer se algo correr mal estão em
`COMO-POR-ONLINE.md` e `CONCLUSAO-ARGUS.md` §6.

O **pagamento** continua a ser uma decisão de produto, não um bloqueio técnico: a
ativação é manual por WhatsApp e nenhum cartão passa pelo site.

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
