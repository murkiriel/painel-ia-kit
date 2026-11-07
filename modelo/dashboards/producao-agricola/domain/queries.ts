// Consultas pré-aprovadas. A tela e o agente usam as mesmas, para o número ser o mesmo.
// Tudo parametrizado. A permissão ($5) não é opcional: lista vazia não traz linhas.
// O mês ($6) é opcional: desligado, a tabela nem precisa da coluna, e $6 é sempre nulo.
import { inPortuguese } from "../../../server/db/decimal.ts";
import type { Db } from "../../../server/db/types.ts";
import { month as monthText } from "../../../shared/format.ts";
import { areaFits, DETAIL_DIMENSIONS, NO_FILTERS, PT_BR, SQLITE_PERIOD, type DetailDimension, type Filters } from "./filters.ts";

const params = (f: Filters, scope: string[]) => [f.year, f.region, f.state, f.crop, scope, f.month ?? null];

const monthLabel = (year: number, month: number) => monthText(`${year}-${String(month).padStart(2, "0")}`);

const PAGE_SIZE = 20;
const STALE_DAYS = 45;
const TOP_CROPS = 10;
const LIST_CHANGE_SHARE = 0.01;
const ALL_STATE_COUNT = 27;

// Ordem de dicionário do português, sem depender da configuração do banco: Pará antes de Paraíba.
const inOrder = (list: { key: string; label: string }[]) => list.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

// O que muda entre os motores, lado a lado. "column" diz a escala do resultado no SQLite.
// O Postgres faz a conta em NUMERIC. O SQLite guarda inteiros, e estas funções (server/db/sqlite.ts) devolvem o mesmo texto.
const POSTGRES = {
  sum: (column: string) => `SUM(${column})`,
  text: (value: string, _column: string) => `${value}::text`,
  order: (order: string) => order,
  share: (part: string, whole: string, _column: string) => `(${part} / NULLIF(${whole}, 0))::text`,
  variation: (current: string, previous: string, _column: string) => `(${current} / NULLIF(${previous}, 0) - 1)::text`,
  difference: (a: string, b: string, _column: string) => `(${a} - ${b})::text`,
  differs: (a: string, b: string) => `${a} <> ${b}`,
  period: "to_char(make_date(year, month, 1), 'YYYY-MM')",
  monthList: "array_agg(DISTINCT month ORDER BY month)",
  stale: "(now() - finished_at) > make_interval(days => $1)",
};

const SQLITE: typeof POSTGRES = {
  sum: (column) => `dec_sum(${column})`,
  text: (value, column) => `dec_text(${value}, '${column}')`,
  // A ordem vem de readDetail, em SQL do Postgres, de uma lista fechada.
  order: (order) => order.replace(/SUM\((\w+)\)/g, "dec_sort(dec_sum($1))").replace("make_date(year, month, 1)", "year * 100 + month"),
  share: (part, whole, column) => `dec_div(${part}, ${whole}, '${column}')`,
  variation: (current, previous, column) => `dec_variation(${current}, ${previous}, '${column}')`,
  difference: (a, b, column) => `dec_text(dec_sub(${a}, ${b}), '${column}')`,
  differs: (a, b) => `dec_sub(${a}, ${b}) <> '0'`,
  period: SQLITE_PERIOD,
  monthList: "json_group_array(DISTINCT month ORDER BY month)",
  stale: "finished_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || $1 || ' days')",
};

export type Row = { key: string | null; label: string; value: string | null; share?: string | null };

export type Meta = { updatedAt: string | null; warnings: string[] };

