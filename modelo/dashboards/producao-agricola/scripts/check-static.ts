// Prova o site estático contra a API de verdade: cada arquivo, byte a byte, e a conferência com os totais do IBGE guardados no banco.
// Precisa do servidor no ar, com os mesmos dados. Só lê, e não usa a rede para fora. Com --sabotar, troca 1 byte na comparação, para provar que reprova.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { openReader } from "../../../server/db/open.ts";
import { DB } from "../db.ts";
import { ALL_YEARS, DATA_DIR, DETAIL_VIEWS, fileOf, linkProblem, MANIFEST_FILE, readSite, SITE_ROUTES, type LoadFile, type SiteManifest, type SiteRoute } from "../shared/staticSite.ts";
import { followClicks, measureSite, readManifest, scanSite, walkSite, type Call } from "./static-tools.ts";

const API_URL = process.env.DASHBOARD_URL ?? "http://127.0.0.1:8787";
const SITE = process.argv.find((arg) => arg.startsWith("--pasta="))?.slice("--pasta=".length) ?? "dist-static";
const SABOTAGE = process.argv.includes("--sabotar");
const WORKERS = 12;

if (!existsSync(path.join(SITE, MANIFEST_FILE))) {
  console.error(`Não há site em ${SITE}. Rode npm run build:static.`);
  process.exit(1);
}

let failures = 0;
const fail = (message: string) => {
  failures++;
  if (failures <= 20) console.error(`DIVERGE ${message}`);
};

const fetchApi = async (route: string, query: string) => {
  const response = await fetch(`${API_URL}/api/d/producao-agricola/${route}${query ? `?${query}` : ""}`);
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
};
const call: Call = async (route, query) => {
  const { status, bytes } = await fetchApi(route, query);
  if (status !== 200) throw new Error(`A API respondeu ${status} em ${route}?${query}.`);
  return bytes.toString("utf8");
};

// 1. O índice do site contra o que a API diz que existe.
const manifest = JSON.parse(readFileSync(path.join(SITE, MANIFEST_FILE), "utf8")) as SiteManifest;
const live = await readManifest(call, manifest.generatedAt);
for (const key of ["updatedAt", "years", "states", "crops", "regionCrops"] as const) {
  if (JSON.stringify(live[key]) !== JSON.stringify(manifest[key])) fail(`índice: ${key} não bate com a API`);
}
console.log(`Índice: carga de ${manifest.updatedAt}, ${manifest.years.length} anos, ${Object.keys(manifest.states).length} UFs, ${manifest.crops.length} lavouras.`);

// 2. Cada arquivo, byte a byte. O caminho da lista é o mesmo do gerador, mas a resposta vem da API, pela rede.
const expected = new Set<string>();
let compared = 0;
let sabotaged = false;
await walkSite(manifest, call, async (route, query, text) => {
  const file = fileOf(route, query);
  expected.add(file);
  const full = path.join(SITE, file);
  if (!existsSync(full)) return fail(`${file}: arquivo ausente`);
  const bytes = Buffer.from(readFileSync(full));
  if (SABOTAGE && !sabotaged) {
    bytes[0] ^= 1;
    sabotaged = true;
  }
  compared++;
  if (!bytes.equals(Buffer.from(text))) fail(`${file}: difere da API em ${route}?${query}`);
}, WORKERS);
console.log(`Byte a byte: ${compared} arquivos comparados com a API.`);

