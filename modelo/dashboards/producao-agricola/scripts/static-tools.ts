// O que o gerador e a conferência do site estático têm em comum: a lista do que é publicado, a varredura e os cliques possíveis.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { clearFilters, detailQuery, panelQuery, setFilter, toggleSelection } from "../../../shared/filters.ts";
import { ALL_YEARS, DATA_DIR, DETAIL_VIEWS, fileOf, isPublished, MANIFEST_FILE, otherOrders, SITE_ROUTES, type DetailView, type SiteManifest, type SiteRoute } from "../shared/staticSite.ts";
import { blockedControls, chooseYearQuery, correctedLink, detailControls, screenQueries } from "../web/screenRules.ts";

/** A resposta de uma rota, como texto. No gerador vem das consultas; na conferência, da API de verdade. */
export type Call = (route: SiteRoute, query: string) => Promise<string>;

const query = (values: Record<string, string | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) params.set(key, value);
  params.sort();
  return params.toString();
};

const keysOf = (rows: { key: string | null }[]) => rows.flatMap((row) => (row.key === null ? [] : [row.key]));

/** O que existe na base, lido pelas próprias rotas. */
export async function readManifest(call: Call, generatedAt: string): Promise<SiteManifest> {
  const all = JSON.parse(await call("filter-options", query({ ano: ALL_YEARS })));
  const states: Record<string, string> = {};
  const regionCrops: Record<string, string[]> = {};
  for (const { key: region } of all.regiao as { key: string }[]) {
    const byState = JSON.parse(await call("by-state", query({ ano: ALL_YEARS, regiao: region })));
    for (const key of keysOf(byState.rows)) states[key] = region;
    regionCrops[region] = keysOf(JSON.parse(await call("filter-options", query({ ano: ALL_YEARS, regiao: region }))).lavoura);
  }
  return {
    publicData: true,
    generatedAt,
    updatedAt: all.updatedAt,
    years: keysOf(all.ano),
    states,
    crops: Object.keys(all.labels.lavoura),
    regionCrops,
    files: 0,
    bytes: 0,
  };
}

/** Lugar e lavoura de cada recorte publicado. UF não se combina com lavoura: veja isPublished. */
export function publishedCuts(manifest: SiteManifest): { regiao?: string; uf?: string; lavoura?: string }[] {
  const regions = Object.keys(manifest.regionCrops);
  return [
    {},
    ...regions.map((regiao) => ({ regiao })),
    ...Object.keys(manifest.states).map((uf) => ({ uf })),
    ...manifest.crops.map((lavoura) => ({ lavoura })),
    ...regions.flatMap((regiao) => manifest.regionCrops[regiao].map((lavoura) => ({ regiao, lavoura }))),
  ];
}

async function walkDetail(base: string, view: DetailView, call: Call, emit: (route: SiteRoute, query: string, text: string) => Promise<void>, orders: boolean) {
  const params = new URLSearchParams(base);
  if (view !== null) params.set("por", view);
  params.sort();
  const first = params.toString();
  const text = await call("detail", first);
  await emit("detail", first, text);
  const { count, pageSize } = JSON.parse(text) as { count: number; pageSize: number };
  for (let page = 2; page <= Math.ceil(count / pageSize); page++) {
    params.set("pagina", String(page));
    params.sort();
    const next = params.toString();
    await emit("detail", next, await call("detail", next));
  }
  // Com uma linha ou menos, a ordem não muda nada.
  if (orders && count > 1) {
    for (const other of otherOrders(base, view)) await emit("detail", other, await call("detail", other));
  }
}

