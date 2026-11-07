# Modelo de projeto: portal e dashboards

Projeto completo, para copiar e adaptar. Todo projeto tem um **portal**: a página de login e um painel com um cartão para cada dashboard, mesmo com um só. O exemplo traz um dashboard, a produção agrícola do Brasil por lavoura, UF e ano, com dados públicos do IBGE (Produção Agrícola Municipal, tabela 5457). Dashboard novo entra no mesmo portal, com o mesmo login.

Valores nominais, sem correção pela inflação. Este projeto não tem relação com o IBGE.

## Como o projeto é organizado

```text
server/                 o portal: servidor, login, administração, agente (laço comum) e banco
  dashboards.ts         a lista dos dashboards do projeto
web/src/                a tela do portal (login, painel, administração) e os componentes comuns
  dashboards.ts         a lista das telas dos dashboards
dashboards/<slug>/      um dashboard inteiro, em uma pasta própria:
  dashboard.ts          a descrição para o portal: cartão, recorte de acesso (as UFs), agente, como abrir as consultas
  db.ts                 onde moram os dados: schema do Postgres e tabelas de cada função
  domain/ load/ agent/  consultas e rotas, carga e agente
  sql/                  tabelas e permissões, no Postgres e no SQLite
  web/                  a tela
  scripts/ test/        as provas e os testes dele
scripts/                npm run db, load, thumbnail e as provas do projeto
```

O servidor é um só, e o banco também. Cada dashboard tem endereço próprio, `/d/<slug>` na tela e `/api/d/<slug>/...` na API, e dados próprios.

## Rodar o exemplo

Precisa de Node 24 ou mais novo, ou da versão da seção "Escolher o banco" para usar SQLite. Nada é instalado fora desta pasta: o Postgres de desenvolvimento fica em `node_modules` e `.data`.

```bash
npm install

# Terminal 1: cria o banco e o .env na primeira vez. Deixe aberto.
npm run db

# Terminal 2: busca os dados no IBGE, cerca de 1 minuto, tira a miniatura do cartão e gera a tela.
npm run load
npm run build
npm start
```

Abra `http://127.0.0.1:8787`. Com `AUTH_MODE=local`, que é o padrão do `.env` de desenvolvimento, não há login, e o painel mostra todos os dashboards. Para ver o portal de verdade, ponha `AUTH_MODE=login`: o primeiro acesso cria o login do administrador (veja "Login"). Para ver o agente com o modelo simulado, acrescente `AGENT_PROVIDER=simulado` ao `.env` e reinicie o `npm start`.

Para alterar o código com a tela recarregando sozinha, use `npm run api` em um terminal e `npm run web` em outro, com o endereço que o segundo mostrar.

`npm run db` cria o que falta: o schema do portal e o de cada dashboard, com os usuários de banco. Rodar de novo, com o banco no ar, só acrescenta o que faltar, como o schema de um dashboard novo. Se uma tabela mudar, pare o banco, apague `.data` e `.env` e repita os passos: em desenvolvimento, nada ali é insubstituível. A porta do Postgres de desenvolvimento é `DEV_DB_PORT` (padrão 54329), escolhida na primeira execução: dois projetos na mesma máquina precisam de portas diferentes.

Em produção, use um Postgres com ICU, para os nomes saírem em ordem de dicionário, e crie, com o usuário dono: `server/sql/portal_schema.sql` e `portal_grants.sql` no schema `portal`, e, em cada dashboard, `sql/001_schema.sql` e `sql/002_grants.sql` no schema dele. Os usuários são `dash_auth` e `dash_portal` (portal) e `<schema>_reader` e `<schema>_loader` (um par por dashboard). O Postgres de desenvolvimento usa o pacote `embedded-postgres`, em versão beta, só para desenvolver.

## Portal

- **Login:** a página de entrada, o primeiro acesso, a troca de senha e o título da aba usam o nome do projeto (`web/src/project.ts` e `index.html`), nunca o de um dashboard. `test/project-name.test.ts` reprova se o nome de um dashboard aparecer nessas telas.
- **Painel (`/`):** um cartão para cada dashboard que a pessoa pode ver, com o nome, uma frase do que o dashboard responde, a fonte, a data da última atualização e a miniatura. Quem não tem nenhum vê uma explicação.
- **Miniatura:** a foto real da tela, tirada depois de cada carga (`npm run load` já chama) ou à mão (`npm run thumbnail`, ou `npm run thumbnail -- <slug>`). Usa o Edge, ou outro navegador baseado em Chromium, já instalado na máquina, em modo invisível: `--headless=new --screenshot`, sem instalar nada. Aponte `BROWSER_EXE` para outro. Sem navegador, o cartão fica sem imagem. Como o navegador não faz login, o script sobe por alguns segundos um servidor só desta máquina, em modo local, com o mesmo banco. A foto fica em `.data/thumbs`, fora do git, e só é servida a quem tem acesso àquele dashboard, depois do login.
- **Acesso por dashboard e por recorte:** o administrador abre `Administração` e cria a pessoa com uma senha provisória, que aparece uma vez. Nela, usa o botão `Dashboards e acessos` e marca quais dashboards ela vê. Num dashboard com recorte (aqui, as UFs), escolhe todos os itens ou só alguns, com o nome que o dashboard deu a eles; num dashboard sem recorte, só "sem acesso" ou "com acesso". Também tira o acesso, desativa, reativa e redefine a senha. A pessoa troca a senha provisória no primeiro acesso, e até lá não vê mais nada. O administrador vê todos os dashboards, inteiros. Só ele abre essa tela e as rotas dela, e escrever pede o token CSRF.
- **Dashboard sem acesso:** responde 404, igual a um dashboard que não existe, na tela, na API e na miniatura. O painel só mostra os cartões permitidos.
- **Categorias:** definidas na administração, e não no código. O administrador cria, renomeia, ordena e apaga categorias (só vazia) e escolhe a de cada dashboard. O painel agrupa os cartões por categoria e só põe título de seção quando a pessoa vê mais de uma; sem categoria, vai para "Sem categoria", por último. Na tela de uma pessoa, a categoria é um atalho que grava acesso por dashboard. Um banco que já existe ganha as tabelas com `npm run db` (ou `portal_upgrade_categories.sql`), sem apagar pessoas nem acessos. Prova: `test/categories.test.ts`.
- **Agente:** o provedor é um só por projeto, no `.env`. Cada dashboard diz, no cartão (`card.agent`), se tem agente: só nos que têm aparece o botão do chat, e só eles aceitam `/api/d/<slug>/agent`. O agente de um dashboard usa só as ferramentas dele, com a permissão de quem pergunta, e nunca alcança outro dashboard.
- **O portal não tem versão estática.** O site estático de um dashboard continua só para dado público (veja "Site estático").

