# ARGUS — Como pôr online

Guia passo a passo. **O código já está no GitHub**, em
**https://github.com/sramorim/argus** — o ARGUS vive na raiz desse repositório, sem
pasta nenhuma por fora.

Se cada passo corre bem, faz o seguinte. Se algum correr mal, o passo tem uma secção
"se correr mal" — ou manda-me o erro tal e como aparece.

---

## Passo 1 — Gerar o segredo

O Render vai pedir este valor, por isso foca-o **antes** de criar o serviço.

```bash
openssl rand -hex 32
```

Vai aparecer uma linha de 64 caracteres, tipo `a1b2c3d4e5f6...`. **Copia-a.**

> **Guarda isto num sítio seguro** (notas do telemóvel, gestor de senhas). Se perderes
> esta chave: quem estiver com sessão iniciada é desligado, e as chaves de API que os
> utilizadores guardaram deixam de poder ser lidas. Não é grave, mas obriga a refazer.

---

## Passo 2 — Criar o serviço no Render

1. Vai a **https://render.com** e entra na tua conta.
2. **New +** → **Blueprint**.
3. Escolhe o repositório **sramorim/argus**.
4. Confirma o plano que aparece:
   - Region: **Oregon**
   - Instance type: **Starter**
5. O Render pede **dois valores secrets**:

| O que ele pede | O que escreves |
|---|---|
| `ARGUS_SECRET` | o resultado do Passo 1 |
| `ARGUS_ADMIN_EMAILS` | o teu e-mail, ex. `teu@email.com` |

6. **Apply**.

O Render constrói. **3 a 6 minutos.**

> O `render.yaml` já está configurado com tudo o que é preciso: disco persistente de
> 1 GB montado em `/var/data`, o SQLite em `/var/data/argus.db`, cookies `Secure` e o
> domínio final. **Não precisas de inventar mais nada.**

---

## Passo 3 — Confirmar que arrancou

Abre o endereço que o Render deu, do género `https://argus.onrender.com`.

Depois confirma o estado técnico, colando isto no browser:

```
https://argus.onrender.com/api/health
```

Tem de aparecer:

```json
{"ok":true,"tools":26,...,"db":{"path":"/var/data/argus.db","writable":true}}
```

O `"writable":true` é o mais importante: diz que o disco está montado e a aceitar
escritas. Se aparecer `false`, os registos iam ser perdidos a cada deploy.

**Se correr mal:**

| O que vês | O que fazer |
|---|---|
| **"Root directory ... does not exist"** | Já está corrigido neste repositório. Faz *Sync* / *Redeploy* para puxar a versão nova. |
| "503 Service Unhealthy" | O disco não montou. Abre o serviço no Render → **Disks** → confirma que `argus-data` está *attached* em `/var/data`. |
| "502" ou não abre | O build ou o arranque falhou. Em **Events**, vê a última linha do log. |
| 404 | O frontend não foi construído. Manda-me o log. |

---

## Passo 4 — Criar a tua conta de administrador

1. No site, clica em **criar conta grátis**.
2. Regista-te **com o mesmo e-mail** que escreveste em `ARGUS_ADMIN_EMAILS`.
3. Entra. No canto esquerdo tem de aparecer **Administração**.

Se não aparecer, o e-mail não bateu exactamente. Confirma em **Render → argus →
Environment**.

---

## Passo 5 — Ligar o teu domínio

1. Render → serviço **argus** → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Escreve `argus.senhoramorim.com.br`.
3. O Render dá um registo **CNAME**. Anota o valor.
4. No painel onde geres o DNS de `senhoramorim.com.br`, cria:
   - Tipo: **CNAME**
   - Nome: `argus`
   - Valor: o que o Render te deu
   - TTL: automático
5. **Espera de 5 minutos a 2 horas**, conforme o teu provedor.

O Render emite o certificado TLS sozinho assim que o domínio resolver.

**Se correr mal:** depois de 2 horas, testa em *https://www.nslookup.io*. Se disser
"No A record", o registo no teu painel de DNS está mal criado.

---

## Passo 6 — Verificar que está tudo bem

| Teste | Como | O que deve acontecer |
|---|---|---|
| Health | `/api/health` | `{"ok":true,"tools":26,...}` |
| Criar conta | regista um e-mail novo | Entra no site |
| Correr ferramenta | "Analisador de Domínio" → `github.com` → *investigar* | Achados + tabela "Fontes" |
| Trancas | procura uma ferramenta com cadeado | Diz que precisa de plano Pro |
| Administrador | menu lateral | "Administração" aparece |
| Telemóvel | abre no telemóvel | Barra de baixo, tudo cabe |
| Partilhar | manda o link no WhatsApp | Aparece a imagem do ARGUS |

> Se uma ferramenta mostrar **"fontes: 1 com problema"**, **está certo**. Significa que
> uma das fontes não respondeu, e o site está a mostrar a verdade em vez de a esconder.

---

## Resumo numa tela

```
1. openssl rand -hex 32                       (anota o resultado)
2. render.com → New + → Blueprint → sramorim/argus
     ARGUS_SECRET      = o valor do passo 1
     ARGUS_ADMIN_EMAILS= o teu e-mail
     Region Oregon · Starter · Apply        (espera 3-6 min)
3. abre https://argus.onrender.com/api/health   →  {"ok":true,"tools":26,...}
4. regista-te no site com esse e-mail        →  deve aparecer "Administração"
5. Render → Settings → Custom Domains → argus.senhoramorim.com.br
6. cria o CNAME no teu painel de DNS → espera propagar
7. pronto: https://argus.senhoramorim.com.br
```

---

## Quando quiseres desligar

Render → **Settings → Suspend**. O disco e as contas ficam guardados. Para voltar,
**Resume**.
