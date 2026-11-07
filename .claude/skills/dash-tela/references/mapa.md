# Mapa com MapLibre

Em uso no [modelo](../../../../modelo/web/src/components), provado com o valor da produção por UF: cliques em cada UF, em 4 larguras, filtros combinados, teclado e falhas. Confira na tela depois de copiar.

## O que copiar

| Arquivo | O que faz |
|---|---|
| `components/MapBlock.tsx` | Parte leve: carregamento em pedaço separado, aviso de falha e seletor do teclado |
| `components/MapCanvas.tsx` | O mapa, os rótulos, a dica e a legenda. Só ele importa o MapLibre |
| `components/mapRules.ts` | Regras sem navegador, testadas: escala de cores, posição dos rótulos e estilo |

Os três não sabem nada do domínio. Em outro dashboard, passe outro GeoJSON:

```tsx
// Fora do componente: a função precisa ser sempre a mesma.
const loadShapes = () => import("./regioes.geo.json").then((m) => m.default as unknown as Shapes);

<MapBlock
  label="Valor por regional"
  loadShapes={loadShapes}
  properties={{ id: "codigo", short: "sigla", name: "nome" }}
  rows={d.rows}
  selected={selectedValue(search, "mapa")}
  onSelect={(key) => navigate(toggleSelection(window.location.search, "mapa", "regional", key))}
  tokens={tokens}
  format={moneyCompact}
  formatExact={money}
  caption="Contornos: nome da fonte"
  failureNote="Os valores continuam no gráfico por regional."
/>;
```

Cada item de `rows` traz `key`, `label` e `value`. A `key` precisa ser igual à propriedade `id` do GeoJSON. Um teste deve comparar as duas listas, como `test/map.test.ts` faz com as 27 UFs.

## Sem rede

O estilo só tem a fonte `geojson`, com os dados no próprio objeto:

- **Sem `glyphs`:** o MapLibre não desenha texto. Os rótulos são elementos da página.
- **Sem `sprite` e sem camada `symbol`.**
- **Sem tiles e sem atribuição externa.** Cite a fonte dos contornos em `caption`.

Prove no navegador, registrando as requisições e cortando tudo o que sair do próprio endereço.

## Worker

A partir da versão 6, o worker é um arquivo à parte, procurado ao lado do arquivo principal. Depois de empacotado, ele não está lá, e o mapa fica em branco, sem erro à vista:

```ts
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
```

Com `?worker&url`, o Vite gera um `.js`, que o servidor do modelo já entrega com o tipo certo. Um `.mjs` exigiria acrescentar o tipo em `TYPES`, no `server/main.ts`.

## Tamanho do contêiner

O CSS do MapLibre põe `position: relative` em `.maplibregl-map`. Se a sua classe tiver a mesma força e vier antes, o mapa fica com altura zero, e o `load` chega sem nada para desenhar. Por isso a regra é `.map-box .map-canvas { position: absolute; inset: 0; }`.

## Enquadramento e rolagem

- `interactive: false` desliga zoom, arraste e teclado, e o clique continua chegando. A roda do mouse e o dedo rolam a página.
- Sem zoom, nada se move depois do enquadramento. Os rótulos ficam em uma camada da página, sem `Marker`, e são recalculados só quando o tamanho, os dados ou a seleção mudam.
- `fitBounds` com a caixa do próprio GeoJSON, de novo a cada mudança de tamanho, por um `ResizeObserver`.
- `rightRoom` reserva uma parte da largura à direita para os rótulos das áreas do litoral. Ajuste para a sua geografia.

## Número à vista

`placeLabels` escolhe a posição de cada rótulo, sem sobreposição:

