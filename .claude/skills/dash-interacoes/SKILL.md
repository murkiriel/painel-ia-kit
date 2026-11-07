---
name: dash-interacoes
description: Implementa filtros globais salvos na URL, filtro cruzado entre gráficos e detalhamento até a linha de origem em dashboards React. Use sempre que o trabalho envolver filtro, segmentação, clique em gráfico que filtra outro, cross-filter, drill, detalhamento, link compartilhável, ou gráfico que repete consultas ou mostra resposta atrasada.
---

# Filtros, filtro cruzado e detalhamento

Interação errada engana mais que erro visível: o número muda e parece certo. Três regras evitam a maior parte dos problemas:

- A URL é a única fonte de verdade dos filtros.
- A seleção guarda o valor, nunca a posição na lista.
- Resposta atrasada é descartada.
- A última ação vale: o seletor e os números nunca dizem coisas diferentes.

## O que cada filtro faz

| Filtro | Como se aplica | Onde fica |
|---|---|---|
| **Global** | A todos os blocos da tela | `?regiao=Sul&ano=2026` |
| **Cruzado** | A todos os blocos, menos o gráfico clicado | `?sel.vendas_regiao=regiao:Sul` |
| **Detalhamento** | Só ao bloco de detalhe: agrupa e pagina | `?por=produto&pagina=2` |

O gráfico clicado não filtra a si mesmo. Se filtrasse, as outras barras sumiriam, e o usuário não teria como trocar a seleção.

Uma seleção por gráfico: clicar em outro item troca, e clicar de novo no mesmo item limpa. A seleção fica destacada no gráfico e aparece como etiqueta na linha de filtros, com o botão de limpar.

## Estado na URL

O link copiado precisa abrir a mesma tela, com os mesmos números. Por isso o estado não fica duplicado em componente.

O [modelo](../../../modelo/dashboards/producao-agricola/web/Dashboard.tsx) traz tudo isto em uso. Copie [filters.ts](references/filters.ts) e [filters.test.ts](references/filters.test.ts) para o projeto: as regras ficam ali, testadas, sem depender de React. Na tela, um gancho curto liga essas regras à URL, sem biblioteca de rotas:

```ts
// useFilters.ts
import { useCallback, useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};

export function useFilters() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);

  // Cada mudança entra no histórico, então o botão Voltar desfaz o filtro.
  const navigate = useCallback((query: string) => {
    window.history.pushState(null, "", query ? `?${query}` : window.location.pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return { search, navigate };
}
```

Uso em um gráfico:

```ts
const { search, navigate } = useFilters();
const { state, retry } = usePanel<Row>("/api/sales/by-region", panelQuery(search, PANEL));
const selected = selectedValue(search, PANEL);
// Lê a URL no momento do clique: o gráfico registra o clique uma vez só, e "search" ficaria velho.
const onSelect = (key: string) => navigate(toggleSelection(window.location.search, PANEL, "regiao", key));
```

No detalhe, use `detailQuery(search)`, que também leva a dimensão e a página. Mudar um filtro volta para a primeira página.

**Na mesma dimensão, a última ação vale.** Escolher no seletor retira o clique anterior naquela dimensão e nas ligadas a ela, como região e UF. Passe as ligadas em `setFilter(search, "regiao", valor, ["uf"])`. Em um link antigo, `normalizeSearch` resolve a disputa: o clique vale, e o filtro sai, para o seletor e os números nunca divergirem.

**Período e evolução.** Sem período na URL, vale o mais recente, e o backend resolve isso. "Todos os anos" é uma escolha explícita, como `ano=todos`. O gráfico ao longo do tempo ignora o período escolhido e o destaca, e clicar em uma coluna equivale a escolher no seletor.

**Legenda.** Clicar em um item da legenda é uma seleção como outra, no próprio gráfico: `toggleSelection(search, "anos", "regiao", key)`. O gráfico continua inteiro, com o total, e destaca a série. Os outros blocos filtram, e o segundo clique retira. A chave da série precisa existir no filtro do backend: se a série agrupa valores acima dele, como um bloco com vários grupos, o backend precisa aceitar esse bloco, e os avisos e cartões que dependem do filtro precisam ser revistos.

**Seletores.** Cada lista mostra só o que existe no recorte, e ignora o próprio filtro, para dar para trocar. Mudar a região limpa a UF.

**Filtros numa linha só.** Todos os filtros ficam numa linha, sem segunda linha de extras. Cada filtro aparece em toda aba onde ele filtra todos os blocos (o vendedor, por exemplo, em toda aba de vendas). Se filtraria só parte da aba, não entra sem decisão do usuário. Se não se aplica pelos dados, fica fora. Em 1366 px a linha cabe inteira: a caixa fica estreita, com reticências, e o nome inteiro aparece na dica do mouse.

