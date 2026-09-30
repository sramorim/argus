# ARGUS — Contexto Completo do Projeto

> Documento para entregar a outro modelo/assistente. Descreve o que existe, o que foi
> decidido, o que está testado e o que falta. Não inventa: só regista o que está no código.

---

## 1. O QUE ISTO É

**ARGUS** é uma aplicação web de investigação OSINT (fontes abertas), que usa fontes públicas reais e está em
desenvolvimento dentro do projeto **Central Amorim**. Não é blog, não é loja, não é API
pública. É uma app: o visitante vê uma *landing page*, cria conta, entra e usa ferramentas.

**Nome:** ARGUS (guardião de cem olhos da mitologia grega — o que vê tudo).
**Subdomínio em preparação:** `argus.senhoramorim.com.br` (ainda não publicado — exige
DNS, deploy e conta do dono).
**Identidade visual:** grafite / prata / vermelho profundo. **Sem verde.**

### Paleta
```
--bg    #0B0D10    --bg-2  #101318   --panel #14171C   --panel-2 #1A1E24
--line  #272C33    --text  #F2F3F5   --muted #9CA3AF   --dim   #6B7280
--red   #B91C1C    --red-2 #DC2626
--conf-confirmed #16A34A  --conf-corroborated #2563EB  --conf-indicated #D97706
```

---

## 2. REGRAS INEGOCIÁVEIS DO PROJETO

Estas são as decisões do dono do projeto e **não devem ser violadas**:

1. **Zero dados inventados.** Se uma fonte falhar, aparece como `error` / `empty` /
   `needs_key`. Nunca se devolve resultado plausível mas falso.
2. **Proveniência obrigatória.** Cada achado tem de declarar de que fonte veio, em que
   estado, quando e com que grau de confiança.
3. **Só fontes reais e testadas.** Cada API foi testada com alvos reais antes de ser usada.
4. **Nada de códigos de terceiros.** Só referência conceptual. Visual original.
5. **Remover o que não funciona.** Ferramenta que não entrega o que promete sai ou é
   substituída. Nada fica "a enfeitar".
6. **Port Scanner é passivo** (Shodan InternetDB). Sem scan ativo.
7. **Sem Tor backend.** Onion só via Ahmia (clearnet).
8. **Não vender a functionality de login de redes sociais.** Fora do produto comercial.
9. **LGPD**: só dados públicos, com proveniência.
10. **Deploy, DNS, produção, compras, contas externas, dinheiro** → parar e perguntar ao dono.

---

## 3. DECISÕES DE PRODUTO

### Planos (implementados em `apps/server/src/plans.ts`)
| Plano | Preço | Execuções/dia | Burst/min | Paralelas | Itens/resultado | Saltos no grafo | Investigações guardadas |
|---|---|---|---|---|---|---|---|
| **Free** | R$ 0 | 15 | 3 | 1 | 25 | 1 | 3 |
| **Pro** | R$ 39,90 | 300 | 8 | 3 | 500 | 3 | 50 |
| **Pro Max** | R$ 79,90 | 1500 | 20 | 6 | 2000 | 5 | 500 |

**21 ferramentas são Free, 5 são Pro, nenhuma exige Pro Max.** As trancas estão em
`TOOL_LOCKS` e são validadas no servidor a cada pedido.

Modelo de funil: a pessoa cria conta, usa no Free, e paga para desbloquear mais.

### O que NÃO existe (decisão explícita)
Sem loja, sem blog, sem API pública para desenvolvedores, sem APK obrigatório,
sem páginas técnicas. Só: **landing + planos + app**.

### Ativação de planos
Manual — o dono confirma o pagamento e muda o plano no painel de administração (ou
por SQL). **Não há integração de pagamento**: nenhum cartão passa pelo site.
A UI abre o **WhatsApp com o pedido já escrito**, que é o único canal de contacto.

---

## 4. STACK