## Acrescentar um dashboard

Um dashboard novo é uma pasta, com poucos passos no resto do projeto. Antes, siga a skill `dash-plano`.

1. **Copie a pasta de um dashboard parecido** para `dashboards/<slug>`. O `slug` vai no endereço: letras minúsculas, números e hífen. Troque os nomes e apague o que não vale.
2. **Descreva o dashboard** em `dashboards/<slug>/dashboard.ts`: o cartão (`name`, `question`, `source` e `agent`, se tem agente), o recorte de acesso, se houver (`scope`: veja "Recorte de acesso", abaixo), onde moram os dados (`db.ts`), como criar o arquivo no SQLite (`sqlite`) e como abrir as consultas (`open`).
3. **Dados:** escreva `sql/001_schema.sql` e `002_grants.sql` (as tabelas sem prefixo de schema, e as permissões para `<schema>_reader` e `<schema>_loader`), a versão em SQLite, a carga em `load/run.ts` e as consultas em `domain/`. As consultas nunca citam outro schema nem o portal.
4. **Tela:** `web/index.tsx` exporta o `view` (título, tela principal, conferência e textos do agente). As chamadas à API usam caminhos sem barra no começo, como `usePanel("summary", query)`: o portal põe o `/api/d/<slug>/` na frente.
5. **Registre** em dois lugares: a lista do servidor, `server/dashboards.ts`, e a das telas, `web/src/dashboards.ts`.
6. **Crie o que falta no banco** com `npm run db` (com o banco no ar, ele só acrescenta) e **carregue** com `npm run load -- <slug>`, que já tira a miniatura.
7. **Dê acesso:** entre como administrador e, em `Administração`, marque o dashboard para quem vai usá-lo.
8. **Prove:** `npm test` (a varredura e os testes de separação já cobrem o dashboard novo), as provas da pasta dele (`npm run dash -- check <slug>`) e o uso real no navegador, com pessoas de acessos diferentes. Veja a skill `dash-validar`.

Os comandos que variam por dashboard têm a forma `npm run dash -- <comando> <slug>`: o comando é o nome de um arquivo em `dashboards/<slug>/scripts` (`check`, `check-security`, `check-login`...). Sem o slug, roda em todos os que o têm.

## Recorte de acesso

Um dashboard pode limitar o que cada pessoa vê por um recorte: estado, fazenda, unidade. O recorte é opcional e tem nome próprio, que a administração, as mensagens e a instrução do agente usam. Ele é declarado em `dashboard.ts`:

```ts
scope: {
  label: { singular: "fazenda", plural: "fazendas", gender: "f" }, // "f" ou "m": "Todas as fazendas", "Todos os talhões"
  items: [{ code: "01", name: "Fazenda Norte" }, { code: "02", name: "Fazenda Sul" }],
},
```

No exemplo, `domain/filters.ts` exporta o recorte das UFs (`SCOPE`), e `dashboard.ts` o usa. Sem `scope`, o dashboard tem só acesso "com" ou "sem".

- **O que a consulta recebe** continua sendo uma lista de códigos (`string[]`). Com recorte, é a lista da pessoa, sem repetidos e só com códigos que o dashboard conhece; com acesso total, todos. Sem recorte, é sempre `[]`: uma consulta que filtrasse por ela por engano não traria nada, e nada vazaria. Permissão vazia nunca vira acesso a tudo.
- **Uma regra só** decide a permissão (`grantedScope`, em `server/auth.ts`), e o servidor, a administração e as provas a usam. Num dashboard sem recorte, só o acesso total vale: uma linha parcial não dá acesso.
- **O servidor não sobe** se um dashboard ainda declara `states` (a mensagem diz o que trocar), se o recorte não tem itens, se um código se repete ou está vazio, ou se o nome do recorte está incompleto. `create-user` e `npm run check:login` fazem a mesma conferência.
- **No banco**, as colunas `full_access` e `state_codes` continuam: `state_codes` guarda os códigos do recorte, qualquer que seja o nome dele, e o nome vem da primeira versão do portal.

**Migrar um projeto que já existe.** Não há SQL a rodar: pessoas, sessões e acessos ficam como estão.

- Troque `states: X` por `scope: { label, items: X }` em cada dashboard. Sem isso, o servidor não sobe e diz por quê. Nas consultas, nada muda para um dashboard que ficou com recorte.
- Um dashboard que **perde o recorte** não aceita mais acessos parciais: quem tinha um acesso parcial passa a receber "não encontrado" (o lado seguro), e a administração mostra "Sem acesso". Marque "Com acesso" para quem deve continuar a vê-lo.
- Um dashboard que **ganha um recorte**: quem tinha acesso fica com acesso total. Revise a administração e limite quem precisa.
- Se o código chamava `scopeOf` ou lia `states` de um acesso, use `grantedScope` e `codes`. O corpo de `set-access` mudou de `states` para `codes`, e o modo `states` virou `some`.

