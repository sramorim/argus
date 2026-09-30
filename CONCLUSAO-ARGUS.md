# ARGUS — Conclusão

**Data:** 2026-09-30 · **Estado:** funcional e apresentável · **Fase:** pronto a publicar,
falta só o que exige a tua conta.

Este documento diz o que o ARGUS é, o que está provado, o que foi corrigido nesta
sessão e o que **precisa de ti**. Não é um resumo do que se fez: é o que fica para a
próxima pessoa ler antes de abrir o site ao público.

---

## 1. O QUE ESTÁ PRONTO

### As 26 ferramentas, todas testadas com alvos reais

`npm run test:audit` corre **49 casos contra as 26 ferramentas**, com alvos reais
(wikipedia.org, 1.1.1.1, torvalds, log4j, CNPJ da Receita Federal, EXIF com GPS de
uma máquina fotográfica real, o endereço BTC do bloco génesis, certificados TLS
vivos **e expirados**). Resultado da última execução:

```
ferramentas cobertas: 26 / 26
casos: 49   OK: 49   PARCIAL: 0   VAZIO: 0   ERRO: 0   PROV: 0
latência: mediana 357ms  máx 8846ms
```

| Categoria | Ferramentas (plano mínimo) |
|---|---|
| Infraestrutura | `domain-analyzer` · `ip-analyzer` · `port-scanner` (Pro) · `asn-lookup` · `tls-audit` |
| Web | `url-scanner` · `web-crawler` · `reverse-image` (Pro) |
| Pessoas | `username-finder` · `email-analyzer` · `phone-analyzer` · `telegram-osint` (Pro) · `dorks-generator` · `graph-investigation` |
| Ameaças | `password-check` · `reputation-check` (Pro) · `cve-lookup` · `paste-search` (Pro) |
| Ficheiros | `hash-analyzer` · `metadata-extractor` |
| Desenvolvimento | `package-audit` · `github-osint` |
| Financeiro | `crypto-tracer` |
| Brasil | `company-br` (QSA incluída) · `zipcode-br` |
| Geo | `geo-lookup` |

**21 são Free e 5 são Pro** — nenhuma ferramenta exige Pro Max, e o Pro Max existe
para dar volume a quem já usa as Pro.

> **Sobre correr isto mais do que uma vez.** A auditoria fala com servidores de
> terceiros a sério, por isso um único `PARCIAL` ou `ERRO` num caso é quase sempre
> uma falha de rede e não um defeito da ferramenta. Numa execução deste ficheiro
> um caso de `tls-audit` ficou `PARCIAL`; corrido de seguida, à mão, confirmou que a
> ferramenta deteta a expiração corretamente e a auditoria voltou a dar 49/49.
> **Volte a correr antes de concluir que algo está partido** — e confirme sempre à
> mão, como foi feito aqui.

### 221 verificações automáticas, todas a passar

| Comando | Resultado | Custo |
|---|---|---|
| `npm test` | 79 segurança + 16 parsers + **14 UI/DOM** = **109** | ~40 s |
| `npm run test:api` | **48** (HTTP a sério, com cookies e CSRF) | ~2 min |
| `npm run test:prod` | **15** (arranque em condições de produção) | ~2,5 min |
| `npm run test:audit` | **49** (alvos reais na rede) | ~1 min |
| `npm run typecheck` | server ok · web ok | ~4 min (1.ª vez) / ~2 min (com cache) |
| `npm run build` | ok → `apps/web/dist` (94 kB gzip) | ~2 min |
| `npm ci --include=dev` | ok de raiz; **98 pacotes** | ~20 s |

### O que o smoke test de produção garante

Não é um teste de "o servidor responde 200". Simula o arranque no Render
(`NODE_ENV=production`, disco persistente, `HOST=0.0.0.0`, cookie `__Host-`) e
confirma que o ARGUS **recusa arrancar** quando a configuração está errada:

- sem `ARGUS_SECRET` → não arranca
- segredo com menos de 32 caracteres → não arranca
- segredo de exemplo → não arranca
- `ARGUS_DB` com caminho relativo → não arranca (é o que apaga tudo a cada deploy)
- cookie sem `Secure` em `0.0.0.0` → não arranca
- CORS com `*` → não arranca
- sem o build do frontend → não arranca

E confirma que os dados **sobrevivem a um reinício do processo** (o que o Render faz
a cada deploy) e que o `SIGTERM` dá checkpoint do SQLite e sai com código 0.

---

## 2. O QUE FOI CORRIGIDO NESTA SESSÃO

O checkpoint anterior estava desatualizado: o projeto já estava muito mais avançado do
que registava (o painel de administração, o `render.yaml`, o logo, os ícones e o
`CONTEXTO` já existiam). Ao verificar o código a sério apareceram **nove defeitos
reais**, quatro deles suficientes para impedir o deploy.

### 1. Todos os avisos da aplicação estavam mudos 🔴

`ToastHost` estava exportado em `components/ui.tsx` e **nenhuma página o montava**.
O `useToast()` devolvia a função vazia do contexto, portanto **todos** os avisos
desapareciam sem dar sinal: plano alterado, investigação apagada, chave API guardada,
ficheiro grande demais, erro ao copiar o resultado. O servidor estava perfeito; o
utilizador é que ficava às escuras a carregar no botão sem nunca saber se a ação
tinha acontecido.

Mountado em `main.tsx`, dentro do `ErrorBoundary`. E há agora um teste de DOM real
que prova que o aviso chega ao ecrã — e um contra-teste que prova que *sem* o provider
nada aparece, para que o primeiro não possa passar à toa.

### 2. O `npm ci` do Render estava partido 🔴

`apps/server/package.json` pedia `@types/jpeg-js@^0.4.1`. **Essa versão não existe no
registo** (existem `0.3.0` e `0.3.7`) e o `package-lock.json` tinha `^0.3.0`. Como o
`render.yaml` faz `npm ci && npm run build`, o deploy falhava antes de arrancar. O
serviço nunca teria subido.

Corrigido para `^0.3.0` e confirmado com um `npm ci` limpo (78 pacotes, sem erro).
Há agora um teste que compara `package.json` com `package-lock.json` — é o que impede
a divergência de voltar.

### 3. As `.db` iam parar ao Git 🔴

O `.gitignore` da raiz ignora `node_modules/` e `dist/`, mas **não** os ficheiros
`.db`. Um `git add .` da pasta `probe/` punha no histórico do repositório o email e o
hash scrypt de cada conta, os hashes das sessões e as chaves BYOK cifradas. E um
histórico de um repositório não se apaga com facilidade.

Criado `probe/.gitignore`. Confirmado com `git status --untracked-files=all`: nenhum
`.db` aparece.

### 4. O build do Render não tinha as ferramentas de build 🔴

O `render.yaml` põe `NODE_ENV=production` nas variáveis. Com isso, o `npm ci` **omite
as devDependencies** — e o `npm run build` precisa justamente delas (vite, typescript).
Verificado com um `npm ci` real: instala **9 pacotes** e não encontra o vite. O build
morreria e o serviço nunca subia. Isto é independente do bug anterior e acontece mesmo
depois de o lockfile estar certo.

Corrido com `npm ci --include=dev` (que instala as 98 dependências certas), e há agora um
teste que confirma que o `--include=dev` está lá e que o `ARGUS_DB` aponta para o disco
montado.

### 5. O arranque dependia de uma flag experimental 🟠

Todos os scripts usavam `node --experimental-strip-types src/index.ts`. Como o
`.node-version` é `24` e o `engines` exige `>=22.18`, essa flag é redundante: o
strip-types do Node está ligado por omissão desde o 22.18. Se o Render escolhesse uma
versão onde a flag tivesse mudado de nome, o serviço não arrancava.