```
Node 26.4.0 (Termux/Android arm64)  ·  npm 11.19.1
Backend:  Hono 4 + @hono/node-server  +  node:sqlite (nativo, sem dependências)
Frontend: React 19 + Vite 6  (TypeScript, sem framework de UI)
Imagens:  jpeg-js + pngjs (descodificação para pHash DCT real)
Testes de UI: linkedom + esbuild (DOM real, sem browser)
Sem TypeScript compiler no arranque — usa-se o strip-types nativo do Node
(ativo por omissão a partir do 22.18, por isso nenhum flag é preciso):
  node src/index.ts
```

### Estrutura
```
argus/   (repo https://github.com/sramorim/argus — o ARGUS vive na RAIZ)
├── package.json                 (workspaces: @argus/server + @argus/web)
├── package-lock.json            (tem de bater certo com o package.json — o `npm ci`
│                                 do Render depende disso; há teste que compara)
├── render.yaml                  Blueprint do Render: raiz do repo + disco persistente
├── .env.example                 variáveis obrigatórias, comentadas
├── .gitignore                   (NUNCA commitar apps/server/data/*.db)
├── COMO-POR-ONLINE.md           passo a passo para o dono
├── run.sh                       arrancar/parar em background no Termux
├── scripts/
│   ├── make-icons.mjs           gera favicon, apple-touch, 192, 512 e a capa 1200x630
│   └── typecheck.mjs            typecheck paralelo + incremental das duas workspaces
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          API Hono + estáticos + rate limit + admin
│   │       ├── config.ts         configuração de produção; recusa arrancar se estiver errada
│   │       ├── security.ts       CSP/HSTS, CORS, limite de corpo, CSRF, limitadores
│   │       ├── db.ts             SQLite: users, sessions, user_keys, investigations,
│   │       │                     nodes, edges, cache, usage, runs + crypto + poda
│   │       ├── plans.ts          planos, quotas, TOOL_LOCKS
│   │       ├── registry.ts       contrato de ferramenta + executor + quotas
│   │       ├── net/
│   │       │   ├── ssrf.ts        guard anti-SSRF, safeFetch, safeFetchBuffer, apiJson
│   │       │   ├── provenance.ts  Source, Finding, Evidence, SourceLog, Confidence
│   │       │   ├── sources.ts     adaptadores das APIs
│   │       │   ├── cached-source.ts  cache que preserva proveniência
│   │       │   ├── feeds.ts       feeds abertos de ameaça (abuse.ch, OpenPhish, Tor)
│   │       │   └── upload.ts      ficheiros: valida por magic bytes, nunca em disco
│   │       └── tools/
│   │           ├── infra.ts       domínio, IP, portas, ASN, URL, crawler
│   │           ├── identity.ts    username, email, telefone, password, Telegram
│   │           ├── threat.ts      reputação, hash, CVE, pacotes
│   │           ├── finance-dev-br.ts  crypto, GitHub, dorks, metadata, CNPJ, CEP,
│   │           │                  geo, reverse-image, paste
│   │           ├── tls.ts         certificado TLS (handshake direto ao alvo)
│   │           └── graph.ts       investigação em grafo (orquestra as outras)
│   │   └── test/
│   │       ├── security.test.ts   79 testes (SSRF, quotas, crypto, proveniência, cache)
│   │       ├── parsers.test.ts    16 testes (EXIF sobre JPEG real, detectSeedType)
│   │       ├── api.test.ts        48 testes de HTTP a sério
│   │       ├── audit-tools.ts     49 casos com alvos reais
│   │       └── smoke-prod.ts      15 testes de arranque em condições de produção
│   └── web/
│       ├── index.html            (etiquetas OG absolutas para o domínio final)
│       ├── vite.config.ts        proxy /api → 127.0.0.1:8787
│       ├── public/               logo-mark.svg, logo.svg, favicon.svg/.png,
│       │                         apple-touch-icon, icon-192, icon-512,
│       │                         og-cover.png (1200x630), site.webmanifest
│       ├── src/
│       │   ├── main.tsx          router, fronteira de erro, deteção de rede, ToastHost
│       │   ├── api.ts            tipos + cliente HTTP + link de pedido de plano
│       │   ├── styles.css        tema completo (mobile-first)
│       │   ├── pages/
│       │   │   ├── Landing.tsx    landing pública (herói, features, ferramentas, planos, FAQ)
│       │   │   ├── Auth.tsx       login/registo
│       │   │   ├── AppShell.tsx   sidebar/gaveta, barra inferior, medidor de cota
│       │   │   ├── Catalog.tsx    catálogo com busca e filtros
│       │   │   ├── ToolPage.tsx   formulário + resultado
│       │   │   ├── Investigations.tsx  lista + detalhe com grafo
│       │   │   ├── History.tsx    histórico de execuções
│       │   │   ├── Plans.tsx      os 3 planos + pedido por WhatsApp
│       │   │   ├── Keys.tsx       BYOK (add/listar/remover)
│       │   │   ├── Account.tsx    conta, senha, encerrar sessões, eliminar conta
│       │   │   └── Admin.tsx      administração (planos, suspensão, acesso)
│       │   └── components/
│       │       ├── ResultPanel.tsx  achados + matriz de fontes + grafo + exportar
│       │       ├── GraphView.tsx     grafo SVG interactivo (zoom, pan, seleção)
│       │       ├── Icons.tsx        40 ícones próprios 24x24
│       │       └── ui.tsx           marca, cartões, estados, avisos, modal, toast
│       └── test/
│           ├── ui.test.mts       17 testes (3 com DOM real)
│           └── harness.tsx      o que é montado pelos testes de DOM
```

