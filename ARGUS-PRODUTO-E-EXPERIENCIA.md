# ARGUS — Análise de Produto, Funcionalidades e Experiência

> Documento de entrada para criação do conceito visual e UX/UI do ARGUS.
> Tudo o que está aqui foi lido no código actual do repositório.
> Nada foi inventado, nada foi prometido além do que o código executa.

---

## 1. O QUE É O ARGUS

O ARGUS é uma plataforma web de **Social Intelligence** — investigação de presença
pública em fontes abertas, com foco em redes sociais.

Não é um blog, não é uma loja, não é uma API pública para programadores, não é um
scanner de vulnerabilidades. É uma aplicação com conta, sessão e histórico: o
visitante vê a landing, cria conta, entra e investiga.

**Nome e marca.** O nome vem de Argus Panoptes, o guardião de cem olhos da mitologia
grega. A assinatura do produto está no código: um alvo entra, o ARGUS escolhe as
ferramentas certas, e mostra **de onde veio cada achado, quando e com que grau de
confiança**.

**Posicionamento actual.** O nome do repositório e do domínio é `argus`
(`github.com/sramorim/argus`, `argus.senhoramorim.com.br`). Atenção: a interface ainda
se auto-introduz como **"ARGOS"** em vários pontos — `<title>`, Open Graph,
`site.webmanifest`, o componente `Brand`, a `localStorage` das preferências e o texto
do pedido de plano no WhatsApp. A palavra "ARGUS" só aparece no `Dashboard.tsx`
(hero) e num ponto do `api.ts`. **Esta é uma inconsistência real do estado actual e
precisa de decisão:** o novo visual tem de escolher uma das duas marcas e uni-la.

**Quem é o utilizador.** Investigador, analista de risco, jornalista, investigator de
marca ou pessoa que precisa de responder uma pergunta sobre presença digital de
alguém — com requisitos de rigor que não tolera resposta inventada. É um utilizador
profissional que confia no produto **porque** ele admite o que não sabe.

**A regra que governa o produto inteiro**, escrita em `CONTEXTO-ARGUS.md` e
aplicada em todo o código: *zero dados inventados; proveniência obrigatória; só
fontes reais e testadas; o que não entrega o que promete, sai do catálogo.*

---

## 2. O QUE O ARGUS ENTREGA

Dentro da plataforma, o utilizador consegue:

1. **Começar por um alvo e deixar o ARGUS escolher as ferramentas.** Aceita username,
   domínio, e-mail, telefone, IP, URL, carteira, CVE, CEP, CNPJ, hash, pacote ou nome
   de pessoa. O tipo é detectado por expressões regulares em
   `detectSeedType()` (`tools/graph.ts`).

2. **Correr uma investigação em 8 fases com plano visível antes de executar.**
   Discovery → OSINT → Social → Apify → Normalization → Correlation → Intelligence →
   Snapshots. Três modos: `QUICK`, `FULL`, `CUSTOM` (escolha de ferramentas). O plano
   é mostrado com o input exacto de cada ferramenta, e o que não vai correr aparece
   com **motivo concreto** — plano insuficiente, CLI em falta, token ausente, custo
   por confirmar.

3. **Guardar a investigação e reabrir o grafo completo**, com nós, arestas,
   proveniência e as ferramentas que a produziram, sem gastar cota.

4. **Obter um Perfil Unificado** do alvo: entidades reunidas, contas listadas com a
   sua confiança, divergências transformadas em lacunas, correlações, resoluções e
   relações tipadas.

5. **Comparar o que mudou** entre duas execuções (Presence Radar): novos perfis,
   posts, comentários, menções, links, mudanças de bio e de contas — cada um
   `NEW | REMOVED | CHANGED`.

6. **Exportar o relatório em quatro formatos** a partir do mesmo conteúdo:
   JSON, CSV, HTML e PDF (`intel/reports.ts` + `intel/pdf.ts`, PDF escrito à mão sem
   dependências).

7. **Ver o estado real do sistema**: `/api/health` devolve uma linha por
   dependência com estado, versão, latência, chave exigida (nome, nunca valor) e
   instrução de configuração.

8. **Controlar a conta e a quota**: plano, execuções de hoje, execuções em curso,
   itens por resultado, saltos no grafo, chaves BYOK, eliminar a conta.

9. **Compor dorks** no browser com o OmniDork Builder e exportá-las para o motor de
   busca escolhido (sem custo de servidor, sem consulta a sair do ARGUS).

**Monetização actual.** Três planos — Free (R$ 0), Pro (R$ 39,90/mês) e Pro Max
(R$ 79,90/mês). **Não existe gateway de pagamento**: a ativação é manual, o botão de
plano abre o WhatsApp com o pedido já escrito.

---

## 3. PRINCIPAIS FERRAMENTAS

O catálogo real tem **8 ferramentas registadas** no servidor
(`apps/server/src/tools/`, cada ficheiro com um `registerTool`). A navegação
frontend (`apps/web/src/ia.ts`) declara exactamente essas 8, e um teste da interface
falha se a navegação prometer algo a mais.

Existe ainda o **OmniDork Builder**, que é um módulo de frontend puro — não é
ferramenta de catálogo, não-executa nada no servidor, e por isso vive separado
(`pages/ToolPage.tsx` → `MODULOS`).

### 3.1 Investigação

| Ferramenta | ID | Plano | O que faz |
|---|---|---|---|
| **Investigação (Grafo)** | `graph-investigation` | Free | Deteta o tipo do alvo, escolhe e orquestra as ferramentas relevantes, e produz um grafo com nós, arestas, proveniência, confiança e **saltos** (hops). É também a porta de entrada do plano de 8 fases. |

