---
name: dash-dados
description: Conecta e prepara dados para o dashboard a partir de planilhas, CSV, bancos SQL e APIs REST, com carga no banco (Postgres por padrão, SQLite sem banco disponível), consultas parametrizadas e registro da última atualização. Use sempre que o trabalho envolver fonte de dados, importação, integração, carga, sincronização, consulta SQL do dashboard, API de indicadores ou dado que não bate com a fonte.
---

# Dados do dashboard

Quase todo número errado nasce aqui, e sem aviso: linhas cortadas pela fonte, duplicatas ou filtro ignorado. Por isso, cada fonte é tratada como suspeita até ser testada.

## 1. Feche o contrato de dados

Preencha e apresente no plano antes de construir:

```markdown
## Contrato de dados: <fonte>

- **Fonte e acesso:** <arquivo, banco ou API; quem dá a credencial de leitura>
- **Modelo:** <carga periódica | consulta direta | misto>
- **Frequência:** <de quanto em quanto tempo; atraso aceitável>
- **Entidades:**

| Entidade | Chave | Volume | Coluna de alteração | Registro excluído na fonte |
|---|---|---|---|---|

- **Regras:** <o que entra, sai ou muda, cada uma com o motivo>
- **Última atualização:** <como aparece na tela>
- **Falha:** <o que a tela mostra quando a carga falha>
```

As perguntas específicas de cada fonte estão em [fontes.md](references/fontes.md).

## 2. Escolha o banco e o modelo

**Cada dashboard tem os próprios dados, e eles nunca se misturam.** No Postgres, um schema por dashboard e usuários de leitura e de carga só com permissão nele (`<schema>_reader` e `<schema>_loader`, com o endereço em `<SCHEMA>_DATABASE_URL` e `<SCHEMA>_LOAD_DATABASE_URL`); no SQLite, um arquivo por dashboard, aberto sozinho e com `ATTACH` proibido. Nenhuma tabela é compartilhada: a área comum guarda só o portal. As consultas não levam prefixo de schema (o `search_path` da conexão cuida disso) e nunca citam outro dashboard. A carga, o agente, a miniatura, a conferência e o site estático de um dashboard só tocam os dados dele. Ler dados de dois dashboards, no futuro, exige declarar isso de forma explícita na descrição do dashboard que consome, com a permissão de leitura correspondente, e documentar. O modelo deixa o lugar previsto e não implementa. Provas: `test/isolation.test.ts`, nos dois motores.

Sempre tente usar um banco de dados. A tela lê do banco, nunca direto de planilha ou CSV.

| Situação | Banco |
|---|---|
| Há banco disponível, e é Postgres | Use-o. É o padrão, e o `modelo/` já funciona com ele |
| Há banco disponível, em outro motor | Use-o: as consultas e a carga precisam ser reescritas, e isso entra no plano com o custo |
| Nenhum banco disponível | No mínimo SQLite: um arquivo em uma pasta ignorada pelo git, com `node:sqlite`, que já vem no Node. O `modelo/` já funciona com ele, com `DB_ENGINE=sqlite` no `.env` |

- **Banco de outro sistema:** o acesso continua só de leitura. Gravar a carga nele exige uma área própria, aprovada no plano. Sem isso, a carga vai para o Postgres ou o SQLite do dashboard.
- **SQLite tem limites, e o plano os diz:** não há usuários de banco, então a leitura abre com `readOnly` e cada conexão tem uma lista de permissões, mas quem abre o arquivo com outro programa passa por cima: proteja a pasta. Não há decimal exato, então dinheiro fica em inteiro, com a escala da coluna, e as contas usam `BigInt`, para o texto sair igual ao do Postgres. Ele atende bem uma máquina, com um escritor por vez, e bloqueia o processo durante cada consulta. Consulta nova entra com as duas versões, lado a lado, e passa por `npm run check:engines`. Detalhes em "Escolher o banco", no README do `modelo/`.
- **Site estático:** os agregados publicados saem do banco.
- **`embedded-postgres`:** é só para desenvolver. Não conta como banco disponível na entrega.

| Modelo | Quando usar | Custo |
|---|---|---|
| **Carga periódica no banco** (padrão) | Fonte lenta, com limite de chamadas, ou que não pode receber consultas durante o uso | O dado fica defasado; a tela precisa dizer de quando é |
| **Consulta direta** | Número quase em tempo real, e a fonte é um banco ou uma API que aguenta | A tela depende da fonte estar no ar |
| **Misto** | Histórico em carga e dia corrente direto | Dois caminhos para conferir |

Carga é uma rotina que grava: ela só existe com aprovação no plano, em código separado do agente do dashboard. Na fonte, o acesso continua sendo só de leitura. Envio automático, como um relatório por e-mail, segue a mesma regra, com um único ponto de envio no código.

## 3. Prove a fonte antes de construir

Só com leitura, e mostrando o resultado:

- **Amostra:** colunas, tipos e exemplos.
- **Documentação:** procure o dicionário ou os metadados da fonte. Eles costumam explicar unidade e lacunas.
- **Formato por período:** o formato do número pode mudar por ano ou por linha. Conte os padrões por período antes de escolher como ler, e recuse o que não reconhecer. Desconfie de dígitos perdidos, como `28,53` no lugar de `28.530`.
- **Negativos:** quantos são, quanto somam e se entram no total.
- **Mudança de patamar:** compare a participação de cada item entre períodos. Um salto ou uma queda é "a verificar", e fica como veio.
- **Totais:** contagem e soma, para ter contra o que conferir depois.
- **Valores distintos** dos campos de texto livre e de status. Busca por palavra deixa passar grafias diferentes.
- **Limites silenciosos:** a fonte corta linhas? Devolve página vazia no meio? Ignora um filtro sem avisar? Teste pedindo além do limite e com filtro que não deveria trazer nada.
- **Chave:** ela é mesmo única? Conte duplicatas.
- **Totais dentro da lista:** a fonte pode trazer linhas que já são a soma de outras, como "Total" ou o total de uma categoria. Some as partes e compare com o total publicado. Se a soma passar, procure a linha repetida.
- **Símbolos no lugar de número:** `-`, `..`, `...` ou `X` podem ter sentidos diferentes. Descubra o de cada um. Só o que significa zero vira zero.
- **Unidade:** ela é a mesma em todas as linhas e períodos? Se a fonte mudou de moeda ou de unidade, a carga para.
- **Lista de itens ao longo do tempo:** compare os itens de cada período. Se a fonte passou a incluir ou deixou de incluir itens, a comparação entre períodos muda, e a tela precisa avisar quanto isso pesa.
- **Fonte com total próprio:** guarde o total publicado à parte, fora das somas, para a conferência. Confira também o que ela **não** publica: se a fonte não tem um total, o seu pode não fazer sentido.
- **Notas de rodapé:** asterisco ou marca no nome pode mudar o significado do número. Se não der para ler a nota, marque como "a verificar".

Registre o que não deu para conferir. Página vazia no meio de uma coleta é falha, não o fim dos dados.

A cópia local da fonte para investigar fica em uma pasta ignorada pelo git, como `.data`.

**Fonte que bloqueia robôs:** leia o `robots.txt` e os termos antes de prometer uma coleta automática. Se o site bloqueia robôs ou recusa o acesso, não contorne, nem se passando por navegador: pergunte, com alternativas como uma API oficial ou um arquivo baixado pelo usuário.

## 4. Organize em três camadas

1. **Bruto:** o dado como veio, sem correção. Permite refazer tudo e investigar diferenças.
2. **Tratado:** tipos certos, duplicatas removidas pela chave, regras aplicadas.
3. **Indicadores:** consultas ou views com a conta do dicionário, em um só lugar. O mesmo indicador nunca tem duas contas.

Regras que valem em todas:

- Dinheiro e quantidade em `NUMERIC`, ou em inteiro com escala no SQLite, nunca em ponto flutuante.
- Data em `DATE` ou `TIMESTAMPTZ`, nunca em texto.
- Dado estranho fica como veio e é avisado. Ele não é corrigido em silêncio.
- Correção manual fica em uma tabela nomeada, à vista, com motivo, autor e data. A tela consegue mostrar quanto do total vem dela.
- Confira fluxos sobrepostos: o mesmo item pode aparecer em duas tabelas. Isso conta duas vezes.

## 5. Grave sem deixar a tela vazia

- Leia e confira tudo antes de apagar qualquer coisa: último período válido, linhas por período, itens esperados e totais. Fonte que mudou de formato não pode virar uma tela vazia com a atualização recente.
- Faça a troca em uma transação. Nunca apague e reinsira em dois passos separados: quem abrir a tela nesse intervalo vê zero.
- Impeça duas cargas simultâneas da mesma entidade.
- Registre cada execução: início, fim, status, linhas lidas, gravadas e rejeitadas, e o erro.

```sql
-- O log da carga alimenta a "última atualização" da tela.
CREATE TABLE load_log (
  id          BIGSERIAL PRIMARY KEY,
  entity      TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  rows_read   INTEGER,
  rows_saved  INTEGER,
  rows_rejected INTEGER,
  error       TEXT
);
```

Se houver alteração em base que já tem dado real, guarde uma cópia com hash e as contagens de antes e depois, e descreva como restaurar.

## 6. Exponha o dado para a tela

- **Consulta sempre parametrizada.** Nome de coluna ou de dimensão vindo do navegador só passa por uma lista fechada, nunca por interpolação.
- **O backend devolve os totais prontos.** A tela não soma nem calcula porcentagem, para o mesmo número não ter duas versões.
- **Filtro de negócio opcional, no padrão:** `($1::text IS NULL OR region = $1)`. O detalhe e o valor nulo estão na skill `dash-interacoes`.
- **Decimal em texto no JSON.** O driver `pg` já devolve `NUMERIC` como texto, e no SQLite as funções `dec_` devolvem o mesmo texto. Não converta para número no backend. A skill `dash-numeros` formata esse texto sem perder precisão.
- **Data em texto no JSON.** O driver `pg` devolve `DATE` como `Date` no fuso do servidor, e o dia pode mudar. Selecione `col::text`.
- **Permissão nunca é opcional, quando o dashboard tem recorte.** Ela vem da sessão, nunca do navegador, e não usa o padrão acima: use `unit = ANY($5)`, em que lista vazia não traz linhas. Acesso total é um perfil explícito. Num dashboard sem recorte, a rota recebe sempre `[]`: não filtre por ela.
- **Resposta com a data do dado:**

```ts
type PanelResponse<T> = {
  rows: T[];
  totals: Record<string, string>; // calculado no backend
  updatedAt: string | null;       // última carga com sucesso
  warnings: string[];             // regra quebrada ou dado faltando
};
```

Falha nunca volta como lista vazia: devolva um erro, para a tela distinguir "falhou" de "sem dados".

## 7. Teste

Testes automáticos usam dados de exemplo escritos no próprio teste. Eles não tocam dado real, rede nem credencial. Cubra pelo menos os casos que a sua fonte permite: duplicata, valor nulo, linha rejeitada, número com vírgula, página vazia e falha no meio da leitura. A conferência com a fonte real está na skill `dash-validar`.