### Comandos
```bash
# Verificações (ver ARGUS-CHECKPOINT.md para o tempo em cada uma)
# o repositório de produção é https://github.com/sramorim/argus
npm ci
npm test                  # 112: 79 segurança + 16 parsers + 17 interface
npm run test:api          # 48
npm run test:prod         # 15
npm run typecheck         # server + web, em paralelo
npm run build             # gera apps/web/dist
npm run test:audit        # 49 casos reais, precisa de rede
npm run icons             # regenera favicon, ícones e capa social

# Terminal 1 — API
cd ~/argus/apps/server
node src/index.ts                                   # porta 8787
# ou, a partir da raiz e em background, a sobreviver ao fim do comando:
cd ~/argus && ./run.sh start   # e depois: status | log | stop | restart | reset
```

> **Nota Termux:** para o servidor sobreviver ao fim de um comando de shell:
> `setsid --fork sh -c 'node src/index.ts > log 2>&1' < /dev/null`
> E para matar sem matar o próprio shell: `pkill -f 'ind[e]x.ts'` (o truque do bracket).
>
> **Nota de velocidade:** `typecheck` e `build` demoram 2 a 4 min neste dispositivo.
> É I/O do Android (2m33s de relógio para 31s de CPU), não bloqueio. Não usar timeout
> curto.

---

## 5. O MODELO DE DADOS — CONFIANÇA E PROVENIÊNCIA

Este é o núcleo conceptual do projeto.

**Cada `Finding` tem:**
- `group` (categoria de apresentação)
- `label` / `value`
- `evidence.kind`: `fact` | `inference` | `claim`
- `evidence.confidence`: `confirmed` | `corroborated` | `indicated` | `weak`
- `evidence.sourceIds[]` — as fontes que sustentam
- `evidence.at` — timestamp

**Cada `Source` tem** `status`: `ok` | `empty` | `skipped` | `error` | `needs_key` | `timeout`,
mais `ms`, `count` e `note`.

**Regra de ouro:** se a ferramenta consultou uma fonte e ela falhou, isso aparece na
matriz. Nunca se esconde um erro atrás de um resultado parcial.

---

## 6. AS 26 FERRAMENTAS

Todas registadas em `registry`, todas executadas end-to-end com alvos reais.

### Infraestrutura
| id | O que faz | Fontes | Estado |
|---|---|---|---|
| `domain-analyzer` | RDAP, DNS completo, subdomínios via CT, SPF/DMARC | rdap.org, dns.google, CertSpotter, crt.sh | ✅ 2.1s frio / cache 1 h |
| `ip-analyzer` | Geolocalização, ISP, ASN, portas, Reverse DNS, vuln tags | ipwho.is, ip-api, Shodan InternetDB, rdap | ✅ 1.5s, 25 achados |
| `port-scanner` | Portas + hostnames + tags **passivas** | Shodan InternetDB | ✅ 52 ms · **Pro** |
| `asn-lookup` | Dados de ASN e WHOIS | RIPEstat | ✅ 1.8s |
| `tls-audit` | Certificado real por handshake: validade, cadeia, SAN, protocolo | direto ao alvo | ✅ 8.8s no pior caso |