Nós possíveis no grafo: `pessoa, username, email, telefone, dominio, ip, conta,
empresa, socio, endereco, wallet, portfolio, cve, pacote, breach, documento,
hashtag, servico`.

### 3.2 Identidade

| Ferramenta | ID | Plano | O que faz |
|---|---|---|---|
| **Localizador de Username** | `username-finder` | Free | Sonda **15 plataformas** com três estratégias diferentes (`api`, `status`, `content`). Usa *baseline*: compara a resposta do alvo com a de um username de controlo pedido ao mesmo site, e normaliza o username no HTML antes de comparar para não confirmar contas inexistentes. |
| **Inteligência de Username** | `username-intel` | Free | Quatro providers independentes com o **seu próprio registo de sites** e a sua forma de decidir "existe": Sherlock (481 sites), WhatsMyName (717), Maigret (6206, 698 desativados de fora) e Blackbird (CLI isolado, `NOT_INSTALLED` se não existir no PATH). Modos `QUICK` (25 sites), `FULL` (até 600) e `CUSTOM`. |

### 3.3 Redes e Comunicação

| Ferramenta | ID | Plano | O que faz |
|---|---|---|---|
| **Busca por Nome nas Redes** | `social-search` | Pro | Pesquisa um nome no **índice do Bing** (RSS público, sem chave) com **12 consultas separadas**: web aberta, Instagram, Facebook, TikTok, X, Twitter, LinkedIn, YouTube, Threads, Reddit, Telegram, Pinterest. Extrai perfil, nome, bio e seguidores do snippet. Não raspa rede nenhuma. |
| **DataLikers** | `datalikers` | Pro | Uma ferramenta, **30 recursos REST** documentados no OpenAPI da Cache API: **20 de Instagram** e **10 de TikTok**. Detalhe na secção 5. |

### 3.4 OSINT Engine

| Ferramenta | ID | Plano | O que faz |
|---|---|---|---|
| **OSINT Engine** | `osint-engine` | Free | Corre **5 ferramentas de terceiros** como processos isolados (sem shell, env mínima, tempo e saída limitados): SpiderFoot (MIT), Photon (GPL-3.0), OpenOSINT (MIT), GHunt (AGPL-3.0) e Holehe (GPL-3.0). Reporta `READY`, `NOT_INSTALLED` (com o comando de instalação), `NOT_CONFIGURED` (com o nome exacto da variável), `INCOMPATIBLE` (o alvo não é do tipo que a ferramenta aceita) ou `ERROR`. |

### 3.5 Apify

| Ferramenta | ID | Plano | O que faz |
|---|---|---|---|
| **APIFY** | `apify` | Free (com custo) | Registry aberto de **8 actors** da Apify Store para Instagram, TikTok, Facebook e X. Todos `pay-per-event`, por isso exigem confirmação explícita de custo antes de correr. |

### 3.6 Exposição

| Ferramenta | ID | Plano | O que faz |
|---|---|---|---|
| **Exposição Pública** | `paste-search` | Pro | Gera dorks de exposição (sites de paste, código em GitHub/GitLab, segredos) e executa a pesquisa real. Com chave BYOK Leak-Lookup acrescenta consulta a bases de brechas. |

### 3.7 Módulo independente

| Módulo | Onde vive | O que faz |
|---|---|---|
| **OmniDork Builder** | `pages/OmniDork.tsx` (só browser) | Compõe consultas com `filetype:`, `site:`, `inurl:` e abre no motor de busca escolhido. Custo zero de servidor. Identidade visual própria,隔离ada do resto (ver secção 10). |

---

## 4. REDES SOCIAIS — SUPORTE REAL

### Nível 1 — dados estruturados (DataLikers, 30 endpoints REST)

| Rede | Recursos | O que se obtém |
|---|---|---|
| **Instagram** | 20 | perfil por username, perfil por PK, perfil estendido por PK, "about" do perfil, análise de rosto por IA, seguidores (por username e por PK), publicação por PK, por shortcode e por URL, story por PK e por URL, destaque por PK e por URL, comentário por PK, hashtag por nome e por PK, localização por nome e por PK, áudio usado em reels por PK |
| **TikTok** | 10 | perfil por `unique_id`, perfil por PK, vídeo por PK, vídeos de um perfil (`user_pk`), comentário por PK, comentários de um perfil, hashtag por nome e por PK, playlist por PK, playlists de um perfil |

Ressalva escrita no código: **é cache, não tempo real.** O gateway devolve o que tem
guardado independentemente da idade.

### Nível 2 — actors pagos (Apify, 8 actors)

| Rede | Actors |
|---|---|
| **Instagram** | `apify/instagram-scraper`, `apify/instagram-profile-scraper`, `apify/instagram-comment-scraper`, `apify/instagram-followers-following-scraper` |
| **TikTok** | `clockworks/tiktok-scraper`, `clockworks/tiktok-profile-scraper` (terceiros, marcados como tal) |
| **Facebook** | `apify/facebook-posts-scraper` |
| **X** | `apidojo/tweet-scraper` (terceiro, e `viaApiNaFree: false` — via API exige plano pago) |

### Nível 3 — presença e menções (índice do motor de busca)

12 consultas com restrição `site:`: **toda a web, Instagram, Facebook, TikTok, X,
Twitter, LinkedIn, YouTube, Threads, Reddit, Telegram, Pinterest**. Devolve perfis
públicos que **mencionam** o nome pesquisado — não é confirmação de identidade.

### Nível 4 — sondagem de username (15 plataformas, nível booleano)

