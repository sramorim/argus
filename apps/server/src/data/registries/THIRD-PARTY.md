# Registos de sites de usernames (dados de terceiros)

Estes três ficheiros **não são código nosso**: são cópias exactas dos registos
públicos dos projectos OSINT que o módulo `username-intel` usa como providers.
Estão aqui por uma razão prática — sem os registos, cada ferramenta só podia
sondar as plataformas que alguém escrevesse à mão, e isso é o que produz
falsos positivos nos testes.

Cópias exactas (não editadas), fixadas ao commit indicado:

| Ficheiro | Projecto | Origem | Commit | Licença |
|---|---|---|---|---|
| `sherlock.json` | sherlock-project/sherlock | `sherlock_project/resources/data.json` | `e40a45ec2a074b90703b3b4b842c8a3adbd6ada3` | MIT |
| `whatsmyname.json` | WebBreacher/WhatsMyName | `wmn-data.json` | `062bcfe48df79fa618e96edc79dc9673f3fe5643` | CC BY-SA 4.0 |
| `maigret.json` | soxoj/maigret | `maigret/resources/data.json` | `b6642744988e7e6c2d21f75db60ec3093019ba25` | MIT |

## Obrigas de atribuição

- **MIT (Sherlock, Maigret)**: o aviso de copyright e a licença MIT têm de
  acompanhar qualquer cópia do software. Os ficheiros originais trazem a
  licença no repositório de origem; esta tabela regista a proveniência.
  Copyright (c) Sherlock Project; Copyright (c) 2020-2026 Soxoj (Maigret).
- **CC BY-SA 4.0 (WhatsMyName)**: atribuição obrigatória (Micah Hoffman e
  autores listados no próprio `wmn-data.json`), e qualquer *adaptação* do
  mesmo tem de ser distribuída sob a mesma licença. Aqui distribuímos a cópia
  **intacta** com a atribuição; o índice normalizado que o `username-intel`
  constrói em memória durante a execução **não** é distribuído como ficheiro.

## O que NÃO está aqui

- **Blackbird** (`p1ngul1n0/blackbird`): não tem registo de sites seu — lê o
  `wmn-data.json` do WhatsMyName à execução — e o repositório não tem licença
  de raiz coerente (CC BY-NC-SA em `.github/LICENSE`, GPL-3.0 em `docs/`).
  Por isso o provider `blackbird` do `username-intel` **não copia dados
  nenhum**: corre o binário isolado, se estiver instalado, e fica em
  `NOT_INSTALLED` caso contrário.
- **Outros registos**: nenhum. O que não está listado em cima não entra.

## Actualização

Para atualizar, refaça o download do commit novo, substitua o ficheiro sem o
editar, atualize o SHA nesta tabela e corra `npm run test:unit` (o teste de
regressão valida contagens mínimas por registo).