## Dados separados por dashboard

Cada dashboard tem o próprio conjunto de dados, e eles nunca se misturam. Quem garante é o banco, e não só a organização das pastas:

| | Postgres | SQLite |
|---|---|---|
| Onde moram | Um schema por dashboard, e um para o portal | Um arquivo por dashboard (`.data/<slug>.sqlite`) e um para o portal (`.data/portal.sqlite`) |
| Quem lê e quem carrega | `<schema>_reader` e `<schema>_loader`, só com permissão no schema do dashboard. O endereço de cada um está em `<SCHEMA>_DATABASE_URL` e `<SCHEMA>_LOAD_DATABASE_URL` | Uma conexão por dashboard, que abre só o arquivo dele, com `ATTACH` proibido e uma lista de permissões |
| Portal | `dash_auth` (login) e `dash_portal` (administração), sem acesso aos dados dos dashboards | O mesmo, por conexão |

- Nenhuma tabela é compartilhada. A área comum guarda só o portal: pessoas, sessões e acessos.
- Uma consulta errada de um dashboard não lê o outro: o banco recusa. A carga de um só grava no schema ou arquivo dele. O agente, a miniatura, a conferência e o site estático de um dashboard só tocam os dados dele.
- **Ler dados de dois dashboards pode existir no futuro, mas não existe hoje.** Quando existir, tem de ser declarado de forma explícita na descrição do dashboard que consome (`dashboard.ts`), com a permissão de leitura correspondente no banco, e documentado aqui. O lugar previsto é o campo de leitura de `db.ts` e as permissões de `sql/002_grants.sql`.
- **Provas:** `test/isolation.test.ts`, nos dois motores, com dois dashboards de exemplo: a leitura de um é recusada ao ler o schema ou o arquivo do outro, a carga de um não grava no outro, uma varredura confirma que as consultas de cada dashboard só citam o schema dele, e o agente de um só vê os dados dele. Com `SABOTAR_ISOLAMENTO=1`, o teste do Postgres precisa reprovar.

## Escolher o banco

O padrão é o Postgres. Sem nenhum banco disponível, use o SQLite: um arquivo por dashboard e um para o portal, na pasta `.data`, ignorada pelo git, sem servidor nem porta. As mesmas telas e conferências rodam nos dois, com agente e login. Quem escolhe é o `.env`:

| `DB_ENGINE` | Banco |
|---|---|
| Vazio ou `postgres` | Postgres, como nos passos acima |
| `sqlite` | Os arquivos em `SQLITE_DIR` (vazio usa `DATA_DIR`, que usa `.data`): `portal.sqlite` e `<slug>.sqlite` |
| Outro valor | O servidor não sobe e diz por quê |

```bash
npm install
cp .env.example .env     # e defina DB_ENGINE=sqlite

npm run db      # cria os arquivos e as tabelas, e termina. Sem embedded-postgres.
npm run load    # busca os dados no IBGE e tira a miniatura
npm run build
npm start
```

O SQLite usa o `node:sqlite`, que já vem no Node, sem dependência nova. As provas rodaram no Node 26.13. Em uma versão sem `setAuthorizer`, ele recusa abrir o banco, porque a permissão por conexão é parte da segurança.

Antes de usar em dados reais, repare em **Limites do SQLite**, abaixo.

### Os mesmos números

Para os mesmos dados, a API responde igual nos dois, byte a byte. `npm run check:engines` compara.

- **Dinheiro em inteiro:** o SQLite não tem decimal exato. Valor, quantidade e área ficam em inteiro, e a tabela `numeric_scale` guarda quantas casas cada coluna tem: `1234,50` é `123450`, com 2 casas. A saída é o mesmo texto do Postgres: `1234.50`.
- **Somas:** o `SUM` do SQLite dá erro ao passar de 64 bits. As consultas usam `dec_sum`, com `BigInt`, sem limite. Uma linha, sim, precisa caber em 64 bits: com 2 casas, até R$ 92 quatrilhões. Linha maior, ou com casas a mais, é recusada na carga, sem arredondar.
- **Participação e variação:** `dec_div` e `dec_variation`, em `server/db/decimal.ts`, refazem em `BigInt` a divisão do `NUMERIC` do Postgres: a mesma escala do resultado e o mesmo arredondamento, com a metade para longe do zero. Nenhuma passa por ponto flutuante, nem a dica do mouse muda. `npm test` compara com o próprio Postgres, em milhares de pares sorteados.
- **Ordem alfabética:** o SQLite não tem a ordem do português, e o `node:sqlite` não deixa criar uma. O JavaScript põe os nomes em ordem de dicionário com `Intl.Collator`, e a consulta recebe a lista em um parâmetro. Empate em valor tem desempate fixo, nos dois motores.

**Duas diferenças aceitas:**

- Com o Postgres em `NUMERIC` sem limite, como `npm run check:month` faz para o CSV da Receita, o texto guarda as casas de cada linha (`1234.5`). O SQLite tem uma escala só por coluna (`1234.5000`). O número é o mesmo, e a tela mostra o mesmo. Com `NUMERIC(20,4)` no Postgres, o texto também é igual.
- Um login com o caractere nulo responde 500 no Postgres, que recusa esse byte, e 401 no SQLite. Nos dois, ninguém entra.

**A verificar em outros dados:** a ordem depende de dois ICUs diferentes, o do Postgres e o do Node. A comparação prova que dão a mesma ordem nos nomes do exemplo e do CSV. Um alfabeto muito diferente pede a mesma prova.

### Segurança sem usuários de banco

O SQLite não tem usuários. O modelo faz a mesma separação das permissões do Postgres por conexão, em `server/db/open.ts` e `server/db/sqlite.ts`:

| Conexão | Pode | Como |
|---|---|---|
| Consulta de um dashboard, inclusive o agente | Só ler as tabelas de dados do arquivo dele | Arquivo aberto com `readOnly`, `PRAGMA query_only`, lista de permissões e `ATTACH` proibido |
| Carga de um dashboard | Escrever só nas tabelas de dados e no log do arquivo dele | Lista de permissões |
| Login | Ler pessoas e acessos; ler, criar e apagar sessões | Lista de permissões, no arquivo do portal |
| Administração | Criar e alterar pessoas e acessos; apagar sessões | Lista de permissões, no arquivo do portal |
| Primeiro login | Só criar a primeira pessoa, em uma conexão aberta e fechada em seguida | Lista de permissões |

`npm test` e `npm run check:security` provam, inclusive com o hash do arquivo. O que isso **não** cobre: quem abre o arquivo com outro programa passa por cima de tudo. Proteja a pasta, com acesso só para quem administra. No Postgres, essa barreira é o próprio servidor.

### Limites do SQLite

- **Bloqueia o processo:** o `node:sqlite` é síncrono. Enquanto uma consulta roda, o servidor não atende mais ninguém. Atende bem uma máquina, com poucas pessoas. Para um servidor com muitos usuários, use o Postgres.
- **Um escritor por vez:** a carga e as sessões de login se revezam, com espera de até 5 segundos, também bloqueando o processo. Quem lê não espera: vê o dado anterior até o fim da carga.
- **Sem limite de tempo por consulta:** no Postgres há `statement_timeout`. No SQLite, a consulta vai até o fim.
- **Um disco local:** fora de pasta de rede, por causa do modo WAL. Para copiar, pare o servidor antes: `-wal` e `-shm` acompanham o arquivo.

Tempos medidos em uma máquina de desenvolvimento, de uma pergunta por vez, com todas as consultas da rota (mediana de 5, em milissegundos):

| Rota | Exemplo, 8.897 linhas: Postgres | SQLite | CSV mensal, 233.469 linhas: Postgres | SQLite |
|---|---|---|---|---|
| Cartões, todos os anos | 7 | 5 | 216 | 348 |
| Cartões, um ano | 4 | 2 | 16 | 44 |
| Por lavoura, todos os anos | 4 | 5 | 58 | 182 |
| Seletores, todos os anos | 12 | 9 | 472 | 458 |
| Detalhe, todos os anos | 8 | 6 | 125 | 145 |
| Detalhe em ordem de lavoura, todos os anos | 9 | 26 | 137 | 720 |

No exemplo, o SQLite não faz diferença. Com 233 mil linhas, a mais pesada bloqueia o processo por 0,7 s, e as rotas se somam, porque ele atende uma de cada vez: ao trocar um filtro, a tela leva cerca de 0,4 s em um ano e mais de 1 s em todos os anos. O número certo chega, só que depois: no navegador, a tela já mostrou o título anterior por mais tempo do que no Postgres.

### Falhas

Motor desconhecido impede o servidor de subir. Arquivo ausente ou sem tabelas não derruba nada: o servidor sobe, avisa no terminal, e a tela diz em português o que falta, sem caminho nem SQL (resposta 503). Depois de `npm run db` e `npm run load`, a tela funciona sem reiniciar.

### Adaptar em SQLite

A cada tabela nova, atualize `dashboards/<slug>/sql/sqlite_schema.sql` e as listas de tabelas em `db.ts`. Cada coluna decimal entra em `numeric_scale`. O que muda entre os motores está lado a lado: `POSTGRES` e `SQLITE`, em `dashboards/<slug>/domain/queries.ts`; `postgresStore` e `sqliteStore`, em `dashboards/<slug>/load/store.ts`. Um dashboard que ainda só roda em Postgres, como a arrecadação do projeto de exemplo, diz isso à pessoa em vez de responder errado. Quem só usa Postgres pode ignorar esses trechos.

## Conferir

| Comando | O que prova | Precisa de |
|---|---|---|
| `npm test` | O portal, com dois dashboards de exemplo escritos à mão (cartões, permissões por dashboard e por recorte, dashboards sem recorte e com nomes de recorte diferentes, administração, senha provisória, miniatura, primeiro acesso), a separação dos dados nos dois motores, o nome do projeto no login, formatos, filtros, regras da tela, leitura da fonte, travas do agente, escala de cores do mapa, códigos dos contornos, o site estático, a carga e as consultas nos dois motores, e o servidor com login em uma porta livre, com poucas linhas escritas à mão | Nada: sem rede, dado real ou credencial. O SQLite usa um arquivo temporário. O Postgres é um `embedded-postgres` descartável, em uma pasta temporária; se ele não subir, a saída avisa e só o SQLite roda |
| `npm run typecheck` | Tipos | Nada |
| `npm run check` | Números da API de cada dashboard contra a fonte, lida direto por um caminho separado da carga. No exemplo, o total do Brasil no IBGE. Com `-- <slug>`, só de um | Servidor no ar em modo local (`DASHBOARD_URL`) e internet |
| `npm run check:security` | Travas do banco: o que cada função (consulta de cada dashboard, carga, login, administração) pode e não pode tocar, inclusive o portal e os outros dashboards; em SQLite, conexão sem escrita e arquivo intacto. `npm run dash -- check-security <slug>` prova as travas de rota e consulta de um dashboard: permissão vazia sem linhas, parâmetro desconhecido recusado | Banco no ar (e, para o do dashboard, servidor em modo local) |
| `npm run check:agent` | O conjunto de perguntas com o modelo real, para conferir à mão | Banco no ar e chave de API. Gasta créditos |
| `npm run check:login` | Portal com login, com pessoas temporárias apagadas ao final: cartões só dos dashboards permitidos, 404 igual para o que não existe, administração só para o administrador, senha provisória, CSRF, sessão vencida, limite de tentativas. `npm run dash -- check-login <slug>` prova a permissão pelo recorte dentro de um dashboard. Num projeto sem nenhum dashboard com recorte, a prova do acesso parcial é pulada, com aviso | Banco no ar, ou os arquivos em SQLite |
| `npm run check:engines` | Postgres contra SQLite, para o dashboard que roda nos dois: carrega os mesmos dados, compara as respostas da API byte a byte e exige 0 diferenças. Apaga o que cria. Com `-- --sabotar`, muda 1 centavo, para provar que reprova | Postgres de desenvolvimento no ar, com os dados carregados. Com `MONTH_CSV`, acrescenta o CSV mensal |
| `npm run check:static` | Para o dashboard que tem site estático: cada arquivo do site estático contra a API, byte a byte, os totais contra os do IBGE guardados pela carga, os cliques da tela, com agrupamento, ordem e página da tabela, e a varredura. Com `-- --sabotar`, troca 1 byte, para provar que reprova | Site gerado, banco e servidor no ar. Não usa a internet |
| `npm run outlines` | Não confere: baixa de novo os contornos do mapa da API do IBGE e recusa o arquivo sem as 27 UFs. Só usa a rede quando chamado | Internet |
| `npm run check:month -- arquivo.csv` | Ferramenta de prova do kit, fora de qualquer dashboard: com o mês ligado, a API contra a soma feita direto em um CSV mensal da Receita, usando a estrutura do exemplo em um schema ou arquivo temporário, apagado ao final. Não toca nos dados de nenhum dashboard | Banco no ar e uma cópia local do CSV, fora do repositório. O caminho também pode vir de `MONTH_CSV` |
| `npm run thumbnail` | Não confere: tira a miniatura de cada cartão, em navegador invisível | Um navegador baseado em Chromium na máquina |