GitHub, GitLab, X, Instagram, TikTok, Reddit, Telegram, Twitch, Pinterest, Patreon,
SoundCloud, Keybase, Medium, npm, Hacker News.
Mais o `username-intel`, que cobre 481 + 717 + 6206 registos de sites com
metodologia de baseline.

### Não existe hoje
Sem acesso autenticado a Facebook, LinkedIn, Telegram ou WhatsApp. Sem leitura de
mensagens privadas, sem story em tempo real, sem DMs. Sem API do X além do actor
pago. O código é explícito: raspar estas redes viola termos de serviço e a decisão
foi **não o fazer**.

---

## 5. DADOS QUE O UTILIZADOR CONSEGUE OBTER

Tudo o que a seguir existe no código.

### Perfis e identidade
- username, nome, nome completo, nickname
- biografia / descrição
- número de seguidores, a seguir, publicações, vídeos
- likes, comentários, partilhas, visualizações, plays
- conta privada / verificada, país, categoria, link externo, foto de perfil
- ID e PK numérico (Instagram e TikTok)

### Conteúdo
- publicações, reels, carrosséis, vídeos TikTok
- stories e destaques
- comentários (de posts e de perfil)
- hashtags / challenges, localizações, áudios usados em reels
- playlists TikTok
- resposta JSON completa da API, sempre guardada e mostrada

### Relações
- **correlação** entre entidades: mesmo username, mesmo nome, mesmo URL, links
  cruzados, bio parecida, email público, domínio, avatar — cada uma com os fatores
  e o peso que a produziram
- **resolução de entidades**: par de entidades, faixa de confiança e fatores
- **arestas tipadas**: `segue`, `menciona`, `responde`, `mesmo-indicador`
- **cruzamento entre plataformas**: o mesmo identificador em N plataformas, com os
  URLs e a nota do que isso não prova
- **grafo** com saltos (1 no Free, 3 no Pro, 5 no Pro Max)

### Atividade e histórico
- timeline de eventos ordenados, com os intervalos entre eles
- histórico de atividade por plataforma, por dia e por tipo, com pico e denominador
- Radar de mudanças: `NEW / REMOVED / CHANGED / UNCHANGED`
- snapshots guardados — **só o último estado**, não histórico completo

### Exposição
- resultados em sites de paste, código indexado em GitHub/GitLab/Bitbucket
- padrões de segredos em código (`password OR secret OR api_key OR token`)
- breaches por e-mail ou username, se houver chave Leak-Lookup (BYOK)

### Contexto do alvo
- WHOIS/RDAP de domínio, dados de IP, DNS-over-HTTPS
- GitHub: utilizador, repositórios, eventos

### Relatórios
- JSON, CSV, HTML e PDF do mesmo conjunto de factos

---

## 6. PROVIDERS

| Provider | Tipo | Chave | Papel |
|---|---|---|---|
| **DataLikers** | REST (Cache API 2.10.1) | `DATALIKERS_API_KEY`, só backend | **Provider social principal.** 30 endpoints em Instagram e TikTok. Sem chave a ferramenta recusa com `NOT_CONFIGURED` e a fase Social do plano fica `BLOQUEADA` com o motivo à vista. A chave vai no header `x-access-key` e nunca sai do backend. Cada pedido desconta saldo. |
| **Apify** | REST (actors) | `APIFY_API_TOKEN`, só backend | **Scraping pago.** 8 actors verificados. Sem token: `NOT_CONFIGURED`, nada corre. Todos os actors são `pay-per-event`, por isso exigem confirmação. Três não são `apify/*` e estão marcados como terceiros. |
| **Bing RSS** | HTTP público | nenhuma | Índice do motor de busca. Alimenta `social-search` (12 consultas), `paste-search` e partes do grafo. |
| **Sherlock / WhatsMyName / Maigret** | registos JSON vendurados | nenhuma | Base do `username-intel`. 481 / 717 / 6206 sites. Licenças MIT, CC BY-SA 4.0 e MIT, com atribuição registada em `THIRD-PARTY.md`. |
| **Blackbird** | CLI isolado | `PATH` | Provider de username. Sem binário instalado: `NOT_INSTALLED`. |
| **SpiderFoot / Photon / OpenOSINT / GHunt / Holehe** | CLI isolado | `PATH` ou variável de caminho | `osint-engine`. Todos reportam o estado real da instalação. |
| **BYOK (utilizador)** | — | chave do utilizador | Lista fechada de 3: `leaklookup` (Exposição Pública), `github-pat` (GitHub OSINT), `shodan` (Analisador de IP). Cifradas com AES-256-GCM. |
| **SQLite nativo** | `node:sqlite` | `ARGUS_SECRET` | Persistência. Sem dependências externas. |

**Padrão comum a todos os providers externos:** sem chave, o estado é
`NOT_CONFIGURED` com o nome exacto da variável e **zero achados fabricados**. Nenhum
segredo aparece em findings, logs, URLs guardadas ou no `/api/health` — o health
mostra o nome da variável e o estado, nunca o valor.

---

## 7. COMO O UTILIZADOR USA O ARGUS