Todos os comandos passaram a ser `node src/index.ts` — testados e a passar.

### 6. O menu ficava desaparecido em ecrãs estreitos 🟠

`AppShell` decidia a visibilidade do botão de menu lendo `window.innerWidth` **durante
o render**. Isso só volta a ser avaliado quando outra coisa força um novo render, por
que redimensionar a janela — ou rodar o telemóvel — deixava a barra lateral
inacessível em ecrãs estreitos. Passou a ser `.only-narrow` resolvido em CSS, e o
`aria-current` da barra inferior deixou de ter uma condição morta
(`t.v.k !== 'inv' || true`, que é sempre verdadeira).

### 7. A partilha do link saía sem imagem 🟠

`og-cover.png` era um quadrado de 512×512, e as plataformas cortam a 1.91:1 — a imagem
aparecia minúscula, com barras pretas. E o `og:image` era uma URL **relativa**, que os
crawlers não resolvem. Agora a capa é 1200×630 e as etiquetas são absolutas, com
`og:image:width/height`, `twitter:summary_large_image` e `rel=canonical`.

A capa é gerada por `scripts/make-icons.mjs`, com o logótipo "ARGUS" desenhado em
traço (o SVG não dá para controlar a renderização de texto num PNG social). Os ícones
têm a mesma forma geométrica uns dos outros — `npm run icons` regenera tudo.

### 8. O botão de plano dizia uma falsidade 🟠

O modal de ativação confirmava **"Pedido registado. Falamos contigo…"** e não registava
nada: não havia pedido, nem canal, nem registo. Numa aplicação cuja regra de ouro é não
inventar nada, isto era o pior sítio possível para estar a mentir.

Agora abre o WhatsApp (`wa.me`) com a mensagem já escrita e percent-encoded, e há
também um botão para copiar. O texto é honesto: quem ativa o plano és tu, depois de
confirmares a transferência.

### 9. Defeitos menores 🟡

- `config.ts` tinha um comentário corrompido (`éJL relativo`).
- `Auth.tsx` mapeava `demais_tentativas`; o servidor devolve `demasiadas_tentativas`, por
  que a mensagem simpática nunca aparecia e o utilizador via o código cru.
- `.tool-toolbar` e `.topbar-landing` eram usados no TSX sem existir no CSS.
- `feeds.ts` reportava `1 ms` para downloads de 6 MB. Agora mede o tempo a sério e
  guarda-o com o texto, para um resultado servido do cache continuar a declarar quanto
  tempo levou a obtê-lo. A nota do cache passou a dizer o TTL real, que não é 1 h para
  todos os feeds.
- `apps/web/test/dom.test.mts`, `apps/server/test/_body.ts`, `_dbg2.ts`, `_diag.ts` e
  `_quality.ts` eram código morto de sessões de depuração. Removidos.

---

## 3. O QUE FOI VERIFICADO A MÃO, NÃO POR TESTE

Uma sessão completa contra um servidor real, com cookies e tudo:

| Passo | Resultado |
|---|---|
| registo, `/api/me`, catálogo | 26 ferramentas, 5 trancadas no Free, 9 categorias |
| `domain-analyzer` em `github.com` | 11 achados, 10 fontes (9 `ok`, 1 `empty`, 1 `skipped` com motivo) |
| `graph-investigation` em `github.com` | 100 nós, 99 arestas, 3 ferramentas |
| investigations + histórico | investigação guardada e relida; 2 execuções no histórico |
| `port-scanner` no Free | HTTP 402, como deve ser |
| `/api/admin/estado` sem ser admin | HTTP 403 |
| POST de outra origem | HTTP 403 (CSRF) |
| `/api/keys` sem sessão | HTTP 401 |
| **admin: mudar para `pro_max`** | trancadas 5 → 0 e `port-scanner` 402 → **200**, no mesmo instante |
| admin: tirar o próprio acesso | recusado com `auto_bloqueio` |
| admin: suspender | sessões apagadas e `/api/me` passa a `{"user":null}` de imediato |