Todas valem para os dois motores, quando o dashboard roda nos dois: para testar em SQLite, passe `DB_ENGINE=sqlite` e, no servidor no ar, `DASHBOARD_URL`. **As provas de tela rodam em navegador invisível**, e nenhum processo de prova abre janela.

Na tela, a **Conferência** de cada dashboard compara os números dele com a fonte. No exemplo, o total do Brasil publicado pelo IBGE, ano a ano.

## Cuidados com estes dados

- **Valor nominal:** sem correção pela inflação.
- **Valor resumido:** cartões, gráficos e tabelas mostram `R$ 3,40 M`. O valor exato fica na dica do mouse e na Conferência.
- **Abertura:** no ano mais recente. "Todos os anos" soma os anos e fica marcado como acumulado.
- **Área:** só aparece com um ano escolhido, porque somar anos conta a mesma terra de novo.
- **Quantidade:** só aparece com uma lavoura escolhida, porque a fonte não publica o total em toneladas e a soma engana.
- **Abacaxi e coco-da-baía:** têm uma nota da fonte que não pudemos ler, e a unidade fica como a verificar.
- **2025:** a fonte traz 14 lavouras novas e tira 7, e a tela avisa quando a variação não compara a mesma lista.
- **Mapa:** o valor de cada UF vem da mesma consulta do gráfico por UF. As faixas de cor reúnem um número parecido de UFs, então duas faixas vizinhas podem ter distâncias bem diferentes: leia o limite na legenda.

## Adaptar para os seus dados

O que é específico do exemplo está na pasta do dashboard, `dashboards/producao-agricola`:

| Trocar | Onde |
|---|---|
| Leitura da fonte e carga | `load/` |
| Tabelas | `sql/`, com uma versão para cada motor |
| Filtros, consultas e rotas | `domain/`, e a lista de rotas em `dashboard.ts` |
| Ferramentas e instrução do agente | `agent/tools.ts` e `agent/prompt.ts` |
| Telas, gráficos e textos do "i" | `web/` |
| Cartão do portal | `card`, em `dashboard.ts` |
| Contornos do mapa | `web/ufs.geo.json` e `scripts/outlines.ts` |
| O que o site estático publica | `shared/staticSite.ts` e `scripts/static-tools.ts` |
| Marca, cores e fontes | Bloco `:root` de `web/src/theme.css` |
| Nome do projeto | `web/src/project.ts` e `index.html` |

Crie o projeto novo em uma pasta própria, como cópia de `modelo/`, com git próprio. A porta do Postgres de desenvolvimento é `DEV_DB_PORT`, e as outras portas estão em `scripts/check-*.ts` e `vite.config.ts` e no `.env`. O restante serve para qualquer dashboard: `shared/format.ts`, `shared/filters.ts`, `server/`, `web/src/hooks.ts`, `web/src/components` e `web/src/portal`.

Antes de adaptar, siga a skill `dash-plano`.

## Ligar o mês

O exemplo é anual, e o mês fica desligado: `mes` é recusado como filtro desconhecido, e nada na tela o menciona. Se os seus dados são mensais:

1. Com a tabela vazia, rode `dashboards/producao-agricola/sql/optional_month.sql` com o usuário dono das tabelas, que acrescenta a coluna `month`. Com valores de mais de 2 casas, como no CSV da Receita, `value_brl` precisa ser `NUMERIC` sem limite, senão a soma arredonda: `ALTER TABLE production ALTER COLUMN value_brl TYPE NUMERIC`.
2. Faça a leitura da fonte, em `dashboards/producao-agricola/load`, trazer o mês: cada linha de `production` ganha `month`, de 1 a 12. A fonte do exemplo é anual e não traz. A carga grava o mês nos dois motores e recusa a mistura, sem perder o dado anterior: linha sem mês, se a coluna existe, e linha com mês, se ela não existe. Por isso, o `npm run load` do exemplo é recusado com a coluna, até a leitura trazer o mês.
3. No `.env`, defina `MONTH_FILTER=on` e reinicie o servidor. Sem a coluna, ele não sobe, e diz por quê.