const listed = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listed(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const extras = listed(path.join(SITE, DATA_DIR)).map((file) => path.relative(SITE, file).replaceAll("\\", "/")).filter((file) => file !== MANIFEST_FILE && !expected.has(file));
for (const file of extras) fail(`${file}: arquivo fora do plano`);
console.log(`Arquivos fora do plano: ${extras.length}.`);

// 3. O que a tela lê em outro arquivo, porque a resposta é a mesma: UF com a região dela, a ordem padrão por extenso, coluna que não ordena, tabela de uma linha, página além do fim.
const load: LoadFile = async (file) => {
  const full = path.join(SITE, file);
  return existsSync(full) ? JSON.parse(readFileSync(full, "utf8")) : null;
};
let aliases = 0;
async function compareRead(route: SiteRoute, query: string) {
  aliases++;
  const shown = JSON.stringify(await readSite(route, query, manifest, load));
  const real = await call(route, query);
  if (shown !== real) fail(`leitura de ${route}?${query}: difere da API`);
}
const aliasQueries: [SiteRoute, string][] = [];
const years = [null, ...manifest.years, ALL_YEARS];
const withYear = (values: Record<string, string>, year: string | null) => {
  const params = new URLSearchParams(values);
  if (year !== null) params.set("ano", year);
  params.sort();
  return params.toString();
};
for (const [state, region] of Object.entries(manifest.states)) {
  aliasQueries.push(["by-year", withYear({ uf: state, regiao: region }, ALL_YEARS)]);
  for (const year of years) {
    const base = withYear({ uf: state, regiao: region }, year);
    for (const route of ["summary", "by-region", "by-state", "by-crop"] as const) aliasQueries.push([route, base]);
    for (const view of DETAIL_VIEWS) aliasQueries.push(["detail", view === null ? base : `${base}&por=${view}`]);
  }
}
for (const year of years) {
  for (const cut of [{}, { regiao: "Sul" }, { uf: "51" }, { lavoura: manifest.crops[0] }] as Record<string, string>[]) {
    const base = withYear(cut, year);
    const and = base ? `${base}&` : "";
    aliasQueries.push(["detail", `${and}ordem=valor&dir=desc`], ["detail", `${and}dir=desc`], ["detail", `${and}ordem=valor`], ["detail", `${and}pagina=1`], ["detail", `${and}pagina=99999`]);
    for (const view of DETAIL_VIEWS.slice(1)) {
      aliasQueries.push(["detail", `${and}por=${view}&ordem=valor&dir=desc`], ["detail", `${and}por=${view}&pagina=99999`]);
      // Coluna só com "—" não ordena: a API ignora a ordem.
      if (view !== "lavoura" && !("lavoura" in cut)) aliasQueries.push(["detail", `${and}por=${view}&ordem=quantidade&dir=asc`]);
      if (year === ALL_YEARS && view !== "ano") aliasQueries.push(["detail", `${and}por=${view}&ordem=area&dir=asc`]);
    }
    // Tabela de uma linha: a ordem não muda nada, e não há arquivo para ela.
    if ("uf" in cut && !("lavoura" in cut)) aliasQueries.push(["detail", `${and}por=uf&ordem=nome&dir=asc`], ["detail", `${and}por=regiao&ordem=valor&dir=asc`]);
  }
}
let nextAlias = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (nextAlias < aliasQueries.length) {
    const [route, query] = aliasQueries[nextAlias++];
    await compareRead(route, query);
  }
}));
console.log(`Leituras por outro nome: ${aliases} comparadas com a API.`);

// 4. Link inválido: a mesma recusa, com a mesma mensagem.
const INVALID = ["xpto=1", "ano=1999", "ano=abc", "regiao=Marte", "uf=99", "lavoura=99999", "lavoura=abc", "ano=2024&ano=2023", "uf=", "mes=1"];
const INVALID_DETAIL = ["por=xpto", "por=mes", "pagina=abc", "pagina=0", "ordem=xpto", "dir=xpto", "por=uf&ordem=uf", "ordem=nome", "ordem=mes"];
let refusals = 0;
for (const [route, query] of [...SITE_ROUTES.flatMap((name) => INVALID.map((text): [SiteRoute, string] => [name, text])), ...INVALID_DETAIL.map((text): [SiteRoute, string] => ["detail", text])]) {
  refusals++;
  const { status, bytes } = await fetchApi(route, query);
  const message = status === 400 ? JSON.parse(bytes.toString("utf8")).error : null;
  if (status !== 400 || linkProblem(route, query, manifest) !== message) fail(`link ${route}?${query}: a API diz "${message}" (${status}), o site diz "${linkProblem(route, query, manifest)}"`);
}
console.log(`Links inválidos: ${refusals} recusas iguais às da API.`);

