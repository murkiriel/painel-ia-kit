import { AG_GRID_LOCALE_BR } from "@ag-grid-community/locale";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type RowStyle } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo } from "react";
import { setFilter } from "../../../shared/filters.ts";
import { decimal, money, moneyCompact, month, quantity } from "../../../shared/format.ts";
import { Block } from "../../../web/src/components/Block.tsx";
import { useMedia, type usePanel } from "../../../web/src/hooks.ts";
import type { Tokens } from "../../../web/src/tokens.ts";
import { HELP, MONTH_HELP, SITE_DETAIL_HELP } from "./indicators.ts";
import { detailControls, detailTitle, totalLabel } from "./screenRules.ts";
import type { Detail, DetailRow } from "./types.ts";
import { quantityText } from "./units.ts";

ModuleRegistry.registerModules([AllCommunityModule]);

const GROUPS = [
  // No site estático, a tabela vai até o menor agregado publicado, e o nome diz qual é.
  { key: "", label: __STATIC_SITE__ ? "Ano, UF e lavoura" : "Linhas de origem" },
  { key: "ano", label: "Por ano", column: "Ano" },
  { key: "mes", label: "Por mês", column: "Mês" }, // só com o mês ligado
  { key: "regiao", label: "Por região", column: "Região" },
  { key: "uf", label: "Por UF", column: "UF" },
  { key: "lavoura", label: "Por lavoura", column: "Lavoura" },
];

// A grade só tem a página atual, então quem ordena é o backend. Aqui ela só mostra a seta.
const KEEP_SERVER_ORDER = () => 0;

type Props = {
  panel: ReturnType<typeof usePanel<Detail>>;
  search: string;
  navigate: (query: string, options?: { replace?: boolean }) => void;
  onClear: () => void;
  tokens: Tokens;
  /** O período dos filtros, mais o lugar e o item. Serve até a tabela dizer o que ela soma. */
  scope: string;
  place: string[];
  hasMonth: boolean;
};