```
ENTRADA
  Um alvo: username · domínio · e-mail · telefone · IP · URL · carteira · CVE ·
  CEP/CNPJ · hash · pacote · nome de pessoa
  O tipo é detectado automaticamente (detectSeedType)

↓  "Nova investigação" é a acção principal do primeiro ecrã

PLANEAMENTO  (antes de correr, tudo à vista)
  8 fases · QUICK / FULL / CUSTOM
  Para cada ferramenta: PRONTO ou BLOQUEADA, com o motivo
  O input exacto que ia ser executado é mostrado
  Fases puladas ficam visíveis com "fora do modo escolhido"

↓  "executar plano"

COLETA  (phase-by-phase, progresso gravado depois de cada fase)
  Discovery  → o que o próprio alvo revela
  OSINT      → motores externos e registos de usernames
  Social     → busca por nome + Cache API da DataLikers
  Apify      → actors pagos (exigem confirmação de custo)
  Normalization → nós do grafo → entidades canónicas
  Correlation    → cruza indicadores, gera correlações e relações
  Intelligence   → perfil unificado e cruzamento entre plataformas
  Snapshots      → guarda o estado atual para o radar

PROCESSAMENTO  (o Intelligence Engine, tudo com evidência)
  cada achado carrega: fonte, estado da fonte, instante, tipo (fact/inference/
  claim) e confiança (confirmed / corroborated / indicated / weak)
  correlações e resoluções carregam os fatores com peso e razão

RESULTADOS
  separadores: Achados · Fontes · Grafo
  barra de resumo: tempo · achados · fontes OK · fontes com problema
  cada achado clicável para a fonte, com a nota da fonte

INVESTIGAÇÃO  (o que fica guardado)
  grafo completo + nós + arestas + ferramentas usadas
  plano e progresso da execução
  Perfil Unificado · Presence Radar · relatório em 4 formatos
  reabrir sem gastar cota
```

**Nota de honestidade que atravessa o fluxo inteiro:** o `social-search` devolve
perfis que **mencionam** o nome; o `username-finder` confirma que existe uma conta
pública com aquele nome **naquele site**; a correlação nunca afirma que é a mesma
pessoa. Cada um destes limites está escrito no código e aparece na interface.

---

## 8. INTERFACE ACTUAL

### 8.1 Metáfora

A aplicação é uma **área de trabalho**, não uma pilha de páginas. Ferramentas abrem
em **janelas** que se arrastam, redimensionam, minimizam e fecham, com barra de
tarefas em baixo. A justificação está no código: ter o domínio e o IP abertos ao
mesmo tempo é metade do que uma investigação precisa.

### 8.2 Ecrãs

| Ecrã | O que faz |
|---|---|
| **Landing** | herói, quatro capacidades, ferramentas por objetivo, planos, FAQ de perguntas honestas, rodapé SR. Amorim |
| **Auth** | registo e entrada |
| **Painel** (`dashboard`) | 1) ação principal em grande — "Nova investigação"; 2) 4 cartões de estado real (cota de hoje, plano, sessões guardadas, execuções); 3) entrada do OmniDork; 4) sessões recentes e histórico; 5) ferramentas agrupadas por objetivo; 6) busca e atalhos |
| **Nova investigação** | é a página da ferramenta `graph-investigation` com o campo de alvo em destaque |
| **Ferramenta** | ordem fixa: título → o que faz → limitações → campo → analisar → resultados → matriz de fontes |
| **Investigações / Sessões** | lista e detalhe com grafo, nós, ferramentas usadas, plano de 8 fases com estado por fase e por ferramenta |
| **Histórico** | execuções guardadas com o resultado completo, relível sem gastar cota |
| **System Health** | tabela de dependências com estado, versão, latência, chave exigida e instrução; 503 é mostrado, não escondido |
| **Presence Radar** | comparação de snapshots com selos `novo / removido / alterado / inalterado` |
| **Unified Profile** | perfil, contas com confiança, correlações, resoluções, relações, timeline, atividade, lacunas, exportação |
| **Planos** | três cartões; ativação por WhatsApp com a mensagem já escrita |
| **Chaves API** | BYOK: o que cada chave desbloqueia e onde obtê-la |
| **Conta** | perfil, cota, senha, sessões, eliminação de conta |
| **Definições** | só o que existe: dados do servidor + preferências locais rotuladas como tal |
| **Administração** | estado do serviço, busca de contas, mudar plano, dar/tirar admin, suspender |

### 8.3 Navegação

- **Sidebar** com 6 camadas expansíveis (Investigação, Identidade, Redes e Comunicação,
  OSINT Engine, APIFY, Exposição) + item de Administração quando o utilizador é admin.
- **Área de trabalho** com um ícone por ferramenta e por ecrã.
- **Barra inferior** no telemóvel com 4 destinos: Painel, Investigar, Sessões, Conta.
- **Gaveta** no telemóvel.
- **`ia.ts`** é a fonte única: sidebar, painel e busca leem a mesma lista, por isso não
  podem discordar.

### 8.4 Resultados — três separadores

**Achados** agrupados, com valor legível (números tabulares, URLs clicáveis, arrays em
tabela), tipo (fato/inferência/alegação) e selo de confiança com o que cada nível
significa.

**Fontes** — a matriz que prova que nada foi inventado. Cada fonte com estado
(`OK / Vazio / Ignorada / Erro / Precisa de chave / Timeout`), URL e nota.

**Grafo** — SVG interactivo com eventos de ponteiro (arrastar com dedo funciona),
zoom com dois dedos e layout radial por saltos ajustado ao contentor. Cor por tipo de
nó.

---

## 9. O QUE A INTERFACE PRECISA TRANSMITIR

Isto não é uma plataforma onde o utilizador querPASAR TEMPO. Está a trabalhar. O
interface é **instrumento**, não destino.

Cincoentials que a nova interface tem de fazer sentir em menos de cinco segundos:

**1. "Isto é uma ferramenta profissional de inteligência."**
Não uma app social, não um fórum, não um dashboard de e-commerce. A primeira
impressão tem de ser de ferramenta de trabalho séria — a que um analista abre às 8h
e fecha às 18h, vezes 300 vezes. Isso communicate por **rigor e quietude**, não por
futurismo.