Em SQLite, antes de `npm run db`, defina `MONTH_FILTER=on` no `.env`, e `SQLITE_VALUE_SCALE=4` se o valor tiver 4 casas. O `npm run db` aplica `dashboards/producao-agricola/sql/sqlite_optional_month.sql` e guarda a escala. Se o arquivo já existir, apague-o e repita. Depois, siga o passo 2.

Com o mês ligado:

- **Filtro:** `?ano=2026&mes=9` na URL. O seletor traz só os meses do recorte, e clicar em um mês no gráfico faz o mesmo. O mês sempre vai com o ano: mês sem ano é recusado, e mês que não está na base também.
- **Gráficos:** o de anos mostra todos os anos e marca o incompleto, como "até set". O de meses mostra o ano escolhido e destaca o mês. Mês sem dado no recorte fica com um traço.
- **Comparação:** o ano anterior entra só com os mesmos meses. Se ele tem menos meses com dado, a variação fica como `—`, e o cartão diz quantos.
- **Títulos e tabela:** dizem o período, como `set/26` ou `2026, jan a set`. Com meses faltando no meio, dizem quantos têm dado, como `2017, 10 meses`. O detalhe troca a coluna Ano por Mês e ganha "Por mês".
- **Área:** só aparece com um mês escolhido, porque somar meses conta a mesma terra de novo. Se a sua medida é um fluxo, que soma, ajuste `areaFits` em `dashboards/producao-agricola/domain/filters.ts`.
- **Agente:** respeita o mês da tela. Para o modelo perguntar por outro mês, acrescente `mes` às ferramentas em `dashboards/producao-agricola/agent/tools.ts`.

## Mapa

O bloco do mapa usa MapLibre só com os contornos das UFs, guardados em `dashboards/producao-agricola/web/ufs.geo.json`. Não há mapa de ruas, serviço externo nem conta, e abrir o mapa não faz nenhuma chamada para fora do próprio servidor.

- **Contornos:** malha de UFs da API de malhas do IBGE, na qualidade mínima, a mais simplificada que ela publica, com as coordenadas em 3 casas. O endereço e a data do download ficam no campo `source` do arquivo. Os códigos são os mesmos do banco, e `npm test` compara as 27 UFs.
- **Cores:** zero tem o tom mais claro, e negativo, a cor de sentido do tema, com entrada própria na legenda, só quando existir. A legenda é uma escala de cores: não filtra e não parece clicável.
- **Clique:** filtra os outros blocos. O mapa continua inteiro, com o estado em destaque, e o segundo clique, no mesmo lugar, retira: nada sob o mouse se desloca, nem os rótulos. Quem usa o teclado tem um seletor, que aparece com o foco.
- **Valores:** sigla e valor em R$ resumido sobre o mapa. Na largura de um celular, os estados pequenos ficam sem valor no mapa, e ele aparece no toque e no gráfico por UF.
- **Falha:** sem WebGL, o bloco mostra um aviso, e o resto do dashboard funciona.
- **Tamanho:** o MapLibre e os contornos ficam em pedaços separados, baixados quando o bloco aparece: cerca de 1,75 MB, ou 470 KB comprimidos, além dos 2 MB que a tela já tinha. O pedaço principal cresce 4 KB. Um dashboard sem `MapBlock` não leva nada disso. O dashboard de exemplo baixa os pedaços ao abrir, porque o bloco faz parte da tela.

Para outro mapa, troque o GeoJSON e as propriedades: veja `.claude/skills/dash-tela/references/mapa.md`.

## Site estático

A tela de um dashboard, sem portal, servidor nem banco na hora de abrir, em uma pasta de arquivos. Cada dashboard decide se tem site estático: no exemplo, só a produção agrícola, e `npm run build:static -- <slug>` gera o dele, com só o que é dele. **Só para dado público:** todo arquivo gerado pode ser baixado por qualquer pessoa, mesmo que nenhuma tela o mostre. Dado interno exige o servidor com login, e com `AUTH_MODE=login` o gerador não roda. Ele só escreve na pasta `dist-static`, ignorada pelo git: nada é publicado.

```bash
npm run build:static   # lê do banco do .env, Postgres ou SQLite. Cerca de 5 minutos no exemplo. Só de dashboards que têm site estático.
npm run check:static   # com o servidor no ar, compara cada arquivo com a API. Cerca de 4 minutos.
```

Para abrir, sirva a pasta com qualquer servidor de arquivos, também em subpasta, porque os caminhos são relativos. O navegador não carrega a tela direto do disco (`file://`), e a página diz isso. No Windows, `python -m http.server` tem uma fila de conexões curta e às vezes recusa quando a tela pede vários arquivos juntos: o bloco avisa, com "Tentar de novo". Para gerar em outra pasta, use `-- --pasta=caminho`, nos dois comandos. O gerador só troca uma pasta que não existe, vazia ou gerada por ele, só com os arquivos do site e o índice dele. Ele recusa o resto, sem apagar nada, inclusive a raiz do disco, a pasta do projeto e qualquer antepassada dela.

**Como funciona.** Cada arquivo é a resposta da API para a mesma consulta, gerada pelas mesmas rotas (`dashboards/producao-agricola/domain/routes.ts`), e o nome é o próprio texto de `panelQuery`: `dados/summary/ano=2024&uf=41.json`. Os componentes são os mesmos. O que muda é a camada que busca, em `web/src/api.ts` e no leitor de cada dashboard (`web/staticReader.ts`), e os controles que levariam a um resultado não publicado, que ficam desligados. Com `__STATIC_SITE__`, uma constante da hora de gerar a tela, o agente, o login e a conferência saem do pacote, e o site não sabe nem o nome dessas rotas. Sem arquivo para a consulta, a tela avisa: nunca mostra outro número. É o que impede um número errado, seja qual for o clique.

**O que é publicado:**