---

## 4. IDENTIDADE VISUAL

- **Símbolo**: o olho do guardião. Geometria única em coordenadas 0..32, espelhada por
  `scripts/make-icons.mjs` — o SVG, o favicon, os ícones e a capa social vêm todos da
  mesma forma. Legível a 32 px (verificado).
- **Paleta**: grafite `#07080A`→`#22272E`, prata `#C8CDD4`, vermelho profundo `#B91C1C`.
  **Sem verde.** Os estados de confiança são gelo / aço / âmbar / cinza, nunca verde.
- **Logótipo**: traço geométrico original, nada de fonte de terceiros.
- **Ícones de interface**: 40 glifos SVG próprios, todos 24×24, `currentColor`, 1.6 de
  espessura. Substituíram os caracteres unicode que davam ar de "dashboard genérico".
- **Mobile-first de verdade**: barra inferior de 4 destinos + gaveta; tabelas empilhadas
  em cartões; a área segura do telemóvel (`env(safe-area-inset-bottom)`) é respeitada;
  a gaveta trava a rolagem de fundo.

---

## 5. SEGURANÇA

| Medida | Onde |
|---|---|
| Guard anti-SSRF (valida **todos** os IPs, revalida em cada redirect) | `net/ssrf.ts` |
| Senhas em scrypt + salt, comparação em tempo constante | `db.ts` |
| Sessão em cookie `HttpOnly`, `SameSite=Lax`, `__Host-` em produção | `config.ts` |
| Chaves BYOK cifradas em AES-256-GCM, nunca devolvidas pela API | `db.ts` |
| CSRF por `Origin`/`Sec-Fetch-Site` | `security.ts` |
| Limitadores separados para login, registo, execuções, IP e uploads | `security.ts` |
| Cotas e trancas validadas **no servidor**, a cada pedido | `registry.ts` |
| Upload validado por *magic bytes*, nunca pelo nome nem pelo `Content-Type` | `net/upload.ts` |
| Cabeçalhos: CSP, HSTS, `nosniff`, `DENY`, `Permissions-Policy`, COOP/CORP | `security.ts` |
| Traversal de caminho bloqueado; API desconhecida devolve JSON 404 | `index.ts` |
| O `health` só diz verde se o disco **tiver escrita** | `db.ts` |

Risco residual, declarado: o `fetch` nativo volta a resolver o hostname, o que deixa uma
janela TOCTOU de DNS rebinding. Está documentado no código; fechá-lo exige um `Agent`
com lookup fixo.

---

## 6. O QUE PRECISA DE TI (bloqueios de produção)

Tudo o que está aqui abaixo exige a tua conta ou a tua mão. Nada disto foi feito
por minha conta, de propósito.

### 6.1 Commit da pasta `probe/` — **bloqueia o deploy**

O `render.yaml` só funciona se o código estiver no repositório Git, e a pasta
`probe/` **ainda não foi commitada**. Sem isto o Render não tem o que construir.

```
git add probe/
git commit -m "ARGUS: plataforma OSINT com proveniencia (26 ferramentas testadas)"
git push
```

Já verifiquei que o que entra são 74 ficheiros e que **nenhum `.db` vai incluído**.
Não commitei nada — commit não foi pedido.

### 6.2 Render — criar o serviço

1. Render → **New +** → **Blueprint** → escolher o repositório. O `render.yaml` cria o
   serviço, o disco de 1 GB e as variáveis.
2. Quando o Render pedir o `ARGUS_SECRET`, gera um: `openssl rand -hex 32`.
   **Guarde-o em segurança**: se mudar, as sessões caem e as chaves BYOK guardadas
   deixam de decifrar.
