# ARGUS — Como pôr online

Guia passo a passo. **Só precisas de fazer isto uma vez.** Cada passo diz o que fazer,
o que escrever e o que tem de aparecer no ecrã para saber que correu bem.

Se algo correr mal, o passo tem uma secção "se correr mal" com o que fazer.

---

## Passo 1 — Meter o código no GitHub

O Render só consegue construir o site se o código estiver no GitHub. Hoje a pasta
`probe/` **ainda não está lá**.

Abre o terminal e corre, **uma linha de cada vez**:

```bash
cd ~/central-amorim
git add probe/
git status
```

> **Olha para o ecrã antes de continuar.** Tens de ver uma lista de ficheiros a dizer
> `new file:` ou `modified:`. Confirma que **não aparece nenhum** ficheiro terminado em
> `.db` (base de dados) — se aparecer, pára e diz-me.
>
> Devem ser ~71 ficheiros.

Se estiver tudo certo:

```bash
git commit -m "ARGUS: plataforma OSINT com proveniencia, 26 ferramentas testadas"
git push origin main
```

> **Nota:** estamos na branch `main` e a mandar para `github.com/sramorim/central-amorim`.
> O Render vai ler exatamente esta branch. Não uses `git add .` — há outras alterações
> nesse projeto (o site principal) que são Separate e não entram aqui.

**Se correr mal:** se o `git push` pedir palavra-passe, o GitHub já não aceita a senha
normal. Vai a *Settings → Developer settings → Personal access tokens* e gera um token
com acesso ao repositório.

---

## Passo 2 — Criar o serviço no Render

1. Vai a **https://render.com** e entra na tua conta.
2. Clica em **New +** → **Blueprint**.
3. Escolhe o repositório **sramorim/central-amorim**.
4. O Render lê o ficheiro `probe/render.yaml` e mostra o plano. Confirma:
   - Region: **Oregon**
   - Instance type: **Starter** (o Free não tem disco, e nós precisamos do disco)
5. Clica **Apply**.

O Render vai pedir **dois valores secrets**:

| O que ele pede | O que escreves |
|---|---|
| `ARGUS_SECRET` | o resultado do comando do Passo 3 |
| `ARGUS_ADMIN_EMAILS` | o teu e-mail, ex. `teu@email.com` |

> Preenche o `ARGUS_ADMIN_EMAILS` já agora. É o que te dá acesso ao painel de
> administração sem precisar de mexer no banco.

O Render começa a construir. Demora **3 a 6 minutos**.

**Se correr mal:** se aparecer "Blueprint is invalid", o problema é usually o
`render.yaml`. Manda-me o erro.

---

## Passo 3 — Gerar o segredo

**Faz isto ANTES de escrever no passo 2**, porque o Render pede o valor.

```bash
openssl rand -hex 32
```

Vai aparecer uma linha tipo `a1b2c3d4...` (64 caracteres). **Copia-a.**

> **Guarda isto num sítio seguro** (notas do telemóvel, gestor de senhas). Se perderes
> esta chave: toda a gente que estiver com sessão iniciada é desligada, e as chaves de
> API que os utilizadores guardaram deixam de poder ser lidas. Não é grave, mas obriga
> a refazer.

---

## Passo 4 — Confirmar que o site arrancou

Espera o build terminar. Depois abre o endereço que o Render deu, do género:

```
https://argus.onrender.com
```

Deves ver a página do ARGUS a Loads: o olho vermelho, o título grande e os botões
**"criar conta grátis"**.

Confirma também, colando isto no browser (deve dar `{"ok":true,...}`):

```
https://argus.onrender.com/api/health
```

**Se correr mal:**

| O que vês | O que fazer |
|---|---|
| "503 Service Unhealthy" | O disco não montou. Abre o serviço no Render → **Disks** → confirma que `argus-data` está attached em `/var/data`. |
| "502" ou a página não abre | O build ou o arranque falhou. No Render: **Events** → vê a última linha do log. |
| A página abre mas dá 404 | O frontend não foi construído. Manda-me print do log. |

---

## Passo 5 — Criar a tua conta de administrador

1. No site que abriu no Passo 4, clica em **criar conta grátis**.
2. Regista-te **com o mesmo e-mail** que escreveste em `ARGUS_ADMIN_EMAILS`.
3. Entra. No canto esquerdo deve aparecer **Administração**.

É isso: a partir de agora és administrador.

> Se não aparecer "Administração", o e-mail não bateu exatamente com o que escreveste no
> Render. Confirma em **Render → o serviço → Environment**.

---

## Passo 6 — Ligar o teu domínio

Agora sim, o endereço oficial.

1. No Render, abre o serviço **argus** → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Escreve: `argus.senhoramorim.com.br`
3. O Render mostra um registo **CNAME**. Anota o valor (parece `argus.onrender.com` ou
   um código `cname.vercel-dns.com`).
4. Vai ao painel onde geres o DNS de `senhoramorim.com.br` e cria esse registo:
   - Tipo: **CNAME**
   - Nome: `argus`
   - Valor: o que o Render te deu
   - TTL: automático / 3600
5. **Espera de 5 minutos a 2 horas.** Depende de quanto tempo o teu provedor demora a
   atualizar.
6. Quando propagar, o Render emite o certificado TLS sozinho e o site passa a
   `https://argus.senhoramorim.com.br`.

**Se correr mal:** depois de 2 horas sem resolver, testa em
*https://www.nslookup.io* e vê o que aparece. Se aparecer "No A record", o teu painel de
DNS não tem o registo certo.

---

## Passo 7 — Verificar que está tudo bem

Faz isto a partir do site já com o teu domínio:

| Teste | Como | O que deve acontecer |
|---|---|---|
| Health | abre `/api/health` | `{"ok":true,"tools":26,...}` |
| Criar conta | regista um e-mail novo | Entra no site |
| Correr ferramenta | "Analisador de Domínio", escreve `github.com`, "investigar" | Aparecem achados + a tabela "Fontes" |
| Trancas | "Analisador de IP"... procura uma com cadeado | Diz que precisa de plano Pro |
| Móvel | abre no telemóvel | Menu de baixo, tudo cabe no ecrã |
| Partilhar | manda o link no WhatsApp | Aparece a imagem do ARGUS |

Se a ferramenta mostrar **"Fontes: 1 com problema"** — isso está certo e é honesto:
significa que uma das fontes não respondeu. O site está a mostrar a verdade, que é
exatamente o que prometemos.

---

## Se quiseres reverter

O site pode ser desligado sem perder nada: no Render, **Settings → Suspend**.
O disco e as contas ficam guardados. Para voltar, é só **Resume**.

---

## Resumo numa tela

```
1. cd ~/central-amorim
2. git add probe/  &&  git status      (confirma: sem .db)
3. git commit -m "ARGUS: plataforma OSINT"  &&  git push origin main
4. openssl rand -hex 32                 (anota o resultado)
5. render.com → New + → Blueprint → sramorim/central-amorim
   → ARGUS_SECRET = o do passo 4
   → ARGUS_ADMIN_EMAILS = o teu e-mail
   → Apply   (espera 3-6 min)
6. abre https://argus.onrender.com/api/health   →  {"ok":true,...}
7. regista-te no site com esse e-mail → deves ver "Administração"
8. Render → Settings → Custom Domains → argus.senhoramorim.com.br
9. cria o CNAME no teu painel de DNS → espera propagar
10. pronto: https://argus.senhoramorim.com.br
```

---

Se algum passo der erro, **manda-me a mensagem de erro tal e qual como aparece** e eu
digo-te o que fazer. Não é preciso tentar resolver sozinho.