1. O selecionado mostra sempre o valor, sem mover nenhum outro rótulo: o clique não desloca o que está sob o mouse. Se ele ainda não mostrava o valor, ganha um lugar, e o rótulo que ficaria embaixo perde o valor ou, sem lugar nem para o nome, sai.
2. As áreas grandes ficam no próprio centro.
3. A área pequena vai para perto, com uma linha, sem cobrir a si mesma nem o centro de outra.
4. Em mapa com menos de 480 pixels, o rótulo nunca sai da própria área, porque cairia sobre outra e pareceria ser dela. Fica só o nome. Sem lugar nem para isso, o rótulo sai.

O valor do que não coube fica na dica do mouse e no gráfico por item. O rótulo é clicável, para área pequena não ficar de fora.

A dica do mouse mostra só o valor exato (`56,5%`, `R$ 12.935.673.000`), com `formatExact`. O resumido já está na tela, e repeti-lo daria dois números parecidos para a mesma área, como `57%` e `56,5%`.

## Troca rápida de aba

Trocar de aba depressa cria e desfaz mapas em sequência. Nada disso pode virar o aviso de falha. O efeito que cria o mapa precisa de três cuidados:

- **Marca de descarte (`disposed`):** ao sair da tela, o efeito a liga. Erro, perda de contexto e fim de carregamento de um mapa descartado são ignorados.
- **Nova tentativa:** se a criação falhar, tenta de novo, até 3 vezes e com espera crescente, porque a placa de vídeo pode ainda estar liberando o mapa anterior. Só depois da última tentativa vem o aviso.
- **Contexto gráfico perdido:** tem 3 s para voltar sozinho. Se voltar, o aviso é cancelado; se não, o bloco avisa.

Carregamento cancelado (`AbortError`) não é falha. Sem WebGL, o aviso continua.

## Cor

`colorScale` mistura a superfície e a cor principal, em até 5 faixas com um número parecido de itens: poucos valores muito grandes deixariam quase tudo igual. O limite de cada faixa é um valor real do recorte, e a legenda mostra esse limite.

- **Zero:** o tom mais claro, com item próprio na legenda.
- **Negativo:** a cor de sentido do tema (`tokens.negative`), distinta de zero, das faixas e de sem dado, com item próprio na legenda, só quando existir. Sem rótulo, no celular, ele não pode se ler como zero.
- **Sem dado:** a cor do fundo, com o contorno. Também vale para o que está fora do recorte ou da permissão.
- **Tema:** as cores precisam estar em `#rrggbb`, porque a escala as mistura. Outro formato dá erro, e o bloco mostra o aviso.

## Legenda

Legenda de série filtra; escala de cores não. A do mapa é uma escala de cores, não uma lista de itens: não filtra e não pode parecer clicável, sem botão nem cursor de clique. `legendEntries` monta as entradas, sem navegador.

## Filtro

O bloco busca na mesma rota do gráfico por item, com `panelQuery(search, "mapa")`, sem consulta nova. Assim, o valor é o mesmo por construção.

- A seleção é do próprio bloco: `toggleSelection(search, "mapa", dimensão, chave)`. O mapa não a recebe, e continua inteiro.
- Item fora do recorte não é clicável e não mostra a mãozinha. Um clique ali só levaria a "sem dados".
- Se a seleção não está no recorte, nada se apaga.

## Testes de tela

- [ ] Nenhuma requisição para fora, com a rede externa cortada.
- [ ] Cada área clicada: a URL e os cartões batem com a API, e o segundo clique, no mesmo lugar e sem mover o mouse, retira.
- [ ] Áreas pequenas, pelo contorno e pelo rótulo.
- [ ] Rótulos sem sobreposição, em cada largura, com e sem seleção.
- [ ] A roda do mouse e o dedo rolam a página sobre o mapa e sobre um rótulo.
- [ ] Sem WebGL, com o contexto perdido que não volta em 3 s e sem os pedaços do bundle: aviso no bloco, e o resto funciona.
- [ ] Trocar de aba várias vezes seguidas, bem rápido, e voltar: o mapa aparece, sem aviso de falha.
- [ ] Com permissão limitada, nenhuma dica ou rótulo mostra valor de fora dela.
- [ ] A dica do mouse mostra só o valor exato, sem o resumido.