/** Percorre tudo que é publicado, com algumas tarefas ao mesmo tempo. Cada resposta passa por emit com o texto canônico da consulta. */
export async function walkSite(manifest: SiteManifest, call: Call, emit: (route: SiteRoute, query: string, text: string) => Promise<void>, workers = 8) {
  const years = [null, ...manifest.years, ALL_YEARS];
  const tasks: (() => Promise<void>)[] = [];
  for (const cut of publishedCuts(manifest)) {
    tasks.push(async () => {
      const yearly = query({ ...cut, ano: ALL_YEARS });
      await emit("by-year", yearly, await call("by-year", yearly));
    });
    for (const ano of years) {
      tasks.push(async () => {
        const base = query({ ...cut, ano });
        for (const route of ["filter-options", "summary", "by-region", "by-state", "by-crop"] as const) await emit(route, base, await call(route, base));
        for (const view of DETAIL_VIEWS) await walkDetail(base, view, call, emit, cut.lavoura === undefined || cut.regiao === undefined);
        // Uma UF com a região dela só muda a lista de UFs do seletor.
        if (cut.uf !== undefined) {
          const paired = query({ ...cut, ano, regiao: manifest.states[cut.uf] });
          await emit("filter-options", paired, await call("filter-options", paired));
        }
      });
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < tasks.length) await tasks[next++]();
  }));
}

/** O que o gerador guarda na pasta de trabalho enquanto escreve, para reconhecer a sobra de uma geração que parou no meio. */
export const WORK_MARK = ".gerando-site-estatico";
const SITE_ENTRIES = new Set(["index.html", "assets", DATA_DIR]);