3. `rootDir: probe`, plano `starter` (o Free não tem disco persistente), `oregon`.
4. Ao fim do build o Render dá o endereço do serviço (parecido com
   `argus.onrender.com`).

O `ARGUS_DB=/var/data/argus.db` e o disco em `/var/data` já estão no `render.yaml`.
O smoke test de produção valida exactamente esta configuração antes de publicares.

### 6.3 Primeiro administrador

**Sem SSH.** O `render.yaml` agora pede o `ARGUS_ADMIN_EMAILS` durante a criação do
serviço: escreve lá o teu e-mail e, quando te registares com ele, entras como
administrador logo no primeiro login.

Se preferires promoting por base de dados:
`sqlite3 /var/data/argus.db "UPDATE users SET is_admin=1 WHERE email='<o-teu-email>';"`

### 6.4 Domínio `argus.senhoramorim.com.br`

1. No Render: **Settings → Custom Domains** → `argus.senhoramorim.com.br`.
2. O Render dá um registo **CNAME** para apontar.
3. Criar esse registo no DNS de `senhoramorim.com.br`.
4. O certificado TLS é emitido pelo Render assim que o domínio resolve. O HSTS já está
   ligado e o cookie passa automaticamente a `__Host-` com `Secure`.
5. Ajustar `ARGUS_PUBLIC_ORIGIN` para o domínio final (já está no `render.yaml`).

O `index.html` já traz `rel=canonical` e etiquetas OG absolutas para esse domínio.

### 6.5 Pagamento — decisão tua, não técnica

Não há gateway de pagamento, e isso é uma **decisão de produto**: nenhum cartão passa
por este site. A ativação é manual, a partir do WhatsApp. Se um dia quiseres automatico,
isso é integração com conta externa e precisa de autorização tua.

---

## 7. LIMITES CONHECIDOS (honestos)

| Item | Limite | Decisão |
|---|---|---|
| `phone-analyzer` | Não obtém operadora nem titularidade | Exige API paga. Mantido com nota explícita. |
| `reputation-check` | Feed grande: 7 s a frio, ~1 ms com cache | Timeouts por feed; `abuse.ch` é a fonte de C2. |
| `tls-audit` | 8,8 s no pior caso (domínio que não responde) | Handshake com timeout; degrada com aviso. |
| `crt.sh` | Lento e instável → `skipped` com motivo | `CertSpotter` é a fonte primária. |
| `reverse-image` | Faz pHash local (DCT 64-bit real), não busca inversa | Declara isso e dá links para Lens/TinEye/Yandex. |
| `leak-check` | Removida | Não entregava nada sem chave BYOK. Regra 5. |
| `onion-finder` | Removida | Ahmia devolvia 0 resultados em todos os testes. Regra 5. |
| BYOK | Só `Leak-Lookup`, `github-pat` e `shodan` | Lista fechada, para não guardar chaves inúteis. |
| SSRF | Janela TOCTOU de DNS rebinding | Documentada; fecha-se com `Agent` de lookup fixo. |

---

## 8. COMO VERIFICAR

```bash
cd probe
npm ci                     # tem de bater certo com o lock (ver teste)
npm test                   # 109 verificações
npm run test:api           # 48
npm run test:prod          # 15
npm run typecheck          # server + web
npm run build              # gera apps/web/dist
npm run test:audit         # 49 casos com alvos reais (precisa de rede)
npm run icons              # regenera favicon, ícones e capa 1200x630
./run.sh start|stop|restart|status|log|reset
```

> **Nota sobre o tempo:** neste dispositivo (Termux, Android arm64) o `typecheck` e o
> `build` demoram 2 a 4 minutos. Não é bloqueio — é o sistema de ficheiros do Android.
> Passaram a correr em paralelo e com cache incremental, por isso a 2.ª execução é mais
> rápida. Não uses timeout curto a correr `npm run typecheck` aqui.