// 5. A conferência: os totais do site contra os publicados pelo IBGE, da cópia guardada no banco pela carga. Não consulta o IBGE agora.
const TOLERANCE = 27_000n; // cada uma das 27 UFs pode diferir em até R$ 1.000
const reader = await openReader(DB);
// No SQLite, o decimal fica em inteiro, e dec_text devolve o mesmo texto do Postgres.
const decimalText = (column: string) => (reader.engine === "sqlite" ? `dec_text(${column}, '${column}')` : `${column}::text`);
const { rows: sources } = await reader.query(`SELECT year, crop_code, ${decimalText("value_brl")} AS value, ${decimalText("quantity_t")} AS quantity, ${decimalText("area_ha")} AS area FROM source_national ORDER BY year, crop_code`);
await reader.end();
const whole = (value: string | null) => BigInt((value ?? "0").split(".")[0]);
const siteSummary = (query: string) => JSON.parse(readFileSync(path.join(SITE, fileOf("summary", query)), "utf8"));
let checks = 0;
const conferir = (label: string, ok: boolean) => {
  checks++;
  if (!ok) fail(`conferência: ${label}`);
};
for (const source of sources as { year: number; crop_code: string; value: string | null; quantity: string | null; area: string | null }[]) {
  const year = String(source.year);
  if (!manifest.years.includes(year)) continue;
  if (source.crop_code === "0") {
    const site = siteSummary(`ano=${year}`);
    const gap = whole(site.value) - whole(source.value);
    conferir(`valor do Brasil em ${year}: fonte ${source.value}, site ${site.value}`, gap <= TOLERANCE && gap >= -TOLERANCE);
    conferir(`área do Brasil em ${year}: fonte ${source.area}, site ${site.area}`, whole(site.area) === whole(source.area));
  } else if (source.crop_code !== "40139") {
    // Café total fica de fora: o dashboard soma arábica e canephora.
    const hasValue = [source.value, source.quantity, source.area].some((value) => value !== null && Number(value) !== 0);
    if (!manifest.crops.includes(source.crop_code)) {
      conferir(`lavoura ${source.crop_code} da fonte, em ${year}, fora do site`, !hasValue);
      continue;
    }
    const site = siteSummary(`ano=${year}&lavoura=${source.crop_code}`);
    const gap = whole(site.value) - whole(source.value);
    conferir(`valor da lavoura ${source.crop_code} em ${year}: fonte ${source.value}, site ${site.value}`, gap <= TOLERANCE && gap >= -TOLERANCE);
    conferir(`quantidade da lavoura ${source.crop_code} em ${year}: fonte ${source.quantity}, site ${site.quantity}`, Number(site.quantity ?? 0) === Number(source.quantity ?? 0));
  }
}
const apiCheck = await (await fetch(`${API_URL}/api/d/producao-agricola/check`)).json() as { rows: { status: string }[] };
const apiDiverges = apiCheck.rows.filter((row) => row.status !== "OK").length;
if (apiDiverges > 0 || apiCheck.rows.length === 0) fail(`a conferência da API tem ${apiDiverges} divergências em ${apiCheck.rows.length}`);
console.log(`Conferência com os totais do IBGE: ${checks} comparações do site, e ${apiCheck.rows.length} da tela de Conferência, com ${apiDiverges} divergências.`);

// 6. Todos os cliques possíveis, a partir da abertura.
const cache = new Map<string, Record<string, any> | null>();
const readDisk = (file: string) => {
  const known = cache.get(file);
  if (known !== undefined) return known;
  const full = path.join(SITE, file);
  const parsed = existsSync(full) ? JSON.parse(readFileSync(full, "utf8")) : null;
  // Os detalhes são muitos: da tabela, só importam o total de linhas e o tamanho da página.
  const data = parsed && file.includes("/detail/") ? { count: parsed.count, pageSize: parsed.pageSize } : parsed;
  cache.set(file, data);
  return data;
};
const started = Date.now();
const clicks = followClicks(manifest, readDisk);
for (const failure of clicks.failures) fail(`clique: ${failure}`);
console.log(`Cliques: ${clicks.addresses} endereços alcançados e ${clicks.clicks} cliques seguidos, em ${Math.round((Date.now() - started) / 1000)} s, com ${clicks.requests} consultas de bloco, ${clicks.tables} estados da tabela (agrupamento, ordem e página) e ${clicks.failures.length} sem arquivo.`);

// 7. Varredura.
const secrets = Object.entries(process.env).flatMap(([name, value]) => (/PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL/.test(name) && value ? [value] : []));
const findings = scanSite(SITE, { secrets });
for (const finding of findings) fail(`varredura: ${finding}`);
const size = measureSite(SITE);
console.log(`Varredura: ${size.files} arquivos, ${(size.bytes / 1024 / 1024).toFixed(1)} MB, ${findings.length} achados.`);

console.log(`\n${failures} divergências.`);
process.exitCode = failures === 0 ? 0 : 1;