export function DetailTable({ panel, search, navigate, onClear, tokens, scope, place, hasMonth }: Props) {
  const params = new URLSearchParams(search);
  const by = params.get("por") ?? "";
  const page = Number(params.get("pagina") ?? 1);
  const order = params.get("ordem") ?? "valor";
  const direction = params.get("dir") === "asc" ? "asc" : "desc";
  const group = GROUPS.find((g) => g.key === by);
  const narrow = useMedia("(max-width: 800px)");
  // Abaixo desta largura, as colunas pedem rolagem lateral.
  const scrolls = useMedia("(max-width: 1100px)");
  const shown = panel.state.status === "error" ? undefined : panel.state.data;
  const { showsQuantity, showsArea, cutOrder, otherOrder, blockedByRow, sortable: sortableColumns } = detailControls(search, shown?.count, { hasMonth, staticSite: __STATIC_SITE__ });
  const sortableList = sortableColumns.join();
  // A linha de total pode dizer um intervalo: a primeira coluna precisa caber o texto, também no celular.
  const totalText = totalLabel(shown?.totals);
  const firstColumnWidth = Math.ceil(totalText.length * 7.2) + 28;

  const theme = useMemo(() => themeQuartz.withParams({
    headerBackgroundColor: tokens.primary,
    headerTextColor: "#ffffff",
    borderRadius: 0,
    wrapperBorderRadius: 0,
    spacing: 4,
    fontFamily: "inherit",
    fontSize: 13,
  }), [tokens]);

  const columns = useMemo<ColDef<DetailRow>[]>(() => {
    // Sem o estado "sem ordem": o clique sempre muda alguma coisa, e a seta sempre diz a verdade.
    const sorted = (name: string, first: "asc" | "desc", visible = true): ColDef<DetailRow> => ({
      colId: name,
      sortable: sortableList.split(",").includes(name),
      sortingOrder: first === "desc" ? ["desc", "asc"] : ["asc", "desc"],
      comparator: KEEP_SERVER_ORDER,
      sort: visible && order === name ? direction : null,
    });
    const textTip = (field: keyof DetailRow) => ({ tooltipField: field });
    const value: ColDef<DetailRow> = {
      ...sorted("valor", "desc"),
      // A grade tira a seta da coluna que não ordena. Aqui a ordem continua sendo esta, e a seta precisa continuar dizendo.
      headerName: cutOrder ? "↓ Valor (R$)" : "Valor (R$)", field: "value", type: "rightAligned", flex: 1, minWidth: 110,
      valueFormatter: (p) => moneyCompact(p.value),
      tooltipValueGetter: (p) => money(p.value), // o valor exato
    };
    const rest: ColDef<DetailRow>[] = [
      {
        ...sorted("quantidade", "desc", showsQuantity), headerName: "Quantidade", field: "quantity", type: "rightAligned", flex: 1, minWidth: 130,
        valueFormatter: (p) => quantityText(p.value, p.data?.quantity_unit),
        tooltipValueGetter: (p) => quantityText(p.value, p.data?.quantity_unit),
      },
      { ...sorted("area", "desc", showsArea), headerName: "Área colhida (ha)", field: "area", type: "rightAligned", flex: 1, minWidth: 130, valueFormatter: (p) => quantity(p.value, "ha") },
    ];
    if (by) {
      const asMonth: ColDef<DetailRow> = by === "mes" ? { valueFormatter: (p) => (p.node?.rowPinned ? p.value : month(p.value)) } : {};
      return [{ ...sorted("nome", "asc"), ...textTip("label"), ...asMonth, headerName: group?.column ?? "Item", field: "label", pinned: "left", flex: 1, minWidth: Math.max(130, firstColumnWidth) }, value, ...rest];
    }
    const year: ColDef<DetailRow> = hasMonth
      ? { ...sorted("mes", "desc"), headerName: "Mês", width: 90, valueGetter: (p) => (p.data?.year ? month(`${p.data.year}-${String(p.data.month).padStart(2, "0")}`) : "") }
      : { ...sorted("ano", "desc"), headerName: "Ano", field: "year", width: 90 };
    const state: ColDef<DetailRow> = { ...sorted("uf", "asc"), ...textTip("state_name"), headerName: "UF", field: "state_name", flex: 1, minWidth: Math.max(120, firstColumnWidth) };
    const region: ColDef<DetailRow> = { ...sorted("regiao", "asc"), headerName: "Região", field: "region", width: 120 };
    const crop: ColDef<DetailRow> = { ...sorted("lavoura", "asc"), ...textTip("crop_name"), headerName: "Lavoura", field: "crop_name", flex: 1, minWidth: 170 };
    // No celular, o valor fica à vista logo depois do nome.
    if (narrow) return [{ ...state, pinned: "left" }, value, crop, year, region, ...rest];
    return [{ ...year, pinned: "left" }, state, region, crop, value, ...rest];
  }, [by, group, order, direction, narrow, showsQuantity, showsArea, hasMonth, sortableList, cutOrder, firstColumnWidth]);

  const goTo = (next: number, options?: { replace?: boolean }) => {
    const query = new URLSearchParams(window.location.search);
    if (next <= 1) query.delete("pagina");
    else query.set("pagina", String(next));
    navigate(query.toString(), options);
  };

  // Página além do fim leva à última, em vez de mostrar uma tabela vazia.
  const lastPage = panel.state.status === "ok" ? Math.max(1, Math.ceil(panel.state.data.count / panel.state.data.pageSize)) : null;
  useEffect(() => {
    if (lastPage !== null && page > lastPage) goTo(lastPage, { replace: true });
  });

  const chooseGroup = (value: string) => {
    const query = new URLSearchParams(setFilter(window.location.search, "por", value || null));
    // Cada visão tem colunas próprias, então a ordem anterior não vale.
    query.delete("ordem");
    query.delete("dir");
    navigate(query.toString());
  };

  return (
    <Block
      title={detailTitle(shown?.totals, scope, place)}
      help={__STATIC_SITE__ ? SITE_DETAIL_HELP : hasMonth ? MONTH_HELP.detail : HELP.detail}
      state={panel.state}
      retry={panel.retry}
      isEmpty={(d) => d.totals.lines === 0}
      onClear={onClear}
      minHeight={200}
      children={(d) => {
        const pages = Math.max(1, Math.ceil(d.count / d.pageSize));
        const total: DetailRow = {
          [by ? "label" : "state_name"]: totalText,
          value: d.totals.value,
          quantity: d.totals.quantity,
          quantity_unit: d.totals.quantityUnit,
          area: d.totals.area,
        };
        return (
          <>
            <div className="detail-tools">
              <label>
                Detalhar:{" "}
                <select value={by} onChange={(e) => chooseGroup(e.target.value)}>
                  {GROUPS.filter((g) => hasMonth || g.key !== "mes").map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </label>
              {by && !blockedByRow && <span className="detail-hint">{__STATIC_SITE__ ? "Clique em uma linha para filtrar por ela." : "Clique em uma linha para ver as linhas de origem dela."}</span>}
              {__STATIC_SITE__ && <span className="detail-hint">Menor agregado publicado: ano, UF e lavoura.</span>}
              {cutOrder && <span className="detail-hint">Com lavoura e região juntas, a tabela fica na ordem por valor.</span>}
              {otherOrder && sortableColumns.length > 0 && <span className="detail-hint">Nesta ordem, só a primeira página foi publicada. As outras estão na ordem por valor, do maior para o menor.</span>}
              {!d.totals.quantity && <span className="detail-hint">Total de quantidade: escolha uma lavoura.</span>}
              {!d.totals.area && !params.has("mes") && <span className="detail-hint">Total de área: escolha um {hasMonth ? "mês" : "ano"}.</span>}
            </div>
            <AgGridReact<DetailRow>
              theme={theme}
              localeText={AG_GRID_LOCALE_BR}
              rowData={d.rows}
              columnDefs={columns}
              pinnedBottomRowData={[total]}
              domLayout="autoHeight"
              // O padrão é height: 100%, que em layout de grade empurra a paginação para fora do bloco.
              containerStyle={{ height: "auto" }}
              suppressMovableColumns
              tooltipShowDelay={300}
              // A barra de rolagem lateral fica fora das linhas, sem cobrir a última.
              alwaysShowHorizontalScroll={scrolls}
              getRowStyle={(p): RowStyle | undefined => (p.node.rowPinned ? { fontWeight: 700, background: tokens.primary, color: "#ffffff" } : by && !blockedByRow ? { cursor: "pointer" } : undefined)}
              onSortChanged={(e) => {
                if (e.source !== "uiColumnSorted") return;
                const column = e.api.getColumnState().find((c) => c.sort);
                const query = new URLSearchParams(window.location.search);
                query.delete("pagina");
                query.delete("ordem");
                query.delete("dir");
                if (column) {
                  query.set("ordem", column.colId);
                  query.set("dir", column.sort ?? "desc");
                }
                navigate(query.toString());
              }}
              onRowClicked={(e) => {
                // Do agrupado para as linhas: filtra pelo item e volta para as linhas de origem.
                if (!by || blockedByRow || e.node.rowPinned || !e.data?.key) return;
                const related = by === "regiao" ? ["uf"] : by === "uf" ? ["regiao"] : [];
                const current = window.location.search;
                const query = new URLSearchParams(by === "mes"
                  ? setFilter(setFilter(current, "ano", e.data.key.slice(0, 4)), "mes", String(Number(e.data.key.slice(5))))
                  : setFilter(current, by, e.data.key, related));
                query.delete("por");
                query.delete("ordem");
                query.delete("dir");
                navigate(query.toString());
              }}
            />
            <div className="pager">
              <span>{decimal(d.count)} {d.count === 1 ? "linha" : "linhas"} · Página {decimal(Math.min(page, pages))} de {decimal(pages)}</span>
              <button type="button" disabled={page <= 1} onClick={() => goTo(page - 1)}>Anterior</button>
              <button type="button" disabled={page >= pages || otherOrder} onClick={() => goTo(page + 1)}>Próxima</button>
            </div>
          </>
        );
      }}
    />
  );
}