export type Summary = {
  value: string | null;
  // Só com uma lavoura filtrada: somar toneladas de lavouras diferentes engana, e a fonte não publica esse total.
  quantity: string | null;
  quantityUnit: string | null;
  area: string | null;
  crops: number;
  firstYear: number | null;
  lastYear: number | null;
  previousValue: string | null;
  valueVariation: string | null;
  // Lavouras que entram ou saem de um ano para o outro: a variação não compara a mesma lista.
  addedCrops: number;
  addedValue: string | null;
  removedCrops: number;
  // A mudança pesa ao menos 1% do valor. Abaixo disso, o aviso seria só ruído.
  listChanged: boolean;
  // Só com o mês ligado.
  firstPeriod?: string | null;
  lastPeriod?: string | null;
  monthsCurrent?: number;
  // Pares de ano e mês com dado: monthsCurrent conta o mês sem o ano, para comparar com o ano anterior.
  monthsCovered?: number;
  monthsPrevious?: number;
};

export function createQueries(pool: Db, { hasMonth = false } = {}) {
  const d = pool.engine === "sqlite" ? SQLITE : POSTGRES;
  const VALUE = d.sum("value_brl");
  const sumText = (column: string) => d.text(d.sum(column), column);

  /**
   * O Postgres ordena os nomes com ICU. O SQLite não tem essa ordem, e o node:sqlite não deixa criar uma:
   * o JavaScript põe os nomes em ordem de dicionário, e a consulta recebe a lista como o parâmetro $9.
   */
  async function nameOrder(order: string): Promise<{ order: string; values: unknown[] }> {
    if (pool.engine !== "sqlite") return { order, values: [] };
    const column = new RegExp(`(\\w+) ${PT_BR}`).exec(order)?.[1];
    // Ano e mês têm o mesmo formato em todas as linhas: a ordem dos bytes já é a de dicionário.
    if (!column) return { order: order.replace(PT_BR, ""), values: [] };
    const { rows } = await pool.query(`SELECT DISTINCT ${column} AS name FROM production`);
    return { order: order.replace(`${column} ${PT_BR}`, `pt_rank(${column}, $9)`), values: [JSON.stringify(inPortuguese(rows.map((r) => r.name)))] };
  }

  const WHERE = `
  ($1::int IS NULL OR year = $1::int)
  AND ($2::text IS NULL OR region = $2::text)
  AND ($3::text IS NULL OR state_code = $3::text)
  AND ($4::text IS NULL OR crop_code = $4::text)
  AND state_code = ANY($5::text[])
  AND ${hasMonth ? "($6::int IS NULL OR month = $6::int)" : "$6::int IS NULL"}`;
  // Com o mês ligado, o ano anterior só entra com os meses que o período atual tem.
  const SAME_MONTHS = hasMonth ? `AND month IN (SELECT month FROM production WHERE ${WHERE})` : "";
  // A lista muda se a lavoura falta em um mês de um dos lados, e não só no ano inteiro.
  const CROP_KEY = hasMonth ? "crop_code, month" : "crop_code";

  /** O período que o recorte cobre e quantos meses há de cada lado da comparação com o ano anterior. */
  async function monthsOf(f: Filters, scope: string[]) {
    const { rows } = await pool.query(`
      WITH current AS (SELECT DISTINCT year, month FROM production WHERE ${WHERE})
      SELECT (SELECT COUNT(DISTINCT month) FROM current)::int AS months,
             (SELECT COUNT(year) FROM current)::int AS covered,
             (SELECT ${d.period} FROM current ORDER BY year, month LIMIT 1) AS first_period,
             (SELECT ${d.period} FROM current ORDER BY year DESC, month DESC LIMIT 1) AS last_period,
             (SELECT COUNT(DISTINCT p.month) FROM production p JOIN current c ON p.month = c.month AND p.year = c.year - 1
              WHERE ($2::text IS NULL OR p.region = $2::text)
                AND ($3::text IS NULL OR p.state_code = $3::text)
                AND ($4::text IS NULL OR p.crop_code = $4::text)
                AND p.state_code = ANY($5::text[]))::int AS previous_months`, params(f, scope));
    const r = rows[0];
    return {
      firstPeriod: r.first_period as string | null,
      lastPeriod: r.last_period as string | null,
      monthsCurrent: r.months as number,
      monthsCovered: r.covered as number,
      monthsPrevious: r.previous_months as number,
    };
  }

  /** Anos sem os 12 meses no recorte, com os meses que têm dado. */
  async function partialYears(f: Filters, scope: string[]) {
    const { rows } = await pool.query(`
      SELECT year, COUNT(DISTINCT month)::int AS months, MIN(month) AS first, MAX(month) AS last
      FROM production WHERE ${WHERE}
      GROUP BY year HAVING COUNT(DISTINCT month) < 12`, params(f, scope));
    return Object.fromEntries(rows.map((r) => [String(r.year), { months: r.months as number, first: r.first as number, last: r.last as number }]));
  }

  /** Só os meses do recorte. Ao trocar de ano, a tela usa monthsByYear para saber se o mês escolhido continua. */
  async function monthOptions(f: Filters, scope: string[]) {
    const listed = f.year === null ? [] : (await pool.query(
      `SELECT DISTINCT month FROM production WHERE ${WHERE} ORDER BY month`,
      params({ ...f, month: null }, scope),
    )).rows;
    const all = await pool.query(`SELECT year, ${d.monthList} AS months FROM production WHERE state_code = ANY($1::text[]) GROUP BY year`, [scope]);
    return {
      mes: listed.map((r) => ({ key: String(r.month), label: monthLabel(f.year!, r.month) })),
      monthsByYear: Object.fromEntries(all.rows.map((r) => [String(r.year), (typeof r.months === "string" ? JSON.parse(r.months) : r.months) as number[]])),
    };
  }

  return {
    async meta(): Promise<Meta> {
      const { rows } = await pool.query(`
        SELECT status, finished_at, error FROM load_log
        WHERE status <> 'running' ORDER BY finished_at DESC LIMIT 1`);
      const ok = await pool.query(`
        SELECT finished_at, ${d.stale} AS stale
        FROM load_log WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1`, [STALE_DAYS]);
      const last = ok.rows[0];
      const warnings: string[] = [];
      if (!last) warnings.push("Ainda não há carga concluída.");
      else if (last.stale) warnings.push(`Os dados não são atualizados há mais de ${STALE_DAYS} dias.`);
      if (rows[0]?.status === "error") warnings.push("A última carga falhou. Os dados exibidos são da última carga concluída.");
      return { updatedAt: last ? new Date(last.finished_at).toISOString() : null, warnings };
    },

    async summary(f: Filters, scope: string[]): Promise<Summary> {
      const { rows } = await pool.query(`
        WITH current AS (
          SELECT ${VALUE} AS value, ${d.sum("quantity_t")} AS quantity, MIN(quantity_unit) AS quantity_unit, ${d.sum("area_ha")} AS area,
                 COUNT(DISTINCT crop_code)::int AS crops, MIN(year) AS first_year, MAX(year) AS last_year
          FROM production WHERE ${WHERE}
        ),
        previous AS (
          SELECT ${VALUE} AS value FROM production
          WHERE $1::int IS NOT NULL AND year = $1::int - 1
            AND ($2::text IS NULL OR region = $2::text)
            AND ($3::text IS NULL OR state_code = $3::text)
            AND ($4::text IS NULL OR crop_code = $4::text)
            AND state_code = ANY($5::text[]) ${SAME_MONTHS}
        ),
        current_crops AS (
          SELECT ${CROP_KEY}, ${VALUE} AS value FROM production
          WHERE $1::int IS NOT NULL AND ${WHERE} GROUP BY ${CROP_KEY}
        ),
        previous_crops AS (
          SELECT ${CROP_KEY}, ${VALUE} AS value FROM production
          WHERE $1::int IS NOT NULL AND year = $1::int - 1
            AND ($2::text IS NULL OR region = $2::text)
            AND ($3::text IS NULL OR state_code = $3::text)
            AND ($4::text IS NULL OR crop_code = $4::text)
            AND state_code = ANY($5::text[]) ${SAME_MONTHS}
          GROUP BY ${CROP_KEY}
        ),
        changes AS (
          SELECT COUNT(DISTINCT c.crop_code) FILTER (WHERE p.crop_code IS NULL)::int AS added,
                 ${d.sum("c.value")} FILTER (WHERE p.crop_code IS NULL) AS added_value,
                 COUNT(DISTINCT p.crop_code) FILTER (WHERE c.crop_code IS NULL)::int AS removed,
                 ${d.sum("p.value")} FILTER (WHERE c.crop_code IS NULL) AS removed_value
          FROM current_crops c FULL JOIN previous_crops p USING (${CROP_KEY})
        )
        SELECT ch.added, ${d.text("ch.added_value", "value_brl")} AS added_value, ch.removed, ${d.text("ch.removed_value", "value_brl")} AS removed_value,
               ${d.text("c.value", "value_brl")} AS value, ${d.text("c.quantity", "quantity_t")} AS quantity, c.quantity_unit, ${d.text("c.area", "area_ha")} AS area, c.crops, c.first_year, c.last_year,
               ${d.text("p.value", "value_brl")} AS previous_value,
               ${d.variation("c.value", "p.value", "value_brl")} AS value_variation
        FROM current c, previous p, changes ch`, params(f, scope));
      const r = rows[0];
      const months = hasMonth ? await monthsOf(f, scope) : null;
      // Menos meses no ano anterior não é o mesmo período: a variação não existe.
      const sameMonths = months === null || months.monthsPrevious === months.monthsCurrent;
      const comparable = r.previous_value !== null && sameMonths;
      const moved = Number(r.added_value ?? 0) + Number(r.removed_value ?? 0);
      const base = Math.max(Number(r.value ?? 0), Number(r.previous_value ?? 0));
      return {
        addedCrops: comparable ? r.added : 0,
        addedValue: comparable ? r.added_value : null,
        removedCrops: comparable ? r.removed : 0,
        listChanged: comparable && base > 0 && moved / base >= LIST_CHANGE_SHARE,
        value: r.value, quantity: f.crop === null ? null : r.quantity, quantityUnit: f.crop === null ? null : r.quantity_unit,
        // Área é a mesma terra a cada período: somar períodos não faz sentido.
        area: areaFits(f, null, hasMonth) ? r.area : null, crops: r.crops,
        firstYear: r.first_year, lastYear: r.last_year,
        previousValue: r.previous_value, valueVariation: sameMonths ? r.value_variation : null,
        ...months,
      };
    },

    async byYear(f: Filters, scope: string[]) {
      const { rows } = await pool.query(`
        SELECT year, region, ${sumText("value_brl")} AS value
        FROM production WHERE ${WHERE}
        GROUP BY year, region ORDER BY year, region`, params(f, scope));
      const totals = await pool.query(`
        SELECT year, ${sumText("value_brl")} AS value
        FROM production WHERE ${WHERE}
        GROUP BY year ORDER BY year`, params(f, scope));
      // Todos os anos da base: ano sem dado aparece vazio, para a lacuna ficar à vista.
      const known = await pool.query(
        "SELECT DISTINCT year FROM production WHERE ($1::int IS NULL OR year = $1::int) AND state_code = ANY($2::text[]) ORDER BY year",
        [f.year, scope],
      );
      const years: number[] = known.rows.map((r) => r.year);
      const regions = [...new Set(rows.map((r) => r.region as string))];
      return {
        // Ano incompleto aparece com os meses no eixo, para não parecer queda.
        ...(hasMonth ? { partial: await partialYears(f, scope) } : {}),
        categories: years.map(String),
        series: regions.map((region) => ({
          key: region,
          label: region,
          values: years.map((year) => rows.find((r) => r.year === year && r.region === region)?.value ?? null),
        })),
        totals: years.map((year) => (totals.rows.find((r) => r.year === year)?.value ?? null) as string | null),
      };
    },

    async byRegion(f: Filters, scope: string[]): Promise<{ rows: Row[]; total: string | null }> {
      const { rows } = await pool.query(`
        SELECT region AS key, region AS label, ${sumText("value_brl")} AS value,
               ${d.share(VALUE, `${d.sum(VALUE)} OVER ()`, "value_brl")} AS share,
               ${d.text(`(${d.sum(VALUE)} OVER ())`, "value_brl")} AS total
        FROM production WHERE ${WHERE}
        GROUP BY region ORDER BY ${d.order("SUM(value_brl) DESC NULLS LAST")}, region`, params(f, scope));
      return {
        rows: rows.map(({ key, label, value, share }) => ({ key, label, value, share })),
        total: rows[0]?.total ?? null,
      };
    },

    async byState(f: Filters, scope: string[]): Promise<{ rows: Row[] }> {
      const { rows } = await pool.query(`
        SELECT state_code AS key, state_name AS label, ${sumText("value_brl")} AS value
        FROM production WHERE ${WHERE}
        GROUP BY state_code, state_name ORDER BY ${d.order("SUM(value_brl) DESC NULLS LAST")}, state_code`, params(f, scope));
      return { rows };
    },

    /** As maiores lavouras e "Outros", sem chave: clicar nele não filtra. */
    async byCrop(f: Filters, scope: string[]): Promise<{ rows: Row[] }> {
      const { rows } = await pool.query(`
        WITH crops AS (
          SELECT crop_code, crop_name, ${VALUE} AS value,
                 ROW_NUMBER() OVER (ORDER BY ${d.order("SUM(value_brl) DESC NULLS LAST")}, crop_code) AS position
          FROM production WHERE ${WHERE}
          GROUP BY crop_code, crop_name
        )
        SELECT CASE WHEN position <= $7 THEN crop_code END AS key,
               CASE WHEN position <= $7 THEN crop_name ELSE 'Outros' END AS label,
               ${d.text(d.sum("value"), "value_brl")} AS value
        FROM crops
        GROUP BY 1, 2
        ORDER BY MIN(position)`, [...params(f, scope), TOP_CROPS]);
      return { rows };
    },

    /** Meses do ano escolhido. Mês sem dado no recorte fica com um traço, e o mês escolhido só é destacado, não filtra. */
    async byMonth(f: Filters, scope: string[]) {
      const year = f.year;
      if (year === null) return { year: null, rows: [] as Row[] };
      const { rows } = await pool.query(`
        SELECT month, ${sumText("value_brl")} AS value
        FROM production WHERE ${WHERE}
        GROUP BY month`, params({ ...f, month: null }, scope));
      const known = await pool.query("SELECT DISTINCT month FROM production WHERE year = $1 AND state_code = ANY($2::text[]) ORDER BY month", [year, scope]);
      return {
        year,
        rows: known.rows.map((r): Row => ({
          key: String(r.month),
          label: monthLabel(year, r.month),
          value: rows.find((row) => row.month === r.month)?.value ?? null,
        })),
      };
    },

    async latestYear(scope: string[]): Promise<number | null> {
      const { rows } = await pool.query("SELECT MAX(year) AS year FROM production WHERE state_code = ANY($1::text[])", [scope]);
      return rows[0].year;
    },

    /**
     * Ano, mês ou lavoura que não existem são erro, não "sem dados". Só vale o que quem pergunta pode ver: o que existe
     * só fora da permissão recebe a mesma resposta do que não existe, para a recusa não revelar nada. Sem acesso a dado nenhum,
     * nada é recusado: as rotas devolvem vazio, e a tela explica.
     */
    async exists(f: Filters, scope: string[]): Promise<{ year: boolean; crop: boolean; month: boolean }> {
      const has = async (condition: string, values: unknown[]) => (await pool.query(`SELECT 1 FROM production WHERE ${condition} AND state_code = ANY($${values.length + 1}::text[]) LIMIT 1`, [...values, scope])).rows.length > 0;
      const year = f.year === null || await has("year = $1", [f.year]);
      const crop = f.crop === null || await has("crop_code = $1", [f.crop]);
      const month = !hasMonth || (f.month ?? null) === null || await has("year = $1 AND month = $2", [f.year, f.month]);
      if (year && crop && month) return { year, crop, month };
      const seesData = await has("TRUE", []);
      return seesData ? { year, crop, month } : { year: true, crop: true, month: true };
    },

    // "order" vem de readDetail, de uma lista fechada, nunca direto do navegador.
    async detail(f: Filters, scope: string[], by: DetailDimension | null, page: number, order = by === null ? "value_brl DESC NULLS LAST" : "SUM(value_brl) DESC NULLS LAST") {
      const offset = (page - 1) * PAGE_SIZE;
      const totals = await pool.query(`
        SELECT ${sumText("value_brl")} AS value, ${sumText("quantity_t")} AS quantity, MIN(quantity_unit) AS quantity_unit,
               ${sumText("area_ha")} AS area, COUNT(*)::int AS lines, MIN(year) AS first_year, MAX(year) AS last_year
        FROM production WHERE ${WHERE}`, params(f, scope));
      const row = totals.rows[0];
      // Sem uma lavoura, o total em toneladas não existe: a fonte não publica e o número engana.
      const { quantity_unit: unit, first_year: firstYear, last_year: lastYear, ...sums } = row;
      const months = hasMonth ? await monthsOf(f, scope) : null;
      const total = {
        ...sums,
        quantity: f.crop === null ? null : row.quantity,
        quantityUnit: f.crop === null ? null : unit,
        area: areaFits(f, null, hasMonth) ? row.area : null,
        // O que a tabela soma, para o título e a linha de total dizerem o intervalo real.
        firstYear,
        lastYear,
        ...(months ? { firstPeriod: months.firstPeriod, lastPeriod: months.lastPeriod, monthsCurrent: months.monthsCurrent, monthsCovered: months.monthsCovered } : {}),
      };

      if (by === null) {
        const sorted = await nameOrder(d.order(order));
        const { rows } = await pool.query(`
          SELECT year, ${hasMonth ? "month," : ""} state_name, region, crop_name,
                 ${d.text("value_brl", "value_brl")} AS value, ${d.text("quantity_t", "quantity_t")} AS quantity, quantity_unit, ${d.text("area_ha", "area_ha")} AS area
          FROM production WHERE ${WHERE}
          ORDER BY ${sorted.order}, year DESC, ${hasMonth ? "month DESC," : ""} state_code, crop_code
          LIMIT $7 OFFSET $8`, [...params(f, scope), PAGE_SIZE, offset, ...sorted.values]);
        return { rows, count: total.lines as number, pageSize: PAGE_SIZE, totals: total };
      }

      // A coluna vem da lista fechada de DETAIL_DIMENSIONS, nunca do navegador.
      const dimension = DETAIL_DIMENSIONS[by];
      const column = (pool.engine === "sqlite" && dimension.sqlite) || dimension.column;
      const label = (pool.engine === "sqlite" && dimension.sqlite) || dimension.label;
      const sorted = await nameOrder(d.order(order).replace("$LABEL", `${label} ${PT_BR}`));
      const { rows } = await pool.query(`
        SELECT ${column} AS key, ${label} AS label,
               ${sumText("value_brl")} AS value, ${sumText("quantity_t")} AS quantity, MIN(quantity_unit) AS quantity_unit,
               ${sumText("area_ha")} AS area
        FROM production WHERE ${WHERE}
        GROUP BY 1, 2
        ORDER BY ${sorted.order}, 1
        LIMIT $7 OFFSET $8`, [...params(f, scope), PAGE_SIZE, offset, ...sorted.values]);
      const groups = await pool.query(`
        SELECT COUNT(DISTINCT ${column})::int AS count FROM production WHERE ${WHERE}`, params(f, scope));
      const sumsOneCrop = f.crop !== null || by === "lavoura";
      const sumsOnePeriod = areaFits(f, by, hasMonth);
      return {
        rows: rows.map((r) => ({ ...r, quantity: sumsOneCrop ? r.quantity : null, area: sumsOnePeriod ? r.area : null })),
        count: groups.rows[0].count as number,
        pageSize: PAGE_SIZE,
        totals: total,
      };
    },

    /**
     * Listas dos seletores, limitadas ao que existe no recorte. Cada lista ignora o próprio filtro,
     * para dar para trocar. "labels" traz os nomes de tudo que a pessoa pode ver: o que não está nele fica fora da permissão.
     */
    async filterOptions(scope: string[], f: Filters = NO_FILTERS) {
      const where = (year: number | null, region: string | null, state: string | null, crop: string | null, month = f.month ?? null) => ({
        text: WHERE,
        values: [year, region, state, crop, scope, month],
      });
      const list = (sql: string, w: ReturnType<typeof where>) => pool.query(sql.replace("$WHERE", w.text), w.values);
      const years = await list("SELECT DISTINCT year FROM production WHERE $WHERE ORDER BY year DESC", where(null, f.region, f.state, f.crop, null));
      const regions = await list("SELECT DISTINCT region FROM production WHERE $WHERE ORDER BY region", where(f.year, null, null, f.crop));
      const states = await list("SELECT DISTINCT state_code, state_name FROM production WHERE $WHERE ORDER BY state_name", where(f.year, f.region, null, f.crop));
      const crops = await list("SELECT DISTINCT crop_code, crop_name FROM production WHERE $WHERE ORDER BY crop_name", where(f.year, f.region, f.state, null));
      const allStates = await pool.query("SELECT DISTINCT state_code, state_name FROM production WHERE state_code = ANY($1::text[]) ORDER BY state_code, state_name", [scope]);
      const allCrops = await pool.query("SELECT DISTINCT crop_code, crop_name FROM production WHERE state_code = ANY($1::text[]) ORDER BY crop_code, crop_name", [scope]);
      const allRegions = await pool.query("SELECT DISTINCT region FROM production WHERE state_code = ANY($1::text[]) ORDER BY region", [scope]);
      const allYears = await pool.query("SELECT MIN(year) AS first, MAX(year) AS last FROM production WHERE state_code = ANY($1::text[])", [scope]);
      const place = allStates.rows.length === ALL_STATE_COUNT
        ? "Brasil"
        : allStates.rows.length === 1 ? allStates.rows[0].state_name as string : `${allStates.rows.length} UFs permitidas`;
      return {
        ano: years.rows.map((r) => ({ key: String(r.year), label: String(r.year) })),
        regiao: inOrder(regions.rows.map((r) => ({ key: r.region, label: r.region }))),
        uf: inOrder(states.rows.map((r) => ({ key: r.state_code, label: r.state_name }))),
        lavoura: inOrder(crops.rows.map((r) => ({ key: r.crop_code, label: r.crop_name }))),
        ...(hasMonth ? await monthOptions(f, scope) : {}),
        labels: {
          uf: Object.fromEntries(allStates.rows.map((r) => [r.state_code, r.state_name])) as Record<string, string>,
          lavoura: Object.fromEntries(allCrops.rows.map((r) => [r.crop_code, r.crop_name])) as Record<string, string>,
          regiao: Object.fromEntries(allRegions.rows.map((r) => [r.region, r.region])) as Record<string, string>,
        },
        scopeLabel: place,
        firstYear: allYears.rows[0].first as number | null,
        latestYear: allYears.rows[0].last as number | null,
        hasAccess: allStates.rows.length > 0,
      };
    },

    /** Conferência à vista: soma do dashboard contra o total do Brasil publicado pela fonte, ano a ano. */
    async sourceCheck() {
      const { rows } = await pool.query(`
        WITH dashboard AS (
          SELECT year, ${VALUE} AS value, ${d.sum("area_ha")} AS area, COUNT(DISTINCT state_code)::int AS states
          FROM production GROUP BY year
        ),
        by_crop AS (
          SELECT year, crop_code, ${d.sum("quantity_t")} AS quantity FROM production GROUP BY year, crop_code
        ),
        quantity_check AS (
          -- Café total fica de fora: o dashboard soma arábica e canephora.
          -- FULL JOIN: lavoura que só existe de um dos lados também é diferença.
          SELECT COALESCE(n.year, c.year) AS year,
                 COUNT(*) FILTER (WHERE n.crop_code IS NULL OR ${d.differs("COALESCE(n.quantity_t, 0)", "COALESCE(c.quantity, 0)")})::int AS different,
                 COUNT(*) FILTER (WHERE COALESCE(n.value_brl, 0) <> 0 OR COALESCE(n.quantity_t, 0) <> 0 OR COALESCE(n.area_ha, 0) <> 0)::int AS source_crops,
                 COUNT(c.crop_code)::int AS dashboard_crops
          FROM (SELECT * FROM source_national WHERE crop_code NOT IN ('0', '40139')) n
          FULL JOIN by_crop c ON c.year = n.year AND c.crop_code = n.crop_code
          GROUP BY 1
        )
        SELECT s.year, ${d.text("s.value_brl", "value_brl")} AS source_value, ${d.text("d.value", "value_brl")} AS dashboard_value,
               ${d.difference("d.value", "s.value_brl", "value_brl")} AS value_difference, ${d.text("s.area_ha", "area_ha")} AS source_area,
               ${d.text("d.area", "area_ha")} AS dashboard_area, ${d.difference("d.area", "s.area_ha", "area_ha")} AS area_difference,
               d.states, q.different, q.source_crops, q.dashboard_crops
        FROM source_national s
        LEFT JOIN dashboard d USING (year)
        LEFT JOIN quantity_check q USING (year)
        WHERE s.crop_code = '0'
        ORDER BY s.year DESC`);
      return rows.flatMap((r) => [
        {
          indicator: "Valor da produção, Brasil (R$)", kind: "money", year: r.year,
          source: r.source_value, dashboard: r.dashboard_value, difference: r.value_difference,
          // A fonte publica em mil reais: cada uma das 27 UFs pode diferir em até R$ 1.000 por arredondamento.
          tolerance: "27000",
        },
        {
          indicator: "Área colhida, Brasil (ha)", kind: "area", year: r.year,
          source: r.source_area, dashboard: r.dashboard_area, difference: r.area_difference, tolerance: "0",
        },
        {
          indicator: "UFs com dados", kind: "count", year: r.year,
          source: "27", dashboard: String(r.states ?? 0), difference: String((r.states ?? 0) - 27), tolerance: "0",
        },
        {
          indicator: "Lavouras com quantidade diferente da fonte", kind: "count", year: r.year,
          // Sem comparação, não há OK: o nulo vira DIVERGE.
          source: "0", dashboard: r.different === null ? null : String(r.different), difference: r.different === null ? null : String(r.different), tolerance: "0",
        },
        {
          indicator: "Lavouras com produção", kind: "count", year: r.year,
          source: r.source_crops === null ? null : String(r.source_crops),
          dashboard: r.dashboard_crops === null ? null : String(r.dashboard_crops),
          difference: r.source_crops === null ? null : String(r.dashboard_crops - r.source_crops),
          tolerance: "0",
        },
      ]).map((r) => ({
        ...r,
        status: r.difference !== null && Math.abs(Number(r.difference)) <= Number(r.tolerance) ? "OK" : "DIVERGE",
      }));
    },
  };
}

export type Queries = ReturnType<typeof createQueries>;