### Web
| id | O que faz | Fontes | Estado |
|---|---|---|---|
| `url-scanner` | Estado HTTP, headers, título, Wayback | fetch, Wayback | ✅ 2.0s |
| `web-crawler` | robots.txt + páginas | robots, crawl | ✅ 170 ms |
| `reverse-image` | pHash **DCT real 64-bit** + Hamming + links de busca inversa | local (jpeg-js/pngjs) | ✅ 347 ms · **Pro** |

### Identidade
| id | O que faz | Fontes | Estado |
|---|---|---|---|
| `username-finder` | Username em ~15 plataformas, 3 estratégias | GitHub API, HTTP status, diff vs. perfil inexistente | ✅ 2.9s |
| `email-analyzer` | Sintaxe, MX, disposable, SPF, DMARC, Gravatar | dns.google, Gravatar | ✅ 301 ms |
| `phone-analyzer` | E.164, país, DDD, tipo | cálculo local | ✅ 10 ms (limitado: sem operadora) |
| `password-check` | Vazamentos por k-anonymity | Pwned Passwords | ✅ 189 ms |
| `telegram-osint` | Nome, inscritos, descrição, tipo | t.me/s/ | ✅ 1.2s · **Pro** |

### Ameaça / Dev
| id | O que faz | Fontes | Estado |
|---|---|---|---|
| `reputation-check` | abuse.ch ThreatFox + URLhaus, OpenPhish, saídas do Tor | feeds abertos | ✅ 7.3s frio / cache 1 h · **Pro** |
| `hash-analyzer` | Identifica algoritmo + exposição | local + Pwned | ✅ 22 ms |
| `cve-lookup` | Detalhe e pesquisa de CVE | NVD + CIRCL (2 fontes) | ✅ 3.0s, 7 achados |
| `package-audit` | Vulns de pacote@versão | OSV.dev | ✅ 981 ms |
| `paste-search` | Dorks de paste + busca real | DuckDuckGo, Bing RSS | ✅ 357 ms · **Pro** |
| `github-osint` | Perfil, repos, atividade | GitHub API | ✅ 818 ms, 10 achados |

### Crypto / Brasil / Geo / Ficheiros
| id | O que faz | Fontes | Estado |
|---|---|---|---|
| `crypto-tracer` | Saldo, transações, preço BTC | blockchain.info, mempool.space, Coinbase | ✅ 5.5s, 3 fontes |
| `dorks-generator` | Gera dorks; executa busca real se pedido | Bing RSS, DuckDuckGo | ✅ 379 ms |
| `metadata-extractor` | EXIF (JPEG) e metadados (PDF) | local (descodificação real) | ✅ 573 ms, 27 achados com GPS |
| `company-br` | CNPJ + **QSA (sócios)** + CNAE | BrasilAPI (Receita Federal) | ✅ 17 ms, 8 achados |
| `zipcode-br` | CEP com 2 fontes | BrasilAPI + ViaCEP | ✅ 616 ms · corroborado |
| `geo-lookup` | Geocode e reverse-geocode | Nominatim/OSM | ✅ 1.1s |
| `hash-analyzer` | ver Ameaça | local | ✅ |
| `graph-investigation` | **Orquestra** as ferramentas em torno do alvo e monta o grafo | todas acima | ✅ 100 nós / 99 arestas |

---

## 7. O GRAFO (assinatura do produto)

`apps/server/src/tools/graph.ts`

1. **Deteta o tipo do alvo** (`detectSeedType`): username, domínio, IP, URL, email,
   telefone, wallet, CVE, CNPJ, CEP, pessoa.
2. **Escolhe as ferramentas** certas para esse tipo (`planFor`).
3. **Corre-as** em sequência, saltando as que estão trancadas no plano do utilizador.
4. **Colhe nós e arestas** dos achados (`harvest`): um nó por item de array, com dedupe
   por `tipo::valor`, com confiança filtrada (descarta `weak` e grupos meta como "resumo").
