import { useEffect, useMemo } from "react";
import { activeSelections, clearFilters, hasFilters, panelQuery, selectedValue, setFilter, toggleSelection } from "../../../shared/filters.ts";
import { dateTime, decimal, money, moneyCompact, month, percent, periodText, quantity, variation } from "../../../shared/format.ts";
import { isStale, STALE_MESSAGE } from "../shared/staticSite.ts";
import { Block, Help } from "../../../web/src/components/Block.tsx";
import { Chart } from "../../../web/src/components/Chart.tsx";
import { holdClickedPlace } from "../../../web/src/components/clickAnchor.ts";
import { MapBlock } from "../../../web/src/components/MapBlock.tsx";
import type { Shapes } from "../../../web/src/components/mapRules.ts";
import { useFilters, useMedia, usePanel } from "../../../web/src/hooks.ts";
import { readTokens } from "../../../web/src/tokens.ts";
import { horizontalBars, MAX_LYING_COLUMNS, regionDonut, regionLegend, sortRegions, stackedByYear, yearsAsLines } from "./charts.ts";
import { DetailTable } from "./DetailTable.tsx";
import { HELP, MONTH_HELP } from "./indicators.ts";
import { MonthBlock } from "./MonthBlock.tsx";
import { blockedControls, chooseYearQuery, correctedLink, outOfPermission, screenQueries } from "./screenRules.ts";
import type { ByYear, Detail, FilterOptions, Rows, Summary } from "./types.ts";
import { quantityText, together } from "./units.ts";

const ALL_YEARS = "todos";
const NO_ROWS = (data: Rows) => data.rows.length === 0;
const SELECT_ITEMS = (rows: Rows["rows"]) => rows.flatMap((r) => (r.key === null ? [] : [{ key: r.key, label: r.label }]));
// Os contornos ficam em um pedaço separado, baixado só com o mapa.
const loadStateShapes = () => import("./ufs.geo.json").then((module) => module.default as unknown as Shapes);
const STATE_PROPERTIES = { id: "codarea", short: "sigla", name: "nome" };
// Com o mapa em meia tela, o oceano à direita recebe os rótulos dos estados pequenos do litoral.
const STATE_MAP_ROOM = 0.14;