| Recorte, em cada um dos 12 períodos: os 10 anos, o mais recente e o acumulado | Blocos e tabela, com todas as páginas na ordem por valor | Outras ordens da tabela |
|---|---|---|
| Brasil, região ou UF | Sim | Sim, na primeira página |
| Lavoura no Brasil | Sim | Sim, na primeira página |
| Lavoura em uma região onde ela existe | Sim | Não |

A tabela vai até o menor agregado publicado: uma linha por ano, UF e lavoura. No exemplo, ele é a própria linha tratada da carga, que já é um total publicado pela fonte. A camada bruta da carga, os totais da conferência e o registro das cargas não saem.

**Tamanho:** 85.701 arquivos e 126,7 MB, com 79 lavouras, 27 UFs e 10 anos. O limite é de 100 mil arquivos e 200 MB, em `STATIC_MAX_FILES` e `STATIC_MAX_MB`: acima dele, o gerador recusa, e o site anterior continua como estava. Sem o corte de UF com lavoura, seriam cerca de 250 mil arquivos e 360 MB, em uma estimativa pelo tamanho médio.

**O que ficou de fora, e como a tela trata:**

| Fora do site | Na tela |
|---|---|
| UF combinada com lavoura, como filtro: 1.145 pares em 12 períodos | Com uma lavoura, o seletor de UF fica desligado, e o mapa, as barras de UF e as linhas por UF não filtram nem mostram a mãozinha, e o contrário com uma UF. Uma frase diz por quê. O valor de cada UF na lavoura continua à vista no mapa, no gráfico e na tabela |
| Outra ordem da tabela com lavoura e região juntas | O cabeçalho não ordena, a seta fica em Valor, e a tabela diz que fica na ordem por valor. Se havia outra ordem, ela volta à padrão |
| Em outra ordem, as páginas depois da primeira | "Próxima" fica desligada, e a tabela diz que as outras páginas estão na ordem por valor |
| Link com UF e lavoura, UF de outra região ou lavoura que não existe na região | Uma mensagem no lugar do painel, sem número, com "Voltar ao início" |
| Conferência, agente e login | Não existem. O botão do chat não aparece, e `?tela=conferencia` diz que a conferência não faz parte do site |

Link inválido recebe as mesmas mensagens da API. Arquivo ausente ou ilegível derruba só o bloco dele, com "Tentar de novo".

**Data dos dados.** Não há consulta ao vivo, e a tela diz isso, com a data da carga. O aviso de dado velho, de mais de 45 dias, é calculado no dia em que a pessoa abre. Para atualizar, rode a carga e gere de novo. O gerador recusa uma carga com falha ou um dado que mude no meio da geração, e o site anterior fica como está. Ele também recusa `MONTH_FILTER=on`: o mês não entrou no plano do site.

**Provas.** `npm run check:static` compara cada arquivo com a API, pela rede, e exige 0 diferenças. Com `-- --sabotar`, troca 1 byte, para provar que reprova. Ele também compara as leituras por outro nome, como a UF com a região dela, as recusas de link inválido, os totais do site contra os do IBGE guardados pela carga, sem consultar a fonte de novo, e varre a pasta. E segue os cliques a partir da abertura, com as regras da própria tela (`dashboards/producao-agricola/web/screenRules.ts`), exigindo arquivo para cada bloco em cada endereço: seletores, colunas, legenda, mapa, barras, donut, etiquetas e linhas da tabela, mais, em cada recorte, cada agrupamento da tabela, cada coluna que ordena, nos dois sentidos, e cada página. O que depende de pixel, como o lugar de cada item, fica fora dessa conta: é conferido no navegador. Com os mesmos dados, o site gerado de um SQLite tem os arquivos de dados iguais, byte a byte, aos gerados do Postgres.

A varredura, em `dashboards/producao-agricola/scripts/static-tools.ts`, roda também no gerador. Ela reprova segredo, conexão de banco, caminho local, nome de usuário ou da máquina, SQL, nome de coluna interna, rota de login ou agente, mapa de código, arquivo de outro tipo, coluna que a tela não usa e linha abaixo do menor agregado. Mesmo assim, antes de publicar, siga a skill `dash-publicar` e confirme se a fonte permite publicar.

**Adaptar.** O corte fica em `isPublished` e `isOrderPublished`, em `dashboards/producao-agricola/shared/staticSite.ts`, e a lista do que é gerado, em `walkSite`, em `dashboards/producao-agricola/scripts/static-tools.ts`. Nessa pasta também ficam as colunas permitidas por rota. Meça antes o número de combinações: um filtro novo multiplica os arquivos.

## Login

Com `AUTH_MODE=login` no `.env`, `npm run check` e `npm run check:static` precisam de um servidor em modo local em outra porta, indicada em `DASHBOARD_URL`. `npm run build:static` recusa esse modo, porque login indica dado interno: para dado público, rode com `AUTH_MODE=local` no próprio comando.

**Primeiro acesso.** Com `AUTH_MODE=login` e nenhum usuário, a página abre uma tela para criar o primeiro login, que é o do administrador do projeto: vê todos os dashboards e cuida das outras pessoas. Se ao subir o servidor não houver usuário, ou o banco estiver fora do ar, ele só escuta em `127.0.0.1`, qualquer que seja o `HOST`, e avisa no terminal. Pedido que traga cabeçalho de proxy é recusado. A única porta aberta seria um proxy ou repasse instalado na própria máquina que não se identifique: não ponha nenhum na frente antes de criar o primeiro login. Depois dele, a tela deixa de existir, e, ao reiniciar o servidor, o portal abre no `HOST` configurado, sempre pedindo login.

Com `AUTH_MODE=local`, não há login, e o servidor escuta só na própria máquina. Dado interno exige `AUTH_MODE=login`, `COOKIE_SECURE=true` e HTTPS.

Ano, mês ou lavoura que só existem fora da permissão recebem a mesma recusa de um valor que não existe, para a resposta não revelar nada. Um link com UF ou região de fora mostra só a mensagem de que está fora da permissão, sem título nem número.