5. **Grava** a investigação + grafo nas tabelas `investigations` / `nodes` / `edges`.
6. **Trunca** conforme os saltos do plano (`trimGraph`).

Cada nó: `id`, `type`, `label`, `value`, `confidence`, `sourceIds`, `hop`, `attrs`.
Cada aresta: `from`, `to`, `rel`, `confidence`, `sourceIds`.

**Frontend** (`GraphView.tsx`): SVG com layout radial por salto, pan, zoom, seleção de
nó, legenda por tipo e contador de nós/ligações.

---

## 8. PENDENTE / FRACO (honesto)

| Item | Problema | Decisão |
|---|---|---|
| `onion-finder` | Ahmia devolvia 0 resultados em todos os testes | **REMOVIDA** (regra 5). Ahmadia deixou de ser fonte. |
| `leak-check` | Não entregava nada sem chave BYOK | **REMOVIDA** (regra 5). Saiu do catálogo e das trancas. |
| `phone-analyzer` | Não obtém operadora nem titularidade (exige API paga) | Mantido, com nota explícita. Honestamente limitado. |
| `reputation-check` | Feeds grandes: 7 s a frio | Cache de 1 h resolve. abuse.ch é a fonte de C2. |
| `tls-audit` | 8,8 s no pior caso (domínio que não responde) | Handshake com timeout; degrada com aviso. |
| `crt.sh` | Lento e instável → fica `skipped` com o motivo | CertSpotter é a fonte primária. |
| `reverse-image` | Não faz busca inversa real | Só pHash local + links para Lens/TinEye/Yandex. Declarado. |
| `Spamhaus DBL` | **Testado e rejeitado** — devolve NXDOMAIN via DoH público | Não usado. |
| `Feodo Tracker` | **Testado e rejeitado** — responde 200 com 565 bytes só de comentários | Substituído por abuse.ch ThreatFox. |
| BYOK | Só 3 provedores na lista fechada | Evita guardar chaves que nenhuma ferramenta usa. |

### Ativação de planos
A UI mostra os planos e abre o **WhatsApp com o pedido já escrito**. **Não há gateway
de pagamento**: nenhum cartão passa por este site, por decisão de produto. Quem ativa o
plano é o dono, depois de confirmar a transferência — e o painel de administração existe
para isso (mudar plano, suspender, dar acesso).

---

## 9. SEGURANÇA IMPLEMENTADA

- **Guard anti-SSRF** (`net/ssrf.ts`): resolve o hostname, valida **todos** os IPs
  (não só o primeiro), bloqueia privados/loopback/link-local/metadata IPv6/CGNAT/multicast,
  revalida em cada redirect, limite de redirects, timeout e tamanho máximo.
  - *Risco residual declarado*: o `fetch` nativo volta a resolver o hostname (janela TOCTOU
    de DNS rebinding). Fechar isso exige um Agent com lookup fixo — documentado no código.
- **BYOK cifrado** com AES-256-GCM (`db.ts`), chave derivada de HMAC-SHA256.
- **Senhas** com scrypt + salt por utilizador, comparação em tempo constante.
- **Sessões** por cookie `HttpOnly; SameSite=Lax`, token guardado apenas como HMAC.
  Com `Secure` ligado o nome passa automaticamente a `__Host-`.
- **CSRF** por `Origin`/`Sec-Fetch-Site` (`security.ts`), para além do `SameSite`.
- **Rate limit** em memória: login e registo com contadores separados (criar contas em
  massa é um ataque diferente de errar a senha), mais execuções, IP e uploads.
- **Cotas e trancas** validadas no servidor a cada pedido; nada se decide no cliente.
- **Upload** validado por *magic bytes*, nunca pelo nome nem pelo `Content-Type`; nunca
  é gravado em disco.
- **Cabeçalhos**: CSP, HSTS (só com `Secure`), `nosniff`, `DENY`, `Permissions-Policy`,
  COOP/CORP, `Referrer-Policy`.
