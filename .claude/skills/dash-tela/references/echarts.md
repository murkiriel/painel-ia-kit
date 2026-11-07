# ECharts e AG Grid: trechos de configuração

Estes trechos estão em uso no [modelo](../../../../modelo/web/src), que rodou com dados reais: coluna, empilhada com total, barra, donut e tabela. A série longa com eixo visível não foi usada. Confira na tela depois de copiar.

## Base

Importe só o que usa, registre o idioma e redimensione junto com o bloco. Um gráfico iniciado com tamanho zero não aparece.

```ts
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import langPTbr from "echarts/lib/i18n/langPT-br.js";

echarts.use([BarChart, LineChart, PieChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);
echarts.registerLocale("PT-br", langPTbr);
```

Tokens em um só lugar, lidos do CSS:

```ts
// tokens.ts: os gráficos e as tabelas usam estes valores, sem cor solta.
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const readTokens = () => ({
  primary: css("--color-primary"),
  text: css("--color-text"),
  grid: css("--color-grid"),
  series: [1, 2, 3, 4, 5, 6].map((i) => css(`--chart-${i}`)),
});
```

Para toda a faixa do item ser clicável, inclusive o nome, o [modelo](../../../../modelo/web/src/components/Chart.tsx) usa `convertFromPixel` em um clique no `getZr()`. No componente, o clique é registrado uma vez e os dados entram em outro efeito:

```ts
useEffect(() => {
  const chart = echarts.init(ref.current!, undefined, { renderer: "canvas", locale: "PT-br" });
  chartRef.current = chart;
  chart.on("click", (p) => {
    // Clique em item sem chave, como "Outros", não filtra.
    if (p.data?.key != null) onSelect(p.data.key);
  });
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(ref.current!);
  return () => {
    observer.disconnect();
    chart.dispose();
  };
}, []);

useEffect(() => {
  // replaceMerge retira a série que saiu; sem isso, ela fica na tela com número velho.
  chartRef.current?.setOption(option, { replaceMerge: ["series"] });
}, [option]);
```

O idioma do ECharts traduz meses e textos, mas não formata número. Use sempre o módulo `format.ts`: `moneyCompact` no que aparece na tela e `money`, o valor exato, na dica do mouse.

Os valores chegam como texto decimal do backend. Use `chartValue(valor)` para o gráfico desenhar, nunca `Number(valor)`, que transforma sem dado em zero. O rótulo e a dica formatam o valor com o módulo.

## Valor e rótulo são coisas diferentes

Cada item traz a chave usada no filtro e o nome exibido. "Sem região" é rótulo; o filtro precisa da chave reservada (`NO_VALUE`, da skill `dash-interacoes`). "Outros" não tem chave.

```ts
type Row = { key: string | null; label: string; value: string | null };
```

Cada categoria tem a mesma cor em todos os gráficos, mesmo quando um filtro muda quantas aparecem. Monte o mapa de cores a partir da lista completa, nunca da posição no resultado filtrado:

```ts
const colorOf = (key: string) => tokens.series[allKeys.indexOf(key) % tokens.series.length];
```

## Coluna com rótulo e eixo oculto

```ts
const option = {
  tooltip: { trigger: "axis", valueFormatter: (v) => money(v) },
  grid: { left: 8, right: 8, top: 24, bottom: 24, containLabel: true },
  xAxis: { type: "category", data: rows.map((r) => r.label), axisLine: { show: false }, axisTick: { show: false } },
  yAxis: { type: "value", show: false },
  series: [{
    type: "bar",
    data: rows.map((r) => ({ value: chartValue(r.value), key: r.key })),
    itemStyle: { color: tokens.primary },
    label: { show: true, position: "top", fontWeight: "bold", color: tokens.text, formatter: (p) => moneyCompact(p.value) },
  }],
};
```

## Série longa: eixo visível, valor na dica

```ts
tooltip: { trigger: "axis", valueFormatter: (v) => money(v) },
yAxis: { type: "value", axisLabel: { formatter: (v) => moneyCompact(v) }, splitLine: { lineStyle: { color: tokens.grid } } },
series: [{ type: "line", data: rows.map((r) => chartValue(r.value)), label: { show: false }, showSymbol: false, lineStyle: { width: 2 } }],
```

Use só quando os rótulos se sobrepõem de verdade, porque o valor deixa de aparecer em impressão e apresentação.

## Empilhada com total

O ECharts não tem rótulo de total. Uma linha invisível, com os totais vindos do backend, faz esse papel. A transparência vem da cor: `opacity: 0` no `itemStyle` também apaga o rótulo. Sem largura para o número deitado, ele fica em pé com `rotate: 90`, em vez de sumir ou se sobrepor.