**2. "Tudo aqui tem origem."**
Esta é a promessa única do produto e ela é **visual**, não textual. A matriz de
fontes não pode ser um separador secundário nem um rodapé pequeno: é o que separa o
ARGUS de qualquer scraper genérico. Cada achado tem de *sentir-se* rastreável até à
fonte com um clique. A proveniência é a elemento central do produto, não um detalhe
técnico.

**3. "Isto não inventa."**
Este é o diferencial e é o que o utilizador profissional mais valoriza. A interface
tem de **ensinar a desconfiança de forma útil**: mostrar `NOT_CONFIGURED` com o nome
da variável e a instrução como um estadolegível e útil, não como um erro. Um bloco
"precisa de chave" bem desenhado transmite mais confiança do que um resultado
falsamente completo. **A ausência de dados é informação, e o design tem de a tratar
como tal.**

**4. "Aqui há ponderação, não certeza."**
O produto tem dois vocabulários de confiança — `confirmed / corroborated /
indicated / weak` nos achados e `HIGH / MEDIUM / LOW / UNCONFIRMED` na inteligência —
e ambos significam *isto não prova identidade*. A hierarquia visual tem de fazer a
confiança ser sentida **sem ser lida**: um `indicated` não pode ter o mesmo peso
visual de um `confirmed`. Nunca um selo de confiança escondido num tooltip: o
hover-only é exactamente o oposto do produto.

**5. "Isto respeita tempo e dinheiro."**
Cota real, custo de provider real, confirmação antes de gastar. O planeador mostra
o que vai correr **antes** de correr. Essa deferência — mostrar o plano e o custo
antes da acção — é aGRAMÁTICA visual do produto: o utilizador tem de sentir que o
ARGUS lhe dá o comando antes de executar.

**Identidade própria a construir:** o ARGUS é um *guardião de cem olhos*. A metáfora
do olho que observa tudo, sem invadir, é a âncora honesta da marca — e o grafo de
relações é a sua assinatura visual. O produto já tem um elemento gráfico forte e
único: **o grafo com proveniência**. Ele deve ser o gesto de assinatura, o momento
visual mais reconocivel da plataforma.

**Para quem se projeta o uso:**场地 de trabalho de investigators — alguém que vai
passar horas. Conforto visual, densidade controlada, hierarquia calma. Nada de
stimulação constante. Nada de gamificação. Nada de emojis. Nada de "dados ao vivo"
a piscar sem parar.

---

## 10. O QUE NÃO COMBINA COM O ARGUS

Cada item abaixo está枉 connected a uma decisão concreta do código — não é opinião
estilística.

**Não: terminal hacker / preto-e-verde.**
O teste `ui.test.mts` verifica explicitamente que o CSS não contém verde Matrix nem
vermelho de gamer, e o `ARGUS-CHECKPOINT.md` regista "sem verde Matrix, sem neon, sem
gamer" como decisão tomada. Verde terminal é a negação directa da paleta.

**Não: Matrix comCharacters verdes.**
Absolutamente fora. A regra está escrita no teste, não apenas na preferência.

**Não: excesso de neon / glow.**
O `CONTEXTO-ARGUS.md` é explícito: **sem verde**, e o checkpoint proíbe neon. Glow é
o oposto de "proveniência visível": brilha o que não tem prova.

**Não: Rojo de alerta / hacking / severidade de firewall.**
Teste UI rejeita explicitamente vermelho de gamer. A paleta actual é azul profissional
(`#3b82f6`, `#1d4ed8`, `#60a5fa`) sobre superfícies quase neutras com tom azul muito
baixo.

**Não: aplicação infantil / arredondada /%}
Demo cartoon, ilustrações, mascotes, linguagem de无意中. O utilizador é profissional
e o produto trata de pessoas reais.卡通 ممنوع.

**Não: dashboard técnico genérico com 40 widgets de grelha.**
O painel actual tem uma regra escrita: *não se enche a página de cartões a competir
entre si para parecer mais cheio*. Um dashboard de métricas vazias trai a promessa de
"investigue o que é público".

**Não: terminal de pentest.**
Isto não é uma ferramenta de pentest. Não faz scan activo, não faz exploração, não
mostra payloads, não mostra shells. A `CONTEXTO-ARGUS.md` fixa "Port Scanner é
passivo" e "o que não entrega o que promete, sai". Um visual de hacking前期 seria uma
menta sobre o que o produto é.

**Não: visual de scraper / API playground.**
O ARGUS não é um construtor de pedidos. Não há campos de header, nem JSON verboso,
nem endpoints à vista. É um produto de investigação, não um cliente REST.

**Não: ferramentas em mosaico infinito.**
O checkpoint regista que a interface anterior foi reconstruída exactamente porque
tinha "uma lista de 26 botões". O conceito actual é **6 camadas expansíveis**, não uma
grid de tudo sempre visível. A densidade infinita é a falha original.

**Não: duas identidades visuais no mesmo produto.**
Hoje existe um módulo — o OmniDork Builder — com preto `#09090b`, grelha fina,
mono e **verde neon `#22c55e`**, completamente isolado em classes `od-`. É
intencional e está documentado como removível sem deixar rasto. Numa plataforma de
"tudo com proveniência", esse módulo é a única excepção da casa. Deve ser decidido
explicitamente: mantém-se como ferramenta deliberadamente distinta, ou integra-se.

**Não: falsaMockito de dados ao vivo.**
Não há websocket, não há polling em background, não há "ao vivo". O Radar compara
snapshots de execuções anteriores e diz isso ao utilizador. Qualquer animação que
sugira vigilância contínua mente sobre o produto.