const samePath = (text: string) => (process.platform === "win32" ? text.toLowerCase() : text);
const holds = (parent: string, child: string) => {
  const relative = path.relative(samePath(parent), samePath(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * O gerador apaga a pasta de destino antes de trocá-la pela nova. Só aceita pasta que não existe, vazia ou que ele mesmo gerou:
 * só com os arquivos do site e o índice dele. Recusa a raiz, a pasta do projeto, qualquer antepassada dela, atalho e todo o resto, sem tocar em nada.
 * Com "workMark", a pasta é a de trabalho: vale a marca, que só existe enquanto ele escreve.
 */
/** Nomes e tamanhos de tudo na pasta, menos o próprio manifesto, que guarda este valor. */
export function siteFingerprint(folder: string): string {
  const lines: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else lines.push(`${path.relative(folder, full).replaceAll("\\", "/")}:${statSync(full).size}`);
    }
  };
  walk(folder);
  return createHash("sha256").update(lines.filter((line) => !line.startsWith(`${MANIFEST_FILE}:`)).sort().join("\n")).digest("hex");
}

export function checkOutputFolder(folder: string, project: string, { workMark = false } = {}) {
  const refuse = (reason: string): never => {
    throw new Error(`Recusei a pasta ${folder}: ${reason} Nada foi apagado.`);
  };
  const target = path.resolve(folder);
  const home = path.resolve(project);
  if (target === path.parse(target).root) refuse("é a raiz do disco.");
  if (!existsSync(target)) return;
  if (lstatSync(target).isSymbolicLink()) refuse("é um atalho.");
  const real = realpathSync(target);
  if (holds(real, realpathSync(home))) refuse("é a pasta do projeto ou contém o projeto.");
  if (!statSync(real).isDirectory()) refuse("não é uma pasta.");
  const entries = readdirSync(real);
  if (entries.length === 0) return;
  if (workMark) {
    if (!entries.includes(WORK_MARK)) refuse("tem arquivos que o gerador não reconhece. Apague ou escolha outra.");
    return;
  }
  let manifest: Partial<SiteManifest> | null = null;
  try {
    manifest = JSON.parse(readFileSync(path.join(real, MANIFEST_FILE), "utf8"));
  } catch {
    // Sem índice legível, a pasta não é deste gerador.
  }
  const ours = manifest?.publicData === true && typeof manifest.generatedAt === "string" && Array.isArray(manifest.years);
  if (!ours || !entries.every((entry) => SITE_ENTRIES.has(entry))) refuse("tem arquivos que não são de um site gerado aqui. Apague ou escolha outra.");
  // Dentro do site, só o tipo de arquivo que o gerador escreve: um arquivo de outra pessoa em uma subpasta sumiria junto.
  const foreign = (folder: string, allowed: RegExp): boolean => readdirSync(folder, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? foreign(path.join(folder, entry.name), allowed) : !entry.isFile() || !allowed.test(entry.name));
  if (statSync(path.join(real, "index.html"), { throwIfNoEntry: false })?.isDirectory()) refuse("tem arquivos que não são de um site gerado aqui. Apague ou escolha outra.");
  if (typeof manifest?.filesHash === "string" && manifest.filesHash !== siteFingerprint(real)) refuse("mudou depois de gerada: tem arquivos que não são do gerador. Apague ou escolha outra.");
  for (const [entry, allowed] of [["assets", /\.(?:js|css|map)$/], [DATA_DIR, /\.json$/]] as const) {
    const folder = path.join(real, entry);
    if (!existsSync(folder)) continue;
    if (!statSync(folder).isDirectory() || foreign(folder, allowed)) refuse("tem arquivos que não são de um site gerado aqui. Apague ou escolha outra.");
  }
}

/** Só dado público: com login, o dado é interno, e o gerador não roda. Falha na carga também não publica. */
export function assertPublishable(env: Record<string, string | undefined>, meta: { updatedAt: string | null; warnings: string[] } | null) {
  if (env.AUTH_MODE === "login") throw new Error("AUTH_MODE=login indica dado interno, que exige servidor com login. O site estático só serve para dado público, e não foi gerado.");
  if (env.MONTH_FILTER) throw new Error("O site estático não cobre o filtro por mês. Desligue MONTH_FILTER para gerar, ou acrescente o mês ao plano do site em shared/staticSite.ts.");
  if (meta === null) return;
  if (!meta.updatedAt) throw new Error("Ainda não há carga concluída: o site não foi gerado.");
  if (meta.warnings.some((warning) => warning.includes("falhou"))) throw new Error("A última carga falhou: o site não foi gerado. Corrija a carga e gere de novo.");
}

/** Acima do limite, o gerador recusa, e o site anterior continua como estava. */
export function assertWithinLimits(total: { files: number; bytes: number }, limits: { files: number; bytes: number }) {
  const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  if (total.bytes > limits.bytes) throw new Error(`O site passou do limite: ${megabytes(total.bytes)} MB, de ${megabytes(limits.bytes)} MB.`);
  if (total.files > limits.files) throw new Error(`O site passou do limite: ${total.files} arquivos, de ${limits.files}.`);
}

// ---- Varredura da pasta gerada ----

const ALLOWED_EXTENSIONS = new Set([".html", ".js", ".css", ".json"]);
const META_KEYS = ["updatedAt", "warnings"];
const ROW_KEYS = ["rows", "key", "label", "value", ...META_KEYS];
const LINE_KEYS = ["year", "state_name", "region", "crop_name", "value", "quantity", "quantity_unit", "area"];
// Só as colunas que a tela usa. Qualquer outro campo, como o valor bruto da fonte ou um código interno, reprova.
const ALLOWED_KEYS: Record<SiteRoute, string[]> = {
  "filter-options": ["ano", "regiao", "uf", "lavoura", "key", "label", "labels", "scopeLabel", "firstYear", "latestYear", "hasAccess", ...META_KEYS],
  summary: ["value", "quantity", "quantityUnit", "area", "crops", "firstYear", "lastYear", "previousValue", "valueVariation", "addedCrops", "addedValue", "removedCrops", "listChanged", ...META_KEYS],
  "by-year": ["categories", "series", "key", "label", "values", "totals", ...META_KEYS],
  "by-region": [...ROW_KEYS, "share", "total"],
  "by-state": ROW_KEYS,
  "by-crop": ROW_KEYS,
  detail: ["rows", "count", "pageSize", "totals", "key", "label", "quantityUnit", "lines", "firstYear", "lastYear", ...LINE_KEYS, ...META_KEYS],
};
const MANIFEST_KEYS = ["publicData", "generatedAt", "updatedAt", "years", "states", "crops", "regionCrops", "files", "bytes", "filesHash"];

const PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "segredo", pattern: /sk-ant-|ANTHROPIC_API_KEY|DATABASE_URL|DEV_ADMIN_PASSWORD|NEW_USER_PASSWORD|BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: "conexão de banco", pattern: /postgres(ql)?:\/\/|mysql:\/\/|mssql:\/\/|:54329|\.sqlite\b|dev_admin|dash_reader|dash_loader|dash_auth/ },
  { name: "endereço da máquina", pattern: /127\.0\.0\.1:\d+/ },
  { name: "caminho local", pattern: /[A-Za-z]:[\\/]+(Users|Program Files|Windows)[\\/]|["'`/](home|Users)\/[a-z][\w.-]+\/|\.data[\\/]/ },
  { name: "SQL", pattern: /\bSELECT\s+[\w*(]|\bINSERT INTO\s|\bDELETE FROM\s|\bDROP TABLE\s|\bCREATE TABLE\s|\bGROUP BY\s|\bORDER BY\s|COLLATE "/ },
  { name: "coluna ou tabela interna", pattern: /value_brl|quantity_t\b|area_ha|state_code|crop_code|raw_production|raw_value|source_national|load_log|app_user|app_session|pass_hash|pass_salt|statement_timeout/ },
  { name: "rota de escrita, login ou agente", pattern: /\/api\/(login|logout|agent|check)\b|X-CSRF-Token/ },
  { name: "chat ou login na tela", pattern: /Perguntar aos dados|current-password|Usuário ou senha|Sua sessão terminou/ },
  { name: "mapa de código", pattern: /sourceMappingURL=/ },
];

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

function keyProblems(value: unknown, allowed: Set<string>, found: Set<string>) {
  if (Array.isArray(value)) value.forEach((item) => keyProblems(item, allowed, found));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!allowed.has(key)) found.add(key);
      // Os nomes dos seletores têm o código como chave, e o valor é só o nome.
      if (key === "labels") {
        for (const list of Object.values(item as Record<string, Record<string, unknown>>)) {
          if (Object.values(list).some((name) => typeof name !== "string")) found.add("labels");
        }
      } else keyProblems(item, allowed, found);
    }
  }
}