**Destaque.** A caixa só fica azul quando o filtro restringe algo. "Todos" ou "Todas" nunca fica azul, mesmo quando o padrão da aba é outro valor. Na caixa, a opção "Todos" tem valor vazio, e a URL guarda o valor que precisar.

**Período em dois níveis.** Com ano e mês, o gráfico de anos mostra todos os anos, e o de meses, os meses do ano escolhido. Período sem dado aparece com traço, sem sumir: esconder o ano esconderia a lacuna. Clicar em um período sempre atualiza o seletor. O mês sempre vai com o ano na URL, para o link não mudar de sentido quando entra um ano novo. Mês sem ano é recusado, ano incompleto fica marcado, como "até set", e a comparação com o ano anterior só vale com os mesmos meses; senão, `—`. No modelo, isso é opcional: veja "Ligar o mês" no [README](../../../modelo/README.md).

**Clique.** Toda a faixa do item é clicável, com o nome e o número: barra de item pequeno é impossível de acertar. Item sem chave, como "Outros", não filtra e não mostra a mãozinha. Veja `bands` em [Chart.tsx](../../../modelo/web/src/components/Chart.tsx). O clique não desloca o que está sob o mouse: filtrar muda a altura de outros blocos, e o segundo clique acertaria outro item. [clickAnchor.ts](../../../modelo/web/src/components/clickAnchor.ts) mede o item clicado a cada quadro e compensa, seja qual for a causa. Item que desenha de novo do zero também erra: dê um `id` fixo à série do donut.

**Teclado.** O gráfico não recebe foco, então cada um tem um seletor que só aparece com o foco, e faz o mesmo que o clique. A legenda é feita de botões, que o teclado já alcança.

**Limpar filtros** tira só os filtros. Agrupamento e ordem da tabela continuam.

## Buscar os dados

Cada bloco busca por conta própria, para uma falha derrubar só aquele bloco. A dependência do efeito é o texto da consulta, um valor simples. Assim, novos dados não disparam nova consulta, e não há repetição infinita.