**Não:Notifications push / alerta de monitorização.**
Não existem e o código diz porquê: *radar não vigia ninguém*. Nenhum icon de sino,
nenhum badge de "monitorizar".

---

## 11. DIREÇÃO VISUAL

Proposta que um designer ou IA pode transformar em interface. Não é uma escolha de
gosto: cada item está ligado a uma restrição real do produto.

### 11.1 Conceito: *The Analyst's Desk*

Não uma app. **Uma mesa de trabalho iluminada de baixo.** O utilizador está a olhar
para uma superfície onde as coisas estão dispostas com precisão, e cada elemento
declara de onde veio. A referência mental não é o cinema de hacker nem o dashboard
de SaaS: é a **mesa de trabalho de um analista de intelligence** — lamparina,
papel, fichas, linhas de ligação desenhadas à mão entre cartões.

**Nome interno do conceito:** *Everything has a source*.

### 11.2 Cores

O ARGUS já tem um sistema azul maduro e testado. **A recomendação é não o substituir —
aproveitá-lo.** O problema nunca foi a cor; foi a falta de uma linguagem em torno dela.

| Papel | Cor actual | Nota |
|---|---|---|
| Fundo | `#0a0a0f` | quase-preto com tom azul |
| Superfícies | `#0D1B2A`, `#102338`, `#16293F` | três níveis de profundidade |
| Linha | `#1E334A`, `#17293C`, `#2A4666` | três pesos de separador |
| Azul primário | `#3b82f6` | acção, selecção, foco |
| Azul profundo | `#1d4ed8` | gradientes |
| Azul claro | `#60a5fa` | destaques, links, dado vivo |
| Texto | `#e4e4e7` → `#a1a1aa` → `#71717a` → `#52525b` | quatro níveis |
| Erro | `#ef4444` | só para erro real |
| Ok | `#10b981` | só para sucesso real |
| Aviso | `#f59e0b` | só para aviso real |
| Confiança | `#7fc4ff` HIGH → `#4c9be8` MEDIUM → `#2f6fa8` LOW → `#5c7791` UNCONFIRMED | rampa de azuis, já implementada |

**Regras que o novo visual tem de respeitar:**
- **Cor tem significado fixo.** Azul = acção do utilizador. Verde = resultado bom.
  Vermelho = erro. Âmbar = aviso. **Nunca cor decorativa** — se uma superfície é
  azul, é porque é interactiva.
- **A rampa de confiança tem de ser lida sem ler texto.** Uma escala de azuis que
  desce de luminância é correcta para este produto: confiança alta *brilha*, confiança
  baixa *desaparece*.
- **Introduzir um acento não-azul para um único uso.** O produto precisa de
  distinguishir "given by a source" de "calculated locally" (`SourceLog.local()`), e
  hoje essa distinção só existe na matriz de fontes. Um acento quente reservado só
  para *cálculo local* daria à interface uma informação nova sem inventar
  funcionalidade.

### 11.3 Tipografia

O CSS já pede **Geist / Geist Mono** — que não estão incluídos, caem para
`system-ui` / `SF Mono`. **Esta é uma falha real a corrigir**: ou se embute Geist, ou
se escolhe uma stack deliberada.

- **Interface:** uma sans-serif neutra e ligeramente condensada. Numerais tabulares
  (`font-variant-numeric: tabular-nums`) em qualquer número — cota, contagens,
  latências, percentagens. Num desalinhado destrói a leitura de dados.
- **Mono:** para identificadores, usernames, URLs, hashes, IDs, valores de campo.
  Regra útil: **tudo o que o utilizador pode copiar é mono.**
- **Escala:** corpo 14–15px, secundário 13px, terciário 11,5px. Títulos com
  `letter-spacing` negativo (−0.03em no display). Manter — está calibrado para
  densidade de dados.

### 11.4 Navegação

O conceito de **6 camadas expansíveis** está certo e deve ser mantido. Sugestões de
reforço:

- **A camada aberta é a camada actual.** Já implementado (`data-current`), e é o
  que impede o utilizador de se perder.
- **A barra de tarefas com janelas** é o diferencial real. Merece ser tratada como
  elemento de primeira classe, não como detalhe do SO: indicador de estado por janela
  (a correr / com erro / com resultado), e um resumo do que está a correr agora.
- **A cota deve estar sempre visível, não numa página de planos.** É informação de
  contexto permanente do trabalho.
- **Nomear em linguagem de trabalho.** O ecrã `dashboard` chama-se **Painel**;
  `history` chama-se **Histórico**; `inv` é **Sessões**; `perfil` é **Unified
  Profile**; `health` é **System Health**. Há aqui uma mistura de português e inglês
  que precisa de ser resolvida numa decisão única.

### 11.5 Dashboard

Estrutura correcta na ordem actual: acção principal → estado real → trabalho
recente → ferramentas por objetivo.

Refinamentos:
- **Acção principal sempre visível.** Já está. Deve ser o elemento mais forte do
  ecrã, não apenas o maior cartão.
- **Cartões de estado com rótulo de estado real**, incluindo o caso negativo: cota
  esgotada mostra-se como esgotada, com o texto que o diz. Nunca um anel de
  progresso a 90% porque sim.
- **Sessões recentes com o grafo em miniatura** — o utilizador reconhece uma
  investigação pela *forma* do seu grafo, não pelo título. É o elemento mais
  reconhecível do produto e hoje está a ser desperdiçado como texto numa lista.

### 11.6 Cartões e superfícies

- **Raios pequenos a médios** (7 / 10 / 14px já existem). Nada de "cartões
  arredondados e fofos".