export type ScanOptions = {
  /** Valores que nunca podem sair, como os do .env. A varredura não os imprime. */
  secrets?: string[];
  /** Nomes da máquina e do usuário, além dos que ela descobre sozinha. */
  personal?: string[];
};

/** Varre a pasta inteira. Devolve os achados com o arquivo e o tipo, sem repetir o valor. */
export function scanSite(dir: string, options: ScanOptions = {}): string[] {
  const findings: string[] = [];
  const personal = [userInfo().username, hostname(), homedir(), homedir().replaceAll("\\", "/"), path.resolve(dir), path.resolve("."), ...(options.personal ?? [])].filter((text) => text.length >= 4);
  const secrets = (options.secrets ?? []).filter((text) => text.length >= 6);
  const files = listFiles(dir);
  const routeDirs = new Set(SITE_ROUTES.map((route) => `${DATA_DIR}/${route}`));
  if (!files.some((file) => path.relative(dir, file).replaceAll("\\", "/") === MANIFEST_FILE)) findings.push(`${MANIFEST_FILE}: índice ausente`);

  for (const file of files) {
    const relative = path.relative(dir, file).replaceAll("\\", "/");
    if (!ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase())) findings.push(`${relative}: tipo de arquivo não previsto`);
    const text = readFileSync(file, "utf8");
    for (const { name, pattern } of PATTERNS) if (pattern.test(text)) findings.push(`${relative}: ${name}`);
    if (personal.some((value) => text.includes(value))) findings.push(`${relative}: nome ou caminho da máquina`);
    if (secrets.some((value) => text.includes(value))) findings.push(`${relative}: valor de segredo`);
    if (/<(script|link)\b[^>]*\b(src|href)=["'](https?:)?\/\//i.test(text) && relative.endsWith(".html")) findings.push(`${relative}: arquivo de fora do site`);

    if (relative === "index.html" || !relative.startsWith(`${DATA_DIR}/`)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      findings.push(`${relative}: não é JSON`);
      continue;
    }
    if (relative === MANIFEST_FILE) {
      for (const key of Object.keys(parsed as object)) if (!MANIFEST_KEYS.includes(key)) findings.push(`${relative}: campo não previsto (${key})`);
      continue;
    }
    const folder = path.posix.dirname(relative);
    if (!routeDirs.has(folder)) {
      findings.push(`${relative}: pasta não prevista`);
      continue;
    }
    const route = path.posix.basename(folder) as SiteRoute;
    const found = new Set<string>();
    keyProblems(parsed, new Set(ALLOWED_KEYS[route]), found);
    for (const key of found) findings.push(`${relative}: campo não previsto (${key})`);
    // A menor linha publicada é uma por ano, UF e lavoura: linha repetida seria um dado abaixo desse nível.
    if (route === "detail") {
      const seen = new Set<string>();
      for (const row of (parsed as { rows: Record<string, unknown>[] }).rows) {
        if (!("year" in row)) continue;
        const key = `${row.year}|${row.state_name}|${row.crop_name}`;
        if (seen.has(key)) findings.push(`${relative}: linha abaixo do menor agregado publicado`);
        seen.add(key);
      }
    }
  }
  return findings;
}

/** Tamanho e número de arquivos da pasta. */
export function measureSite(dir: string): { files: number; bytes: number } {
  const files = listFiles(dir);
  return { files: files.length, bytes: files.reduce((sum, file) => sum + statSync(file).size, 0) };
}

// ---- Todos os cliques possíveis na tela ----

/** As consultas que a tela faz em um endereço: são as de Dashboard.tsx, pela mesma regra. */
export function requestsOf(search: string): [SiteRoute, string][] {
  const queries = screenQueries(search, false);
  return [
    ["filter-options", queries.options],
    ["summary", queries.summary],
    ["by-year", queries.years],
    ["by-region", queries.regions],
    ["by-state", queries.states],
    ["by-state", queries.map],
    ["by-crop", queries.crops],
    ["detail", queries.detail],
  ];
}

export type ClickResult = { addresses: number; clicks: number; requests: number; tables: number; failures: string[] };

/**
 * Parte da abertura e segue cada controle ligado da tela: seletores, colunas, legenda, mapa, barras, donut, etiquetas e linhas da tabela.
 * Cada endereço alcançado precisa ter o arquivo de cada bloco. Em cada recorte, percorre também a tabela: cada agrupamento, cada coluna
 * que ordena, nos dois sentidos, e cada página. As regras são as da própria tela (screenRules.ts), e o que a tela desliga fica fora dos cliques.
 * Só não cobre o que depende de pixel, como a posição de cada item: isso fica para a verificação no navegador.
 */
export function followClicks(
  manifest: SiteManifest,
  read: (file: string) => Record<string, any> | null,
  options: { blocked?: (search: string) => { uf: boolean; lavoura: boolean } } = {},
): ClickResult {
  const blocked = options.blocked ?? ((search: string) => blockedControls(search, true));
  const result: ClickResult = { addresses: 0, clicks: 0, requests: 0, tables: 0, failures: [] };
  const seen = new Set<string>();
  const seenCuts = new Set<string>();
  const pending = [""];
  const normal = (search: string) => correctedLink(search, true) ?? search;
  const hasFile = (search: string, requested: string) => {
    result.tables++;
    if (isPublished("detail", requested, manifest) && read(fileOf("detail", requested)) !== null) return true;
    if (result.failures.length < 20) result.failures.push(`?${search} leva a detail?${requested}, sem arquivo`);
    return false;
  };

  // A tabela só depende do recorte, do agrupamento, da ordem e da página: basta percorrê-la uma vez por recorte.
  const walkTable = (search: string) => {
    const cut = panelQuery(search, null);
    if (seenCuts.has(cut)) return;
    seenCuts.add(cut);
    for (const view of DETAIL_VIEWS) {
      const params = new URLSearchParams(cut);
      if (view !== null) params.set("por", view);
      const first = normal(params.toString());
      const requested = detailQuery(first);
      if (!hasFile(first, requested)) continue;
      const { count, pageSize } = read(fileOf("detail", requested)) as { count: number; pageSize: number };
      for (const column of detailControls(first, count, { hasMonth: false, staticSite: true }).sortable) {
        for (const direction of ["desc", "asc"]) {
          const sorted = new URLSearchParams(first);
          sorted.set("ordem", column);
          sorted.set("dir", direction);
          const address = normal(sorted.toString());
          hasFile(address, detailQuery(address));
        }
      }
      for (let page = 2; page <= Math.ceil(count / pageSize); page++) {
        const paged = new URLSearchParams(first);
        paged.set("pagina", String(page));
        const address = normal(paged.toString());
        hasFile(address, detailQuery(address));
      }
    }
  };

  while (pending.length > 0) {
    const search = pending.pop()!;
    if (seen.has(search)) continue;
    seen.add(search);
    result.addresses++;

    let complete = true;
    for (const [route, requested] of requestsOf(search)) {
      result.requests++;
      if (!isPublished(route, requested, manifest) || read(fileOf(route, requested)) === null) {
        complete = false;
        if (result.failures.length < 20) result.failures.push(`?${search} leva a ${route}?${requested}, sem arquivo`);
      }
    }
    if (!complete) continue;
    walkTable(search);

    const read1 = (route: SiteRoute, panel: string | null) => read(fileOf(route, panelQuery(search, panel)))!;
    const options1 = read1("filter-options", null);
    const can = blocked(search);
    const year = new URLSearchParams(search).get("ano");
    const chooseYear = (value: string | null) => chooseYearQuery(search, value, false, undefined);
    const next: string[] = [clearFilters(search)];
    const toggle = (panel: string, dimension: string, keys: string[]) => {
      for (const key of keys) next.push(toggleSelection(search, panel, dimension, key));
    };
    const rowKeys = (rows: { key: string | null }[]) => keysOf(rows);

    // Seletores.
    for (const value of [null, ALL_YEARS, ...keysOf(options1.ano)]) next.push(chooseYear(value));
    for (const value of [null, ...keysOf(options1.regiao)]) next.push(setFilter(setFilter(search, "uf", null), "regiao", value, ["uf"]));
    if (!can.uf) for (const value of [null, ...keysOf(options1.uf)]) next.push(setFilter(search, "uf", value, ["regiao"]));
    if (!can.lavoura) for (const value of [null, ...keysOf(options1.lavoura)]) next.push(setFilter(search, "lavoura", value));

    // Colunas do gráfico por ano e legenda: ele mostra sempre todos os anos.
    const years = requestsOf(search).find(([route]) => route === "by-year")![1];
    const yearly = read(fileOf("by-year", years))!;
    for (const key of yearly.categories as string[]) next.push(chooseYear(key === year ? null : key));
    toggle("anos", "regiao", (yearly.series as { key: string }[]).map((series) => series.key));

    // Donut, barras e mapa. O bloco não filtra a si mesmo, então cada um tem a própria lista.
    toggle("regioes", "regiao", rowKeys(read1("by-region", "regioes").rows));
    if (!can.uf) {
      toggle("estados", "uf", rowKeys(read1("by-state", "estados").rows));
      toggle("mapa", "uf", rowKeys(read1("by-state", "mapa").rows));
    }
    if (!can.lavoura) toggle("lavouras", "lavoura", rowKeys(read1("by-crop", "lavouras").rows));

    // Linhas da tabela agrupada: viram filtro global.
    for (const key of rowKeys(read1("by-region", null).rows)) next.push(setFilter(search, "regiao", key, ["uf"]));
    if (!can.uf) for (const key of rowKeys(read1("by-state", null).rows)) next.push(setFilter(search, "uf", key, ["regiao"]));
    if (!can.lavoura) for (const key of rowKeys(read1("by-crop", null).rows)) next.push(setFilter(search, "lavoura", key));

    for (const target of next) {
      result.clicks++;
      const address = normal(target);
      if (!seen.has(address)) pending.push(address);
    }
  }
  return result;
}