```ts
series: [
  ...stacks.map((s) => ({
    name: s.label,
    type: "bar",
    stack: "total",
    data: s.values.map(chartValue),
    itemStyle: { color: colorOf(s.key) },
  })),
  {
    name: "Total",
    type: "line",
    data: totals.map(chartValue),
    lineStyle: { color: "transparent" },
    itemStyle: { color: "transparent" },
    symbolSize: 1,
    silent: true,
    label: { show: true, position: "top", fontWeight: "bold", color: tokens.text, formatter: (p) => moneyCompact(p.value) },
  },
],
```

Rótulos dos segmentos ficam ligados quando couberem, calculados pela parte da faixa na coluna mais alta. Quando não couberem, o valor pode ficar na dica do mouse, e o total continua visível.

Número escrito dentro da barra colorida fica branco e em negrito. Fora da barra, o rótulo continua na cor de texto. Se a cor da barra for clara demais para o branco, use um tom mais escuro da mesma cor, em vez de trocar o número por texto escuro:

```ts
label: { show: true, position: "inside", color: "#ffffff", fontWeight: "bold", formatter: (p) => moneyCompact(p.value) },
```

Na faixa apagada pela seleção, o item transmite a transparência ao texto. Nela, dê ao rótulo `color: tokens.text` e `opacity: 1`, como o modelo faz.

A legenda fica fora do gráfico, em botões. Com `selectedMode: false`, a do ECharts não recebe clique; com ele ligado, oculta a série e deixa o total acima da coluna errado.

## Donut com o total no centro

O total e o percentual de cada fatia vêm do backend, para a tela não calcular.

```ts
title: {
  text: moneyCompact(total),
  left: "center",
  top: "middle",
  textStyle: { fontSize: 16, fontWeight: "bold", color: tokens.text },
},
tooltip: { valueFormatter: (v) => money(v) },
series: [{
  type: "pie",
  radius: ["48%", "68%"],
  center: ["50%", "50%"],
  data: slices.map((s) => ({
    name: s.label,
    value: chartValue(s.value),
    key: s.key,
    share: s.share,
    itemStyle: { color: colorOf(s.key) },
  })),
  label: { show: true, formatter: (p) => `${p.name}\n${moneyCompact(p.value)} · ${percent(p.data.share)}` },
}],
```

O rótulo de cada fatia já traz o nome, então o donut dispensa a legenda. Em tela estreita, os rótulos cortariam: desligue-os e mostre uma lista clicável abaixo do gráfico.

## AG Grid Community

A versão gratuita não tem agrupamento, tabela dinâmica nem exportação para Excel, que exigem licença paga. Subtotais e agrupamentos vêm prontos do backend. O AG Grid só exibe. A exportação gratuita é em CSV.

```tsx
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { AG_GRID_LOCALE_BR } from "@ag-grid-community/locale";

ModuleRegistry.registerModules([AllCommunityModule]); // obrigatório

// Valor decimal chega como texto. Em texto, "9" viria depois de "10".
const byNumber = (a: string | null, b: string | null) => (chartValue(a) ?? -Infinity) - (chartValue(b) ?? -Infinity);

const theme = themeQuartz.withParams({
  headerBackgroundColor: tokens.primary,
  headerTextColor: "#ffffff",
  borderRadius: 0,
  wrapperBorderRadius: 0,
  rowBorder: false,
  spacing: 4,
});

<AgGridReact
  theme={theme}
  localeText={AG_GRID_LOCALE_BR}
  rowData={rows}
  columnDefs={[
    { field: "label", headerName: "Região", pinned: "left" },
    { field: "value", headerName: "Valor (R$)", type: "rightAligned", comparator: byNumber, valueFormatter: (p) => moneyCompact(p.value), tooltipValueGetter: (p) => money(p.value) },
  ]}
  pinnedBottomRowData={[totals]} // total vindo do backend
/>;
```

Fixe `ag-grid-community`, `ag-grid-react` e `@ag-grid-community/locale` na mesma versão.

Com `domLayout="autoHeight"`, passe também `containerStyle={{ height: "auto" }}`. O padrão é `height: 100%`, e, dentro de um layout em grade, a altura da tabela empurra o que vem depois para fora do bloco.

**Linhas do detalhe, paginadas no servidor:** a grade só tem a página atual, então ela não pode ordenar por conta própria, porque ordenaria só o que está visível. Deixe `sortable: true` com um `comparator` que não muda a ordem, para a seta aparecer, leia a coluna em `onSortChanged` e mande a ordem e a `pagina` ao backend pela URL. Mostre os botões de página na tela.