- **Bordas antes de sombras.** O produto tem linhas de três pesos e sombra só para
  o que flutua (janelas, popovers).
- **Cartões de ferramenta com três linhas obrigatórias:** nome, o que faz
  (uma frase), e o estado real (grátis / plano mínimo / precisa de chave). Sem
  imagens ilustrativas.

### 11.7 Resultados — o ecrã mais importante

Esta é a superfície onde o produto ganha ou perde a credibilidade.

**Estrutura:** barra de resumo (tempo · achados · fontes OK · fontes com problema) →
notas da execução (truncamentos, avisos) → separadores.

**Separador Achados**
- **Selo de confiança sempre visível, nunca só no hover.** O tooltip pode explicar;
  a cor tem de contar sozinha.
- **Tipo do achado visível:** fato / inferência / alegação. Uma inferência não pode
  ter o mesmo peso visual de um fato.
- **Valor legível por tipo:** números tabulares, URLs clicáveis com `abrir ↗`,
  arrays em lista com `(+N)` quando truncam, objetos em pares chave/valor.
- **Um achado por linha, com a fonte ao lado.** Nunca agrupar fontes no fim da
  lista: a fonte é parte do dado.

**Separador Fontes — o elemento mais importante do produto**
- Uma matriz, uma linha por fonte, com: id, etiqueta, URL, estado, tempo e nota.
- **Estados como cores fixas:** OK verde, Vazio neutro, Ignorada neutro, Erro
  vermelho, **Precisa de chave âmbar**, Timeout neutro.
- **"Precisa de chave" tem de ser um estado de primeira classe, não um erro.** É o
  momento em que o produto diz a verdade e dá a instrução (`DATALIKERS_API_KEY em
  falta — onde obtê-la`).treat as "Precisa de chave" como **chamada à acção**, com
  link para o ekö relevant. É a oportunidade de conversão mais honesta que existe.

**Separador Grafo**
- O grafo é a assinatura. Deve ser o elemento mais bonito do produto.
- Cor por tipo de nó (já implementada em `GraphView.tsx`).
- **Confiança como opacidade ou espessura da aresta** — não só como etiqueta.
- Ao tocar num nó: os seus achados, as suas fontes e a sua半径 no grafo.

### 11.8 Perfil unificado

O ecrã mais denso e mais valioso. Como deve ler:

- **Identidade principal no topo**: identificador dominante, número de plataformas,
  confiança geral.
- **Contas listadas, nunca fundidas.** Cada uma com a sua plataforma, URL, confiança
  e evidência. A regra "sem fundir o que não está provado" é a razão de existir
  deste ecrã e tem de ser **visível**: uma conta que discorda do resto aparece como
  **lacuna**, não desaparece.
- **Correlação e resolução separadas.** "Isto aparece em duas contas" é um facto.
  "São a mesma pessoa" é uma resolução com fatores. São ecrãs diferentes e não
  podem ser misturados num só bloco.
- **Cada faixa de confiança acompanhada do que ela NÃO prova.** Já está escrito no
  componente `Intel.tsx` e é uma das melhores linhas do produto.

### 11.9 Visualização de relações

Além do grafo de nós:
- **Relações tipadas** (`segue`, `menciona`, `responde`, `mesmo-indicador`) com
  arestas de espessura por confiança e etiqueta por tipo.
- **Timeline** como linha vertical de eventos com data, plataforma e link, e os
  intervalos **visíveis** — porque um buraco na linha é informação.
- **Radar** como *diff* visual: o que é novo entra com destaque, o que foi removido
  fica marcado como removido (não desaparece), o que mudou mostra **antes → depois**.

### 11.10 Estados — o sistema de estados é a identidade

O ARGUS tem um vocabulário de estado extraordinariamente rico e já implementado.
**Este é o ativo mais subaproveitado do produto.** Uma plataforma de honestidade
radical precisa de um design de estados igualmente radical.

| Estado | Significado | Tratamento visual |
|---|---|---|
| `READY` | instalado, configurado e verificado | verde, discreto |
| `Vazio` | a fonte respondeu mas não tem o que dar | neutro, sem alarme |
| `Ignorada` | não consultada, com motivo | neutro |
| `Precisa de chave` | falta configuração | âmbar, com a variável e a instrução |
| `Erro` | verificado e falhou | vermelho, com a mensagem |
| `BLOQUEADA` | o plano não permite | neutro com o plano mínimo |
| `NOT_INSTALLED` | falta o binário | neutro com o comando de instalação |
| `INCOMPATIBLE` | não serve para este alvo | neutro |
| `temAnterior: false` | primeira observação | **não é "nada mudou"** — tem de ser dito |

**Regra de ouro:** **nenhum estado de erro deve ser apresentado como se fosse um
resultado.** Um card com "Erro" não pode ter o mesmo formato visual de um card com
resultado. A diferença tem de ser óbvia num olhar.

### 11.11 Mobile

O código já tem o certo: abaixo de 1001px as janelas ocupam a área toda, a navegação
vira gaveta com as camadas e a barra inferior tem 4 destinos. Manter.

- **Polgar.** Campo de entrada e acção principal ao alcance do polegar.
- **Tabelas → cartões empilháveis.** Já existem atributos `data-l` para os
  rótulos em mobile.
- **Grafo com ponteiro e zoom de dois dedos.** Já implementado.
- **Visibilidade por CSS, nunca por `window.innerWidth` no render.** Decisão
  escrita e verificada por teste. Manter.
- **Preferências locais** (densidade, zebra) são um recurso real de leitura em
  ecrã pequeno. Devem ser descobertas, não escondidas em Definições.