**As outras pessoas** entram pela tela de administração do portal. Para criar de fora do navegador, como em uma instalação nova sem a tela aberta, use o script. A senha vem do ambiente, para não ficar no histórico do terminal; quem entra com ela é levado a trocá-la, a menos que seja `--admin`. Em produção com Postgres, defina também `ADMIN_DATABASE_URL`. Em SQLite, o comando é o mesmo, e grava no arquivo.

```bash
# Git Bash, macOS ou Linux
NEW_USER_PASSWORD=... node scripts/create-user.ts maria "Maria" producao-agricola:51,35   # dashboard com recorte: só MT e SP
NEW_USER_PASSWORD=... node scripts/create-user.ts gestao "Gestão" producao-agricola:todas # todos os itens do recorte (:todos também vale)
NEW_USER_PASSWORD=... node scripts/create-user.ts ana "Ana" outro-dashboard               # dashboard sem recorte: só o nome
NEW_USER_PASSWORD=... node scripts/create-user.ts --admin chefe "Chefe"                    # administrador
```

```powershell
# PowerShell
$env:NEW_USER_PASSWORD = "..."
node scripts/create-user.ts maria "Maria" producao-agricola:51,35
node scripts/create-user.ts gestao "Gestão" producao-agricola:todas
Remove-Item Env:NEW_USER_PASSWORD
```

## Agente

Fica desligado por padrão. Ligado, aparece como um botão flutuante no canto inferior direito, que abre uma janelinha de chat. `AGENT_PROVIDER=simulado` usa um modelo por palavras-chave, que serve para provar as travas e a tela, mas não representa a qualidade de um modelo real.

Dois provedores reais já vêm prontos. Com `AGENT_PROVIDER=assinatura`, o agente usa o Claude Code logado nesta máquina, pelo executável `claude -p`, sem chave de API: a assinatura é individual, então, com login, só serve se os usuários forem o dono dela. Para atender outras pessoas, use `AGENT_PROVIDER=claude`, a API do Claude, com chave.

**Pela assinatura.** O executável vem de `AGENT_CLAUDE_EXE`, da extensão do VS Code ou do PATH, nessa ordem. Ao subir, o servidor confere o login com `claude auth status` e escreve o resultado no registro, sem mostrar o token. Se a assinatura chegar ao limite, faltar o login ou o executável, ou houver 5 falhas seguidas, o disjuntor para de chamar o Claude Code por um tempo: 30 minutos no limite da assinatura e 5 minutos nos outros casos. Nesse tempo, o agente responde na hora, com o motivo e a hora da volta, sem detalhe técnico. Os tempos ficam em `BREAKER`, em `server/agent/subscriptionModel.ts`.

O provedor é um só por projeto, no `.env`, e vale para todos os dashboards. Cada dashboard diz, no cartão, se tem agente (`card.agent`): só nos que têm aparece o botão e vale a rota `/api/d/<slug>/agent`; nos outros, a recusa é a de uma rota que não existe. O agente de cada dashboard usa só as ferramentas dele (`dashboards/<slug>/agent`), com a permissão de quem pergunta, e nunca consulta outro dashboard. O laço comum fica em `server/agent/agent.ts`.

**Memória da conversa.** Cada pessoa tem uma conversa por dashboard, só na memória do servidor: nada vai para o banco, para arquivo ou para o registro, que continua sem a pergunta. A chave é a pessoa, o dashboard e um resumo da permissão dela ali; se a permissão muda, a conversa começa do zero. Sem login, a pessoa é "local". As últimas trocas (pergunta e resposta, cada uma com o recorte de filtros daquele momento) entram como contexto a cada pergunta nova. O navegador nunca manda histórico: o corpo do pedido só leva a pergunta e os filtros da tela, e qualquer outro campo é ignorado. A tela mostra o que o servidor guardou (`GET /api/d/<slug>/agent`), e o botão "Nova conversa" chama `DELETE` na mesma rota, com CSRF. Sair do portal também esquece as conversas. A memória só ajuda a entender "e em agosto?": a conferência de números continua aceitando só valores das ferramentas chamadas na pergunta atual, e a instrução manda consultar de novo em vez de repetir número antigo. O código está em `server/agent/memory.ts`.

Como o servidor costuma ter pouca memória, há tetos, todos no `.env` com padrão seguro: `AGENT_MEMORY_TURNS=5` trocas por conversa, `AGENT_MEMORY_IDLE_MINUTES=120` sem uso, `AGENT_MEMORY_MAX_CONVERSATIONS=200` conversas ao mesmo tempo (passou, sai a usada há mais tempo) e `AGENT_MEMORY_MAX_CHARS=20000` caracteres por conversa (passou, saem as trocas mais antigas). A pergunta tem no máximo 500 caracteres. Valor inválido impede o servidor de subir.

**Formato da resposta.** A tela mostra só um subconjunto seguro de Markdown: negrito, listas com marcador e parágrafos. O texto vira elementos React (`web/src/chatText.ts`), nunca HTML, e o resto continua texto puro. Pergunta fora do tema recebe a recusa normal do dashboard (`REFUSAL`, em `agent/prompt.ts`), mesmo que o modelo tenha citado número ou data na recusa, e a conferência de números não é afrouxada. A permissão da pessoa vai na instrução, pelos nomes e com o nome do recorte do dashboard ("Esta pessoa só pode ver estas UFs: ..."), para o agente não oferecer o que ela não pode ver. Sem recorte, ou com tudo permitido, a nota não existe (`permissionNote`, em `server/agent/agent.ts`).

Para ligar outro provedor, escreva um `ModelAdapter` (`server/agent/types.ts`) a partir da documentação oficial dele, registre no mapa de provedores do `server/main.ts`, e rode o conjunto de perguntas da skill `dash-agente`.