export function Dashboard({ onScope, hasMonth }: { onScope: (scope: string) => void; hasMonth: boolean }) {
  const { search, navigate } = useFilters();
  const tokens = useMemo(readTokens, []);

  // Em um link antigo, o seletor e o clique podem disputar a mesma dimensão.
  useEffect(() => {
    const fixed = correctedLink(search, __STATIC_SITE__);
    if (fixed !== null) navigate(fixed, { replace: true });
  }, [search, navigate]);

  const narrow = useMedia("(max-width: 800px)");

  const queries = screenQueries(search, hasMonth);
  const options = usePanel<FilterOptions>("filter-options", queries.options);
  const summary = usePanel<Summary>("summary", queries.summary);
  // O gráfico por ano mostra sempre a evolução: ele ignora o ano escolhido e o destaca.
  const years = usePanel<ByYear>("by-year", queries.years);
  const regions = usePanel<Rows>("by-region", queries.regions);
  const states = usePanel<Rows>("by-state", queries.states);
  // A mesma consulta do gráfico por UF. O mapa não filtra a si mesmo, então ele tem a própria seleção.
  const stateMap = usePanel<Rows>("by-state", queries.map);
  const crops = usePanel<Rows>("by-crop", queries.crops);
  const detail = usePanel<Detail>("detail", queries.detail);

  const params = new URLSearchParams(search);
  const clear = () => navigate(clearFilters(window.location.search));
  // Lê a URL no momento do clique: o gráfico registra o clique uma vez só.
  const select = (panel: string, dimension: string) => (key: string) =>
    navigate(toggleSelection(window.location.search, panel, dimension, key));
  const blocked = blockedControls(search, __STATIC_SITE__);

  const optionData = options.state.status === "error" ? undefined : options.state.data;
  const summaryData = summary.state.status === "error" ? undefined : summary.state.data;
  const latestYear = optionData?.latestYear === null || optionData?.latestYear === undefined ? null : String(optionData.latestYear);
  const yearParam = params.get("ano");
  const shownYear = yearParam === ALL_YEARS ? null : yearParam ?? latestYear;
  const monthParam = hasMonth ? params.get("mes") : null;
  // Em um link inválido, sem ano, o mês sozinho não diz um período.
  const monthName = (key: string) => (shownYear ? month(`${shownYear}-${key.padStart(2, "0")}`) : null);
  // Com o mês ligado, o período vem do próprio resultado, para o título não prometer mais do que os números mostram.
  const monthPeriod = summaryData?.firstPeriod ? periodText(summaryData.firstPeriod, summaryData.lastPeriod, summaryData.monthsCovered) : monthParam ? monthName(monthParam) : null;

  const labelOf = (dimension: string, key: string) => {
    if (dimension === "mes") return monthName(key) ?? key;
    if (dimension === "uf" || dimension === "lavoura") return optionData?.labels[dimension][key] ?? key;
    return key;
  };
  // No título, sem o nome, é melhor não dizer nada do que mostrar um código.
  const titleLabel = (dimension: "uf" | "lavoura", key: string) => optionData?.labels[dimension][key] ?? null;

  // O título diz o escopo de cada bloco, inclusive o que veio de outro gráfico e a permissão de quem vê.
  const periodOf = (panel: string | null) => {
    const year = new URLSearchParams(panelQuery(search, panel)).get("ano");
    const first = summaryData?.firstYear;
    const last = summaryData?.lastYear;
    return monthPeriod ?? (year === ALL_YEARS
      ? first && last ? (first === last ? String(first) : `acumulado de ${first} a ${last}`) : "acumulado"
      : year ?? latestYear ?? last ?? "");
  };
  const placeOf = (panel: string | null) => {
    const query = new URLSearchParams(panelQuery(search, panel));
    const state = query.get("uf");
    const crop = query.get("lavoura");
    return [state ? titleLabel("uf", state) : query.get("regiao") ?? optionData?.scopeLabel ?? "", crop ? titleLabel("lavoura", crop) : null].filter((part): part is string => Boolean(part));
  };
  const scopeOf = (panel: string | null) => [periodOf(panel), ...placeOf(panel)].filter(Boolean).join(" · ");

  const period = !summaryData || summaryData.firstYear === null
    ? "—"
    : summaryData.firstYear === summaryData.lastYear
      ? String(summaryData.firstYear)
      : `${summaryData.firstYear} a ${summaryData.lastYear}`;

  const scope = scopeOf(null);
  // O gráfico por ano mostra todos os anos: o título não pode dizer um só.
  const shownYears = years.state.status === "error" ? undefined : years.state.data?.categories;
  const yearsScope = [
    shownYears?.length ? (shownYears.length > 1 ? `${shownYears[0]} a ${shownYears.at(-1)}` : shownYears[0]) : null,
    ...placeOf("anos"),
  ].filter(Boolean).join(" · ");
  useEffect(() => onScope(scope), [scope, onScope]);

  // Lista com o valor escolhido, mesmo que ele não exista no recorte atual.
  const withCurrent = (name: "ano" | "mes" | "regiao" | "uf" | "lavoura", list: FilterOptions["uf"] = []) => {
    const current = params.get(name);
    if (!current || current === ALL_YEARS || list.some((o) => o.key === current)) return list;
    return [{ key: current, label: labelOf(name, current) }, ...list];
  };

  // Mudar a região tira a UF, que pode não fazer parte dela.
  const chooseRegion = (value: string | null) => navigate(setFilter(setFilter(window.location.search, "uf", null), "regiao", value, ["uf"]));
  const chooseState = (value: string | null) => navigate(setFilter(window.location.search, "uf", value, ["regiao"]));
  const chooseCrop = (value: string | null) => navigate(setFilter(window.location.search, "lavoura", value));
  const chooseYear = (value: string | null) => {
    navigate(chooseYearQuery(window.location.search, value, hasMonth, optionData?.monthsByYear));
  };
  // O mês sempre vai com o ano na URL: assim o link copiado não muda de sentido quando entra um ano novo.
  const chooseMonth = (value: string | null) => {
    if (shownYear) navigate(setFilter(setFilter(window.location.search, "ano", shownYear), "mes", value));
  };

  // Clicar no ano equivale a escolher no seletor. Clicar no ano já escolhido volta ao mais recente.
  const clickYear = (key: string) => chooseYear(key === yearParam ? null : key);
  const clickMonth = (key: string) => chooseMonth(key === monthParam ? null : key);
  // Clicar na legenda filtra os outros blocos. Este gráfico continua inteiro e destaca a região.
  const clickSeries = (key: string) => navigate(toggleSelection(window.location.search, "anos", "regiao", key));

  if (__STATIC_SITE__ && options.state.status === "error" && options.state.unpublished) {
    return (
      <main className="page">
        <section className="block state" role="alert">
          <span>Este link combina filtros que não foram publicados neste site. {options.state.message}</span>
          <button type="button" onClick={() => navigate("")}>Voltar ao início</button>
        </section>
      </main>
    );
  }

  if (optionData && !optionData.hasAccess) {
    return (
      <main className="page">
        <section className="block" role="alert">
          <h2 className="block-title">Sem acesso</h2>
          <p>Seu usuário não tem acesso a estes dados. Fale com quem administra o dashboard.</p>
        </section>
      </main>
    );
  }

  // A mesma mensagem para toda UF ou região de fora, sem título nem número: não diz se há dado lá.
  if (optionData && outOfPermission(search, optionData.labels)) {
    return (
      <main className="page">
        <section className="block state" role="alert">
          <span>Este link pede um lugar fora da sua permissão. Fale com quem administra o dashboard se precisar dele.</span>
          <button type="button" onClick={() => navigate("")}>Voltar ao início</button>
        </section>
      </main>
    );
  }

  return (
    // Antes de o clique chegar ao item: ele não pode sair do lugar, para o segundo clique acertar o mesmo.
    <main className="page" onClickCapture={(event) => holdClickedPlace(event.currentTarget, event.target as Element)}>
      <section className="filters" aria-label="Filtros">
        <label>
          Ano
          <select value={yearParam ?? ""} onChange={(e) => chooseYear(e.target.value || null)}>
            <option value="">Mais recente{latestYear ? ` (${latestYear})` : ""}</option>
            {withCurrent("ano", optionData?.ano).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            <option value={ALL_YEARS}>Todos os anos (acumulado)</option>
          </select>
        </label>
        {hasMonth && (
          <label>
            Mês
            <select value={monthParam ?? ""} disabled={shownYear === null} onChange={(e) => chooseMonth(e.target.value || null)}>
              <option value="">{shownYear === null ? "Escolha um ano" : "Todos do ano"}</option>
              {withCurrent("mes", optionData?.mes).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        )}
        <label>
          Região
          <select value={params.get("regiao") ?? ""} onChange={(e) => chooseRegion(e.target.value || null)}>
            <option value="">Todas</option>
            {withCurrent("regiao", optionData?.regiao).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label>
          UF
          <select value={params.get("uf") ?? ""} disabled={blocked.uf} onChange={(e) => chooseState(e.target.value || null)}>
            <option value="">Todas</option>
            {withCurrent("uf", optionData?.uf).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label>
          Lavoura
          <select value={params.get("lavoura") ?? ""} disabled={blocked.lavoura} onChange={(e) => chooseCrop(e.target.value || null)}>
            <option value="">Todas</option>
            {withCurrent("lavoura", optionData?.lavoura).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        {activeSelections(search).map(({ panel, dimension, value }) => (
          <button key={panel} className="chip" type="button" title="Retirar esta seleção" onClick={() => navigate(toggleSelection(window.location.search, panel, dimension, value))}>
            {labelOf(dimension, value)} ×
          </button>
        ))}
        <button type="button" onClick={clear} disabled={!hasFilters(search)}>Limpar filtros</button>
        {options.state.status === "error" && !options.state.invalidLink && (
          <span className="filter-error" role="alert">
            Não foi possível carregar as opções de filtro.{" "}
            <button type="button" onClick={options.retry}>Tentar de novo</button>
          </span>
        )}
        <span className="filters-info">
          Período: {monthPeriod ?? period} · Fonte: IBGE · Última atualização: {dateTime(summaryData?.updatedAt)}
        </span>
      </section>

      {__STATIC_SITE__ && (
        <section className="site-note" role="status">
          Site estático: os dados são da carga de {dateTime(summaryData?.updatedAt)}, sem consulta ao vivo.
          {blocked.uf && " Com lavoura escolhida, o filtro por UF fica desligado: o valor de cada UF está no mapa, no gráfico por UF e no detalhe."}
          {blocked.lavoura && " Com UF escolhida, o filtro por lavoura fica desligado: o valor de cada lavoura está no gráfico por lavoura e no detalhe."}
        </section>
      )}
      {__STATIC_SITE__ && !summaryData?.warnings?.includes(STALE_MESSAGE) && isStale(summaryData?.updatedAt, Date.now()) && <section className="warnings" role="status">{STALE_MESSAGE}</section>}
      {summaryData?.warnings?.length ? <section className="warnings" role="status">{summaryData.warnings.join(" ")}</section> : null}

      <Block
        title={`Indicadores · ${scope}`}
        help="Os principais números no recorte dos filtros. Cada cartão tem a própria explicação."
        state={summary.state}
        retry={summary.retry}
        minHeight={82}
        children={(s) => (
          <div className="kpis">
            <div className="kpi" title={money(s.value)}>
              <Help title="Valor da produção" text={HELP.value} />
              <strong>{together(moneyCompact(s.value))}</strong>
              <span>Valor da produção (R$){s.firstYear !== s.lastYear ? " acumulado" : ""}</span>
            </div>
            <div className="kpi">
              <Help title="Variação" text={hasMonth ? MONTH_HELP.variation : HELP.variation} />
              <strong>{variation(s.valueVariation)}</strong>
              <span>Variação nominal sobre o ano anterior</span>
              <small>
                {s.firstYear !== s.lastYear
                  ? "Escolha um ano"
                  : !s.previousValue
                    ? "Sem dado no ano anterior"
                    : !hasMonth
                      ? `Ano anterior: ${together(moneyCompact(s.previousValue))}`
                      : s.monthsPrevious === s.monthsCurrent
                        ? `Mesmos meses do ano anterior: ${together(moneyCompact(s.previousValue))}`
                        : `Sem variação: só ${s.monthsPrevious} de ${s.monthsCurrent} meses têm dado no ano anterior (${together(moneyCompact(s.previousValue))})`}
              </small>
              {s.listChanged && (
                <small style={{ color: "var(--color-warning)" }}>
                  Lista de lavouras mudou:{" "}
                  {[
                    s.addedCrops > 0 ? `${decimal(s.addedCrops)} ${s.addedCrops === 1 ? "entrou" : "entraram"} (${moneyCompact(s.addedValue)})` : "",
                    s.removedCrops > 0 ? `${decimal(s.removedCrops)} ${s.removedCrops === 1 ? "saiu" : "saíram"}` : "",
                  ].filter(Boolean).join(" e ")}. Não compara a mesma lista.
                </small>
              )}
            </div>
            <div className="kpi">
              <Help title="Quantidade" text={HELP.quantity} />
              <strong>{quantityText(s.quantity, s.quantityUnit)}</strong>
              <span>Quantidade produzida{s.quantity !== null && s.firstYear !== s.lastYear ? " acumulada" : ""}</span>
              {s.quantity === null && <small>{new URLSearchParams(panelQuery(search, null)).has("lavoura") ? "Sem dado neste recorte" : "Escolha uma lavoura"}</small>}
            </div>
            <div className="kpi">
              <Help title="Área colhida" text={hasMonth ? MONTH_HELP.area : HELP.area} />
              <strong>{together(quantity(s.area, "ha"))}</strong>
              <span>Área colhida (ha)</span>
              {s.area === null && s.crops > 0 && !monthParam && <small>{hasMonth ? "Escolha um mês" : "Escolha um ano"}</small>}
            </div>
            <div className="kpi">
              <Help title="Lavouras" text={HELP.crops} />
              <strong>{decimal(s.crops)}</strong>
              <span>Lavouras com produção</span>
            </div>
          </div>
        )}
      />

      <Block
        title={`Valor da produção (R$) por ano e região · ${yearsScope}`}
        help={hasMonth ? MONTH_HELP.byYear : HELP.byYear}
        state={years.state}
        retry={years.retry}
        isEmpty={(d) => d.totals.every((total) => total === null)}
        onClear={clear}
        minHeight={300}
        children={(d) => (
          <Chart
            label="Valor da produção por ano e região"
            height={yearsAsLines(narrow, d.categories.length) ? d.categories.length * 22 + 16 : narrow ? 350 : d.categories.length > MAX_LYING_COLUMNS ? 352 : 272}
            option={stackedByYear(sortRegions(d), shownYear, tokens, { narrow, rotate: narrow ? d.categories.length > 3 : d.categories.length > MAX_LYING_COLUMNS, selectedSeries: selectedValue(search, "anos") })}
            onSelect={clickYear}
            bands={{ axis: yearsAsLines(narrow, d.categories.length) ? "y" : "x", keys: d.categories }}
            legend={{ items: regionLegend(sortRegions(d), tokens), selected: selectedValue(search, "anos"), onSelect: clickSeries }}
            items={d.categories.map((year) => ({ key: year, label: year }))}
          />
        )}
      />

      {hasMonth && (
        <MonthBlock
          search={search}
          selected={monthParam}
          onSelect={clickMonth}
          onClear={clear}
          tokens={tokens}
          narrow={narrow}
          scope={[shownYear, ...placeOf(null)].filter(Boolean).join(" · ")}
        />
      )}

      <div className="columns">
        <Block
          title={`Mapa do valor da produção (R$) · ${scopeOf("mapa")}`}
          help={HELP.map}
          state={stateMap.state}
          retry={stateMap.retry}
          isEmpty={NO_ROWS}
          onClear={clear}
          minHeight={narrow ? 340 : 600}
          children={(d) => (
            <MapBlock
              label="Valor da produção por UF"
              loadShapes={loadStateShapes}
              properties={STATE_PROPERTIES}
              rows={d.rows}
              selected={selectedValue(search, "mapa")}
              onSelect={blocked.uf ? undefined : select("mapa", "uf")}
              tokens={tokens}
              format={moneyCompact}
              formatExact={money}
              caption="Contornos: IBGE, malha simplificada"
              rightRoom={STATE_MAP_ROOM}
              failureNote="Os valores por UF continuam no gráfico por UF."
            />
          )}
        />
        <Block
          title={`Valor da produção (R$) por UF · ${scopeOf("estados")}`}
          help={HELP.byState}
          state={states.state}
          retry={states.retry}
          isEmpty={NO_ROWS}
          onClear={clear}
          minHeight={600}
          children={(d) => (
            <Chart
              label="Valor da produção por UF"
              height={Math.max(160, d.rows.length * 24)}
              option={horizontalBars(d.rows, selectedValue(search, "estados"), tokens)}
              onSelect={blocked.uf ? undefined : select("estados", "uf")}
              bands={{ axis: "y", keys: d.rows.map((r) => r.key) }}
              items={SELECT_ITEMS(d.rows)}
            />
          )}
        />
      </div>

      <div className="columns">
        <Block
          title={`Participação no valor da produção (R$) por região · ${scopeOf("regioes")}`}
          help={HELP.byRegion}
          state={regions.state}
          retry={regions.retry}
          isEmpty={NO_ROWS}
          onClear={clear}
          minHeight={300}
          children={(d) => (
            <>
              <Chart
                label="Participação por região"
                height={300}
                option={regionDonut(d.rows, d.total ?? null, selectedValue(search, "regioes"), tokens, narrow)}
                onSelect={select("regioes", "regiao")}
                items={SELECT_ITEMS(d.rows)}
              />
              {narrow && (
                <ul className="value-list">
                  {d.rows.map((r) => (
                    <li key={r.label}>
                      <button type="button" aria-pressed={selectedValue(search, "regioes") === r.key} onClick={() => r.key && select("regioes", "regiao")(r.key)}>
                        <span>{r.label}</span><strong>{moneyCompact(r.value)}</strong><span>{percent(r.share)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        />
        <Block
          title={`Valor da produção (R$) por lavoura · ${scopeOf("lavouras")}`}
          help={HELP.byCrop}
          state={crops.state}
          retry={crops.retry}
          isEmpty={NO_ROWS}
          onClear={clear}
          minHeight={280}
          children={(d) => (
            <Chart
              label="Valor da produção por lavoura"
              height={Math.max(160, d.rows.length * 26)}
              option={horizontalBars(d.rows, selectedValue(search, "lavouras"), tokens)}
              onSelect={blocked.lavoura ? undefined : select("lavouras", "lavoura")}
              bands={{ axis: "y", keys: d.rows.map((r) => r.key) }}
              items={SELECT_ITEMS(d.rows)}
            />
          )}
        />
      </div>

      <DetailTable panel={detail} search={search} navigate={navigate} onClear={clear} tokens={tokens} scope={scope} place={placeOf(null)} hasMonth={hasMonth} />
    </main>
  );
}