```ts
// usePanel.ts
import { useCallback, useEffect, useState } from "react";

type State<T> =
  | { status: "loading"; data?: PanelResponse<T> }
  | { status: "error"; message: string }
  | { status: "ok"; data: PanelResponse<T> };

export function usePanel<T>(endpoint: string, query: string) {
  const [state, setState] = useState<State<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Mantém o dado anterior enquanto carrega, mesmo em cliques seguidos.
    setState((previous) => ({ status: "loading", data: previous.status === "error" ? undefined : previous.data }));

    fetch(`${endpoint}?${query}`, { signal: controller.signal, credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`Falha ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ok", data });
      })
      .catch((error) => {
        // Consulta cancelada por um filtro mais novo não é erro.
        if (!controller.signal.aborted) setState({ status: "error", message: error.message });
      });

    // Ao mudar o filtro, cancela a consulta anterior: resposta atrasada não sobrescreve a nova.
    return () => controller.abort();
  }, [endpoint, query, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
```

Enquanto carrega, mantenha o dado anterior com indicação de atualização, para a tela não piscar. Uma falha nunca aparece como "sem dados".

## No backend

O filtro cruzado depende de cada rota aceitar todos os filtros de negócio como opcionais. Dois cuidados:

- **Parâmetro desconhecido ou repetido recebe erro 400.** Se fosse ignorado, a tela mostraria o total com aparência de filtrado.
- **Permissão nunca é opcional, quando o dashboard tem recorte.** Ela não usa o padrão `IS NULL`, porque sessão sem permissão entregaria tudo. Lista vazia não traz linhas. Acesso total é um perfil explícito, que o backend traduz para a lista completa. Num dashboard sem recorte, a lista é sempre vazia e a consulta não filtra por ela.

```ts
// Lista fechada: só estes parâmetros existem, e nome de coluna nunca vem do navegador.
const ALLOWED = new Set(["ano", "regiao", "produto", "vendedor"]);

function readFilters(query: URLSearchParams) {
  for (const key of query.keys()) {
    if (!ALLOWED.has(key)) throw new BadRequest(`Filtro desconhecido: ${key}`); // vira 400
  }
  return [query.get("ano"), query.get("regiao"), query.get("produto"), query.get("vendedor")];
}

// $5 vem da sessão, nunca da URL. "__vazio__" é o NO_VALUE de filters.ts.
const sql = `
  SELECT COALESCE(region, '__vazio__') AS key,
         COALESCE(region, 'Sem região') AS label,
         SUM(amount)::text AS value
  FROM sales
  WHERE ($1::int IS NULL OR EXTRACT(YEAR FROM sold_on) = $1::int)
    AND ($2::text IS NULL OR region = $2 OR ($2 = '__vazio__' AND region IS NULL))
    AND ($3::text IS NULL OR product = $3 OR ($3 = '__vazio__' AND product IS NULL))
    AND ($4::text IS NULL OR seller = $4 OR ($4 = '__vazio__' AND seller IS NULL))
    AND unit = ANY($5::text[])
  GROUP BY 1, 2
  ORDER BY SUM(amount) DESC`;
```

O bloco clicado não envia a própria seleção, pois `panelQuery` a retira.

**Chave e rótulo são separados.** O filtro usa a chave, e a tela mostra o rótulo. "Sem região" tem a chave reservada, tratada como nulo. "Outros" não tem chave, e clicar nele não filtra.

## Em site estático

Sem servidor, as combinações são calculadas na carga e publicadas em arquivos de agregados, para a tela não calcular total:

- O plano lista quais filtros e seleções se combinam. Cada combinação prevista vira um arquivo ou uma entrada. Combinação demais aumenta muito o tamanho, então limite as dimensões.
- O caminho do arquivo sai de `panelQuery`, então as mesmas regras e o mesmo link continuam valendo. Sem arquivo para a combinação, a tela avisa, em vez de mostrar outro número.
- O detalhamento vai até o menor agregado publicado, e a tela avisa que as linhas não são públicas.

## Detalhamento até a linha

- **Controle visível** "Detalhar por", e clique na linha agrupada para ver as linhas dela. Clique direito não funciona no celular, e ninguém adivinha que ele existe.
- **Clicar na linha agrupada vira filtro global:** a tela toda muda, e o filtro aparece no seletor. O botão Voltar do navegador desfaz, porque tudo está na URL.
- **A seleção entra no detalhe.** O detalhe usa todos os filtros, inclusive os do gráfico de origem.
- **Paginação no servidor** para as linhas, com o total da seleção vindo do backend, não da soma da página visível. A contagem de linhas é uma consulta própria, para valer mesmo em uma página sem resultado.
- **Soma confere:** o total das linhas tem que bater com o valor clicado. Se divergir, mostre a diferença.
- **Ordenação no servidor:** clicar no cabeçalho ordena. As linhas vêm paginadas, então a ordem vai ao backend junto com a página, em `?ordem=area&dir=asc`, de uma lista fechada.
- **Página além do fim** leva à última.

## Testes

- [ ] Um clique gera uma consulta por bloco afetado. Mais que isso indica repetição.
- [ ] Clicar rápido em dois itens mostra o resultado do último, mesmo se o primeiro responder depois.
- [ ] O gráfico clicado mantém todas as barras, e os outros blocos mudam.
- [ ] Recarregar a página e abrir o link copiado mostram os mesmos números.
- [ ] Clicar de novo limpa. "Limpar filtros" volta ao estado inicial.
- [ ] Dois cliques no mesmo lugar, sem mover o mouse, em cada item: o segundo retira a seleção, e nada sob o mouse se desloca.
- [ ] Um valor com `:`, `&`, acento ou espaço funciona.
- [ ] Parâmetro repetido na URL aparece como erro no bloco, em vez de um valor sumir.
- [ ] Valor inexistente na URL, inclusive ano e item que não estão na base, recebe erro 400, com o caminho de volta ao início, e nunca derruba a tela.
- [ ] O primeiro clique em um cabeçalho sempre muda a ordem, e a seta diz a verdade. Coluna que só mostra "—" não ordena.
- [ ] Nomes em ordem de dicionário do português: Pará, Paraíba, Paraná.
- [ ] Clicar em um item e depois escolher outro no seletor: o seletor e os números batem.
- [ ] Seleção que não está no gráfico não apaga todas as barras.
- [ ] Item muito pequeno pode ser selecionado pelo nome.
- [ ] Depois de reordenar a lista, a seleção continua no mesmo item.
- [ ] O botão Voltar do navegador desfaz o último filtro.
- [ ] Filtro sem resultado mostra "sem dados" e um caminho para limpar.
- [ ] Em 1366 px, todos os filtros cabem numa linha só, e a caixa cortada mostra o nome inteiro na dica.
- [ ] Cada filtro aparece em toda aba onde filtra todos os blocos, e em nenhuma outra.
- [ ] "Todos" nunca deixa a caixa em destaque. Escolher um valor destaca a caixa, e voltar a "Todos" tira o destaque.
- [ ] Falha em um bloco não afeta os outros, e não aparece como "sem dados".
- [ ] Parâmetro desconhecido na URL recebe erro 400 e nunca vai para o SQL.
- [ ] Todo filtro aceito pela rota muda o resultado. Filtro ignorado é erro.
- [ ] Sessão sem permissão não traz linhas, em nenhuma rota.
- [ ] Clicar em "Sem região" filtra os registros sem região, e o detalhe bate.
- [ ] Clicar em "Outros" não filtra.
- [ ] Mudar um filtro na página 7 volta para a primeira página.
- [ ] O total das linhas no detalhe bate com o valor clicado.
