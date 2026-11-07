// Configuração dos gráficos. O número sempre passa pelo módulo de formatação.
import { chartValue, EMPTY, money, moneyCompact, month, percent } from "../../../shared/format.ts";
import type { Tokens } from "../../../web/src/tokens.ts";
import type { ByYear, Row } from "./types.ts";

type Params = { value: unknown; name?: string; data?: { share?: string | null } };

// Na tela, o valor é resumido. Na dica do mouse, exato.
const formatted = (value: unknown) => moneyCompact(value as string | number | null);
const exact = (value: unknown) => money(value as string | number | null);

// A cor segue a região em todos os gráficos, mesmo quando um filtro muda quantas aparecem.
const REGION_ORDER = ["Centro-Oeste", "Nordeste", "Norte", "Sudeste", "Sul"];
const regionColor = (region: string, tokens: Tokens) => tokens.series[REGION_ORDER.indexOf(region) % tokens.series.length];

/** O item fora da seleção fica claro. Se a seleção não está na lista, nada se apaga. */
const fadeFor = (keys: (string | null)[], selected: string | null) => {
  const active = selected !== null && keys.includes(selected);
  return (key: string | null) => (active && key !== selected ? 0.4 : 1);
};

// Faixa com menos que isto da coluna mais alta não comporta o texto: o valor fica na dica do mouse.
const MIN_SEGMENT_SHARE = 0.075;
// Número em pé precisa de cerca de um quarto da altura da coluna mais alta.
const MIN_STANDING_SHARE = 0.24;
// Acima disto, o número deitado sobrepõe o vizinho.
export const MAX_LYING_COLUMNS = 12;

/** No celular, muitos anos não cabem em colunas: viram linhas, em que todo total cabe por extenso. */
export const yearsAsLines = (narrow: boolean, years: number) => narrow && years > MAX_LYING_COLUMNS;

/** Os meses de um ano incompleto: "até set", "ago a out", "set" ou "3 meses", se não forem seguidos. */
function partialText(year: string, { months, first, last }: { months: number; first: number; last: number }) {
  const name = (number: number) => month(`${year}-${String(number).padStart(2, "0")}`).split("/")[0];
  if (last - first + 1 !== months) return `${months} meses`;
  if (first === last) return name(first);
  return first === 1 ? `até ${name(last)}` : `${name(first)} a ${name(last)}`;
}

export function stackedByYear(data: ByYear, selected: string | null, tokens: Tokens, { narrow, rotate, selectedSeries }: { narrow: boolean; rotate: boolean; selectedSeries: string | null }) {
  const fade = fadeFor(data.categories, selected);
  const fadeSeries = fadeFor(data.series.map((s) => s.key), selectedSeries);
  const tallest = Math.max(...data.totals.map((value) => chartValue(value) ?? 0), 1);
  const lines = yearsAsLines(narrow, data.categories.length);
  const partial = data.partial;
  const categoryAxis = {
    type: "category",
    data: data.categories,
    axisLine: { show: false },
    axisTick: { show: false },
    // Todos os anos aparecem, mesmo em tela estreita.
    axisLabel: {
      color: tokens.text,
      interval: 0,
      fontSize: narrow ? 10 : 12,
      // Ano incompleto diz os meses, para não parecer queda.
      ...(partial ? { formatter: (year: string) => (partial[year] ? `${year}${lines ? " " : "\n"}${lines ? `(${partialText(year, partial[year])})` : partialText(year, partial[year])}` : year) } : {}),
    },
  };
  const valueAxis = { type: "value", show: false };
  return {
    tooltip: { trigger: "axis", valueFormatter: exact },
    grid: lines
      ? { left: 4, right: 76, top: 4, bottom: 4, containLabel: true }
      : { left: 8, right: 8, top: rotate ? 100 : 28, bottom: 4, containLabel: true },
    xAxis: lines ? valueAxis : categoryAxis,
    yAxis: lines ? { ...categoryAxis, inverse: true } : valueAxis,
    series: [
      ...data.series.map((series) => ({
        name: series.label,
        type: "bar",
        stack: "total",
        data: series.values.map((value, i) => {
          const opacity = Math.min(fade(data.categories[i]), fadeSeries(series.key));
          return {
            value: chartValue(value),
            itemStyle: { opacity },
            // Na faixa apagada, texto escuro e opaco: o item apagado transmite a transparência ao rótulo.
            ...(opacity < 1 ? { label: { color: tokens.text, opacity: 1 } } : {}),
          };
        }),
        itemStyle: { color: regionColor(series.key, tokens) },
        label: {
          // O valor de cada região aparece na faixa, quando há espaço para ler.
          // Com uma só, ele seria igual ao total acima da coluna.
          show: !narrow && data.series.length > 1,
          position: "inside",
          rotate: rotate ? 90 : 0,
          color: "#ffffff",
          fontSize: 11,
          formatter: (p: Params) => ((chartValue(p.value as string) ?? 0) / tallest >= (rotate ? MIN_STANDING_SHARE : MIN_SEGMENT_SHARE) ? formatted(p.value) : ""),
        },
      })),
      {
        // O ECharts não tem rótulo de total: uma linha invisível faz esse papel.
        // Transparência pela cor: opacity no itemStyle também apaga o rótulo.
        name: "Total",
        type: "line",
        data: data.totals.map(chartValue),
        lineStyle: { color: "transparent" },
        itemStyle: { color: "transparent" },
        symbolSize: 1,
        silent: true,
        label: {
          show: true,
          position: lines ? "right" : "top",
          fontWeight: "bold",
          fontSize: 11,
          color: tokens.text,
          // Sem largura para o número deitado, ele fica em pé, sem esconder nem sobrepor.
          ...(rotate && !lines ? { rotate: 90, align: "left", verticalAlign: "middle" } : {}),
          formatter: (p: Params) => formatted(p.value),
        },
      },
    ],
  };
}