- **Configuração de produção que recusa arrancar** (`config.ts`): sem `ARGUS_SECRET`
  forte, com `ARGUS_DB` relativo, com CORS `*`, com cookie sem `Secure` em `0.0.0.0` ou
  sem o build do frontend. Sete cenários, todos com teste no `smoke-prod.ts`.
- **Truncamento honesto**: ao cortar resultados, é adicionada uma nota a dizer
  "resultado truncado para N itens, total encontrado M".
- **`.gitignore` próprio** (`probe/.gitignore`): os `.db` nunca entram no Git.

---

## 10. FRONTEND — ESTRUTURA

**Landing pública** (`Landing.tsx`): cabeçalho com contacto, herói, 4 cards de
capacidade, grelha de ferramentas, planos, FAQ honesto e rodapé. O formulário de auth
vem abaixo, com rolagem suave.

**App** (`AppShell.tsx`): sidebar com catálogo por categoria (desktop) ou gaveta
(telemóvel), barra de topo, barra inferior de 4 destinos e medidor de cota. Vistas:
`catalog` · `tool` · `inv` (com detalhe e grafo) · `history` · `plans` · `keys` ·
`account` · `admin`.

**Painel de resultado** (`ResultPanel.tsx`) com 3 abas:
1. **Resultados** — agrupados por `group`, com ponto colorido de confiança e
   tabelas expansíveis para valores complexos.
2. **Matriz de fontes** — tabela com fonte / estado / nº de dados / tempo / nota.
   *É o que prova que não há invenção.*
3. **Grafo** — só aparece se a ferramenta devolver um grafo.

Mais: copiar e exportar o resultado em JSON (com a proveniência incluída).

**Avisos (toast)**: o `ToastHost` é montado em `main.tsx` à volta de toda a aplicação.
Sem ele o `useToast()` devolve a função vazia e **nenhum aviso aparece** — foi um bug
real, e há teste de regressão em `apps/web/test/ui.test.mts`.

**Mobile-first**: abaixo de 1000px a sidebar vira gaveta (com a rolagem de fundo
travada), aparece a barra inferior, a tabela de fontes passa a cartões empilhados e a
tabela de resultados empilha. Abaixo de 700px sai o contador de execuções da barra de
topo. A área segura do telemóvel (`env(safe-area-inset-bottom)`) é respeitada.
A visibilidade dos botões é resolvida em **CSS** (`.only-narrow` / `.only-wide`), nunca
por `window.innerWidth` no render.

---

## 11. COMO TESTAR

```bash
# 0. Verificações automáticas (não precisam do servidor)
cd ~/argus && npm ci                # tem de bater certo com o lock
cd ~/argus && npm test              # 109: 79 segurança + 16 parsers + 14 interface
cd ~/argus && npm run test:ui       # só os 14 de interface (3 com DOM real)
cd ~/argus && npm run test:api      # 48, HTTP a sério
cd ~/argus && npm run test:prod     # 15, arranque em condições de produção
cd ~/argus && npm run typecheck     # server + web, em paralelo (~2-4 min no Termux)
cd ~/argus && npm run build         # build do frontend
cd ~/argus && npm run test:audit    # 49 casos reais, ~1 min, usa a rede

# 1. Arrancar
cd ~/argus && ./run.sh start
curl -s localhost:8787/api/health      # {"ok":true,"tools":26,"db":{"writable":true}}

# 2. Registo
curl -s -X POST localhost:8787/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@b.com","name":"Teste","password":"senha12345"}' -c cookies.txt

# 3. Correr uma ferramenta
curl -s -b cookies.txt -X POST localhost:8787/api/run/domain-analyzer \
  -H 'content-type: application/json' -d '{"domain":"github.com"}'

# 4. Frontend: http://localhost:8787 (o servidor serve o build)
```

Planos de teste: `UPDATE users SET plan='pro_max';`
Administradores: `UPDATE users SET is_admin=1 WHERE email='...';` ou a variável
`ARGUS_ADMIN_EMAILS`.

---

## 12. PISTAS PARA QUEM CONTINUAR

