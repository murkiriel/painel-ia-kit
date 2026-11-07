// Gráfico de meses, só com o mês ligado. É um componente à parte para a busca não existir com ele desligado.
import { panelQuery } from "../../../shared/filters.ts";
import { Block } from "../../../web/src/components/Block.tsx";
import { Chart } from "../../../web/src/components/Chart.tsx";
import { usePanel } from "../../../web/src/hooks.ts";
import type { Tokens } from "../../../web/src/tokens.ts";
import { monthColumns } from "./charts.ts";
import { MONTH_HELP } from "./indicators.ts";
import type { ByMonth } from "./types.ts";

type Props = {
  search: string;
  selected: string | null;
  onSelect: (key: string) => void;
  onClear: () => void;
  tokens: Tokens;
  narrow: boolean;
  scope: string;
};

export function MonthBlock({ search, selected, onSelect, onClear, tokens, narrow, scope }: Props) {
  const months = usePanel<ByMonth>("by-month", panelQuery(search, null));
  return (
    <Block
      title={`Valor da produção (R$) por mês${scope ? ` · ${scope}` : ""}`}
      help={MONTH_HELP.byMonth}
      state={months.state}
      retry={months.retry}
      isEmpty={(d) => d.year !== null && d.rows.every((r) => r.value === null)}
      onClear={onClear}
      minHeight={narrow ? 300 : 240}
      children={(d) => (d.year === null ? (
        <div className="state" style={{ minHeight: 120 }}>Escolha um ano para ver os meses dele.</div>
      ) : (
        <Chart
          label="Valor da produção por mês"
          height={narrow ? 300 : 240}
          option={monthColumns(d.rows, selected, tokens, narrow)}
          onSelect={onSelect}
          bands={{ axis: "x", keys: d.rows.map((r) => r.key) }}
          items={d.rows.map((r) => ({ key: r.key!, label: r.label }))}
        />
      ))}
    />
  );
}
