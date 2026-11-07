import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import langPTbr from "echarts/lib/i18n/langPT-br.js";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([BarChart, LineChart, PieChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);
echarts.registerLocale("PT-br", langPTbr);

export type SelectItem = { key: string; label: string };
export type LegendItem = SelectItem & { color: string };

type Props = {
  option: echarts.EChartsCoreOption;
  height: number;
  label: string;
  onSelect?: (key: string) => void;
  /**
   * Torna clicável a faixa inteira de cada categoria, com o nome e o número, em vez de só a marca.
   * Sem isso, a barra de um item pequeno fica impossível de acertar. Chave nula não filtra, como "Outros".
   */
  bands?: { axis: "x" | "y"; keys: (string | null)[] };
  /** Lista para quem usa o teclado: o gráfico não recebe foco, mas este seletor sim. */
  items?: SelectItem[];
  /**
   * Legenda em botões: o clique filtra, e o teclado alcança. A legenda do ECharts só recebe clique
   * ocultando a série, o que deixaria o total errado. Com uma série só, o título já diz qual é.
   */
  legend?: { items: LegendItem[]; selected: string | null; onSelect: (key: string) => void };
};

export function Chart({ option, height, label, onSelect, bands, items, legend }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const select = useRef(onSelect);
  const currentBands = useRef(bands);
  select.current = onSelect;
  const clickable = onSelect !== undefined;
  currentBands.current = bands;
  const shownData = useRef("");

  useEffect(() => {
    const instance = echarts.init(element.current!, undefined, { renderer: "canvas", locale: "PT-br" });
    chart.current = instance;

    const bandKey = (x: number, y: number): string | null => {
      const current = currentBands.current;
      if (!current) return null;
      const finder = current.axis === "y" ? { yAxisIndex: 0 } : { xAxisIndex: 0 };
      const index = Math.round(Number(instance.convertFromPixel(finder, current.axis === "y" ? y : x)));
      return current.keys[index] ?? null;
    };

    instance.on("click", (params) => {
      if (currentBands.current) return; // a faixa cuida do clique
      // Clique em item sem chave, como "Outros", não filtra.
      const key = (params.data as { key?: string | null } | undefined)?.key;
      if (key != null) select.current?.(key);
    });
    const zr = instance.getZr();
    zr.on("click", (event) => {
      const key = bandKey(event.offsetX, event.offsetY);
      if (key !== null) select.current?.(key);
    });
    zr.on("mousemove", (event) => {
      if (currentBands.current) zr.setCursorStyle(select.current && bandKey(event.offsetX, event.offsetY) !== null ? "pointer" : "default");
    });

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      instance.dispose();
    };
  }, []);

  useEffect(() => {
    // Sem onSelect, o item não filtra e não mostra a mãozinha.
    const series = (option as { series?: object[] }).series;
    const plain = !clickable && series ? { ...option, series: series.map((item) => ({ ...item, cursor: "default" })) } : option;
    // Dado novo: a dica aberta ficaria com os números velhos, e o ECharts falha ao refazê-la sobre uma série que saiu.
    const data = JSON.stringify(series);
    if (data !== shownData.current) {
      chart.current?.dispatchAction({ type: "hideTip" });
      shownData.current = data;
    }
    // replaceMerge retira a série que saiu; sem isso, ela fica na tela com número velho.
    chart.current?.setOption(plain, { replaceMerge: ["series"] });
  }, [option, clickable]);

  return (
    <>
      <div ref={element} role="img" aria-label={label} style={{ width: "100%", height }} />
      {legend && legend.items.length > 1 && (
        <div className="chart-legend" role="group" aria-label={`Filtrar pela legenda: ${label}`}>
          {legend.items.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={legend.selected === item.key}
              className={legend.items.some((i) => i.key === legend.selected) && legend.selected !== item.key ? "faded" : undefined}
              title={legend.selected === item.key ? "Retirar este filtro" : `Filtrar por ${item.label}`}
              onClick={() => legend.onSelect(item.key)}
            >
              <span style={{ background: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
      )}
      {items && onSelect && (
        <select
          className="chart-keyboard"
          aria-label={`Selecionar no gráfico: ${label}`}
          value=""
          onChange={(event) => {
            if (event.target.value) onSelect(event.target.value);
          }}
        >
          <option value="">Selecionar no gráfico: {label}</option>
          {items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      )}
    </>
  );
}