1. **Testar cada ferramenta com alvos reais** e remover as que não entregam. — **FEITO.**
   `apps/server/test/audit-tools.ts` corre **49 casos reais** contra as 26 ferramentas e
   classifica cada um (OK / PARCIAL / VAZIO / ERRO / PROV). Resultado atual:
   **49 OK, 0 falhas, 26/26 ferramentas**. Foi este teste que achou bugs reais (o NVD mudou
   de formato, os IDs de nó colidiam entre reinícios, os feeds perdiam a proveniência) e
   que levou a remover o `onion-finder`, o `leak-check` e o Feodo Tracker.
2. **Publicar**: a persistência do SQLite está resolvida (`render.yaml` com disco em
   `/var/data`, validado pelo `smoke-prod.ts`). Falta o que exige o dono: commitar a
   pasta, criar o serviço, apontar o domínio. Ver §13.
3. **Admin**: **FEITO.** `Admin.tsx` + rotas `/api/admin/*` com `requireAdmin`. Lista
   utilizadores, muda plano (com reinício opcional da cota do dia), suspende (o que
   apaga as sessões) e dá/retira acesso. O botão escondido não protege: `is_admin` é lido
   do banco a cada pedido, e o próprio utilizador não se pode despromover.
4. **Pagamento**: só quando houver autorização para conta externa. Hoje a ativação é
   manual por WhatsApp, com o pedido já escrito.
5. **Testes automatizados** — **FEITO.** 224 verificações:
   - `security.test.ts` — 79 (SSRF, quotas, locks, crypto/BYOK, proveniência, cache, poda).
   - `parsers.test.ts` — 16 (EXIF sobre JPEG real, `detectSeedType`).
   - `api.test.ts` — 48 (HTTP a sério: cookies, CSRF, quotas, admin, estáticos, SPA).
   - `smoke-prod.ts` — 15 (recusa arrancar com config errada; dados sobrevivem a restart).
   - `apps/web/test/ui.test.mts` — 17 (3 com DOM real; integridade de CSS, ícones, OG, e o `render.yaml` do Render: `rootDir`, workspaces e variáveis de ambiente).
6. **Métricas de latência**: mediana **357 ms** por execução na auditoria; o pior caso é
   `tls-audit` (8,8 s) e `reputation-check` (7,3 s a frio, ~1 ms com cache).

---

## 13. PERSISTÊNCIA — RESOLVIDA

O servidor guarda tudo num ficheiro SQLite (`ARGUS_DB`). O risco real era o disco
**efemérico** das plataformas cloud, onde a base de dados se apaga a cada deploy.

**Decidido e implementado: Render com disco persistente.**

- `render.yaml` cria o serviço com um disco de 1 GB montado em `/var/data` e
  `ARGUS_DB=/var/data/argus.db`.
- `config.ts` **recusa arrancar** em produção se `ARGUS_DB` não for um caminho absoluto,
  e avisa se o caminho cheirar a efemérico (`/app/`). Sem essa validação, um caminho
  relativo resolveria para `/app/data/argus.db` — que *é* absoluto — e o serviço
  escreveria no disco do contentor sem um único aviso.
- `dbHealth()` é verificado pelo `/api/health`: o serviço só fica verde se o disco
  **tiver escrita**. Sem isso, o Render marcava verde com o disco por montar e aceite
  registos que se perdiam no deploy seguinte.
- O `smoke-prod.ts` prova que os dados sobrevivem a um reinício do processo e que o
  `SIGTERM` dá checkpoint do SQLite.
- Poda periódica (`prune`) a cada 2 h: `usage` com mais de 90 dias, `runs` acima de 200
  por utilizador, cache expirado e sessões vencidas. Sem isto, um disco de 1 GB
  acabava por encher.

Alternativas que continuam abertas, se o Render não servir: Turso/libSQL (SQLite na
cloud, grátis, liberta o deploy de qualquer plataforma — **exige criar conta externa,
logo autorização necessária**) ou VPS.

**O que ainda falta é o que exige o dono:** commitar a pasta `probe/`, criar o serviço
no Render, gerar o `ARGUS_SECRET` e apontar `argus.senhoramorim.com.br`. Passo a passo
em `CONCLUSAO-ARGUS.md` §6.