/** Só com o mês ligado. Mês sem dado no recorte fica com um traço, e nunca com uma coluna de zero. */
export function monthColumns(rows: Row[], selected: string | null, tokens: Tokens, narrow: boolean) {
  const fade = fadeFor(rows.map((r) => r.key), selected);
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (value: unknown) => (value === 0 ? EMPTY : exact(value)),
    },
    grid: { left: 8, right: 8, top: narrow ? 72 : 24, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: rows.map((r) => r.label),
      axisLine: { show: false },
      axisTick: { show: false },
      // No celular, doze "jan/25" se sobrepõem. O ano já está no título.
      axisLabel: { color: tokens.text, interval: 0, fontSize: narrow ? 10 : 12, ...(narrow ? { formatter: (label: string) => label.split("/")[0] } : {}) },
    },
    yAxis: { type: "value", show: false },
    series: [{
      type: "bar",
      data: rows.map((r) => (r.value === null
        ? { value: 0, key: r.key, label: { opacity: 1, formatter: EMPTY } }
        : { value: chartValue(r.value), key: r.key, itemStyle: { opacity: fade(r.key) }, label: { opacity: 1 } })),
      itemStyle: { color: tokens.primary },
      label: {
        show: true,
        position: "top",
        fontWeight: "bold",
        fontSize: 11,
        color: tokens.text,
        ...(narrow ? { rotate: 90, align: "left", verticalAlign: "middle" } : {}),
        formatter: (p: Params) => formatted(p.value),
      },
    }],
  };
}

export function horizontalBars(rows: Row[], selected: string | null, tokens: Tokens) {
  const fade = fadeFor(rows.map((r) => r.key), selected);
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: exact },
    grid: { left: 8, right: 90, top: 4, bottom: 4, containLabel: true },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tokens.text },
    },
    series: [{
      type: "bar",
      data: rows.map((r) => ({ value: chartValue(r.value), key: r.key, itemStyle: { opacity: fade(r.key) }, label: { opacity: 1 } })),
      itemStyle: { color: tokens.primary },
      label: { show: true, position: "right", fontWeight: "bold", fontSize: 11, color: tokens.text, formatter: (p: Params) => formatted(p.value) },
    }],
  };
}

export function regionDonut(rows: Row[], total: string | null, selected: string | null, tokens: Tokens, narrow: boolean) {
  const fade = fadeFor(rows.map((r) => r.key), selected);
  return {
    title: {
      text: formatted(total),
      left: "center",
      top: "middle",
      textStyle: { fontSize: 13, fontWeight: "bold", color: tokens.text },
    },
    tooltip: { valueFormatter: exact },
    series: [{
      // Com o mesmo id, o ECharts atualiza as fatias. Sem ele, ele as refaz do zero a cada clique, e o segundo clique não acerta a fatia enquanto ela volta a se abrir.
      id: "regioes",
      type: "pie",
      radius: narrow ? ["55%", "85%"] : ["48%", "68%"],
      center: ["50%", "50%"],
      data: rows.map((r) => ({
        name: r.label,
        value: chartValue(r.value),
        key: r.key,
        share: r.share,
        itemStyle: { color: regionColor(r.label, tokens), opacity: fade(r.key) },
        label: { opacity: 1 },
      })),
      // Em tela estreita, o rótulo cortaria: os valores vão para a lista abaixo do gráfico.
      label: {
        show: !narrow,
        color: tokens.text,
        fontSize: 11,
        formatter: (p: Params) => `${p.name}\n${formatted(p.value)}\n${percent(p.data?.share)}`,
      },
    }],
  };
}

/** Itens da legenda, na ordem e na cor da pilha. */
export const regionLegend = (data: ByYear, tokens: Tokens) =>
  data.series.map((s) => ({ key: s.key, label: s.label, color: regionColor(s.key, tokens) }));

/** A pilha segue sempre a mesma ordem. */
export const sortRegions = (data: ByYear): ByYear => ({
  ...data,
  series: [...data.series].sort((a, b) => REGION_ORDER.indexOf(a.key) - REGION_ORDER.indexOf(b.key)),
});