### 11.12 Desktop

- **Sidebar + área de trabalho + barra de tarefas.** Correcto para o uso real.
- **Múltiplas janelas lado a lado** — comparar dois alvos é o caso de uso central.
- **Densidade maior sem perder leitura.** Um investigador passa horas aqui.
- **Densidade compacta** como opção real, não como truque.

### 11.13 Identidade própria — o que falta

O produto tem nome, logótipo e uma paleta. Não tem **gesto**.

Três candidatos a gesto de assinatura, todos já suportados pelo código:

1. **A linha de proveniência.** Um traço fino que liga cada achado à sua fonte. É o
   conceito do produto tornadoforma.
2. **O olho que observa.** A metáfora de Argus, mas desenhada como **reconhecimento
   passivo**, nunca como Cone de visão ou scanner.
3. **O selo de confiança como carimbo.** Um marcador de inspection, com peso e
   textura diferentes por nível — a Proveniência como selo, não como etiqueta.

O `logo-mark.svg` já existe. O que falta é **gesto de interface**, não logotipo.

---

## 12. PRINCIPAL OBJETIVO DO DESIGN

> **O utilizador tem de olhar para o ARGUS e compreender imediatamente:**
>
> **"Esta é uma plataforma profissional para descobrir, analisar e correlacionar
> presença pública em redes sociais."**

Concretamente, ao abrir a aplicação, uma pessoa tem de responder em menos de cinco
segundos:

- **O que é isto?** Uma mesa de trabalho de inteligência. Não uma rede social, não
  um dashboard de vendas, não um forum.
- **O que posso fazer aqui?** Começar por um alvo e ver onde essa pessoa está.
- **Porque é que confio?** Porque cada resultado diz de onde veio — e o que não
 rell told, também está escrito.
- **Vai gastar o meu dinheiro?** Não. A cota e o custo estão à vista antes de
  carregar no botão.

**Se o novo visual conseguir que alguém sinta as quatro coisas nos primeiros cinco
segundos — e sinta que um investigators Professional usaria aquilo todos os dias —
o design acertou.**

---

## ANEXO — MAPA DE ECRÃS E ESTADOS ACTUAIS

### Ferramentas (8 de 8)

| ID | Nome | Grupo | Plano mínimo |
|---|---|---|---|
| `graph-investigation` | Investigação (Grafo) | Investigação | Free |
| `username-finder` | Localizador de Username | Identidade | Free |
| `username-intel` | Inteligência de Username | Identidade | Free |
| `social-search` | Busca por Nome nas Redes | Redes e Comunicação | Pro |
| `datalikers` | DataLikers | Redes e Comunicação | Pro |
| `osint-engine` | OSINT Engine | OSINT Engine | Free |
| `apify` | APIFY | APIFY | Free |
| `paste-search` | Exposição Pública | Exposição | Pro |

Módulo independente: OmniDork Builder (só browser).

### Planos

| Plano | Preço | Execuções/dia | Burst/min | Paralelas | Itens/resultado | Saltos | Investigações |
|---|---|---|---|---|---|---|---|
| Free | R$ 0 | 15 | 3 | 1 | 25 | 1 | 3 |
| Pro | R$ 39,90 | 300 | 8 | 3 | 500 | 3 | 50 |
| Pro Max | R$ 79,90 | 1500 | 20 | 6 | 2000 | 5 | 500 |

### Fases da investigação (8)

Discovery · OSINT · Social · Apify · Normalization · Correlation · Intelligence ·
Snapshots
Modos: `QUICK` · `FULL` · `CUSTOM`

### Vocabulário de confiança

Achados: `Confirmado` · `Corroborado` · `Indicado` · `Fraco`
Tipo: `fato` · `inferência` · `alegação`
Inteligência: `HIGH` · `MEDIUM` · `LOW` · `UNCONFIRMED`

### Vocabulário de estado

`OK` · `Vazio` · `Ignorada` · `Erro` · `Precisa de chave` · `Timeout`
`READY` · `NOT_INSTALLED` · `NOT_CONFIGURED` · `MISSING_SECRET` · `INCOMPATIBLE` ·
`ERROR` · `RATE_LIMITED` · `DISABLED`
`EXECUTADA` · `TRANCADA` · `QUOTA` · `ERRO` · `NAO_EXECUTADA` · `PENDENTE`
`CONCLUIDA` · `PARCIAL` · `BLOQUEADA` · `ERRO` · `PENDENTE`
`NEW` · `REMOVED` · `CHANGED` · `UNCHANGED`

### Providers (resumo)

DataLikers (Instagram 20 + TikTok 10) · Apify (8 actors) · Bing RSS · Sherlock (481) ·
WhatsMyName (717) · Maigret (6206) · Blackbird · SpiderFoot · Photon · OpenOSINT ·
GHunt · Holehe · BYOK (Leak-Lookup, GitHub PAT, Shodan)

### Inconsistências a decidir (encontradas no código actual)

1. **Marca:** `ARGOS` na interface vs `ARGUS` no repositório e domínio.
2. **Idioma:** nomes de ecrã misturam português (`Painel`, `Histórico`, `Sessões`) e
   inglês (`Unified Profile`, `System Health`).
3. **Fontes:** CSS pede Geist / Geist Mono, nenhuma está incluída.
4. **Identidade visual:** OmniDork tem o seu próprio sistema (preto + verde neon),
   isolado do resto.
5. **Números de sites:** os comentários do código citam 481/717/6206 e o
   `health.ts` mostra 481/695/2113 — divergência entre o que a documentação diz e o
   que o ecrã de saúde apresenta.