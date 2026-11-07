// O site estático por dentro: o que é publicado, o nome de cada arquivo, a leitura, os cliques e a varredura.
// Com poucas linhas escritas à mão, em um SQLite temporário. Sem rede, dado real ou credencial.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { readerAccess } from "../../../server/db/open.ts";
import { createSqliteFile, openSqlite, writeRows } from "../../../server/db/sqlite.ts";
import { producaoAgricola } from "../dashboard.ts";
import { DB } from "../db.ts";
import type { Db } from "../../../server/db/types.ts";
import { ALL_STATES, BadRequest, readDetail, readFilters } from "../domain/filters.ts";
import { createQueries } from "../domain/queries.ts";
import { createDataRoutes } from "../domain/routes.ts";
import { assertPublishable, assertWithinLimits, checkOutputFolder, followClicks, siteFingerprint, readManifest, requestsOf, scanSite, walkSite, WORK_MARK, type Call } from "../scripts/static-tools.ts";
import { screenQueries } from "../web/screenRules.ts";
import { blockedFilters, fileOf, fixSiteLink, isOrderPublished, isOtherOrder, isPublished, isStale, linkProblem, MANIFEST_FILE, readSite, SiteFailure, type LoadFile, type SiteManifest, type SiteRoute } from "../shared/staticSite.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-static-test-"));
const dbFile = path.join(dir, "banco.sqlite");
const site = path.join(dir, "site");
let reader: Db;
let call: Call;
let manifest: SiteManifest;
const written = new Map<string, string>();

const line = (year: number, state: string, stateName: string, region: string, crop: string, cropName: string, value: string) => ({
  year, state_code: state, state_name: stateName, region, crop_code: crop, crop_name: cropName, value_brl: value, quantity_t: "10.000", quantity_unit: "t", area_ha: "2.000",
});

const ROWS = [
  line(2024, "41", "Paraná", "Sul", "1", "Soja", "100.00"),
  line(2024, "42", "Santa Catarina", "Sul", "1", "Soja", "50.00"),
  line(2024, "15", "Pará", "Norte", "2", "Açaí", "30.00"),
  line(2023, "41", "Paraná", "Sul", "1", "Soja", "90.00"),
  line(2023, "15", "Pará", "Norte", "2", "Açaí", "20.00"),
];
// Mais de uma página na tabela: 25 lavouras no Paraná, em 2024.
for (let i = 0; i < 25; i++) ROWS.push(line(2024, "41", "Paraná", "Sul", String(100 + i), `Lavoura ${String(i).padStart(2, "0")}`, "1.00"));
const LOG = { entity: "teste", started_at: "2026-10-30T10:00:00.000Z", finished_at: "2026-10-30T10:01:00.000Z", status: "ok" };

before(async () => {
  createSqliteFile(dbFile, producaoAgricola.sqlite({}));
  const db = new DatabaseSync(dbFile);
  writeRows(db, "production", ROWS);
  writeRows(db, "load_log", [LOG]);
  db.close();
  reader = openSqlite(dbFile, readerAccess(DB));
  const { routes } = createDataRoutes(createQueries(reader), false);
  call = async (route, query) => JSON.stringify(await routes[route](new URLSearchParams(query), ALL_STATES));
  manifest = await readManifest(call, "2026-10-31T00:00:00.000Z");
  await walkSite(manifest, call, async (route, query, text) => {
    written.set(fileOf(route, query), text);
    const file = path.join(site, fileOf(route, query));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  });
  writeFileSync(path.join(site, MANIFEST_FILE), JSON.stringify(manifest));
  writeFileSync(path.join(site, "index.html"), '<!doctype html><div id="root"></div><script src="./assets/a.js"></script>');
});

after(async () => {
  await reader?.end();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const load: LoadFile = async (file) => (written.has(file) ? JSON.parse(written.get(file)!) : null);
const read = (route: SiteRoute, query: string, loader = load) => readSite(route, query, manifest, loader) as Promise<Record<string, any>>;

test("índice: lê da própria API os anos, as UFs de cada região e as lavouras de cada região", () => {
  assert.deepEqual(manifest.years, ["2024", "2023"]);
  assert.deepEqual(manifest.states, { "15": "Norte", "41": "Sul", "42": "Sul" });
  assert.deepEqual(manifest.regionCrops.Norte, ["2"]);
  assert.equal(manifest.regionCrops.Sul.length, 26);
  assert.equal(manifest.crops.length, 27);
  assert.equal(manifest.updatedAt, "2026-10-30T10:01:00.000Z");
});

test("arquivo: é a resposta da rota para aquela consulta, byte a byte, com os números escritos à mão", async () => {
  assert.equal(written.get("dados/summary/ano=2024.json"), await call("summary", "ano=2024"));
  assert.equal(JSON.parse(written.get("dados/summary/ano=2024.json")!).value, "205.00");
  assert.equal(JSON.parse(written.get("dados/summary/index.json")!).value, "205.00", "sem ano, vale o mais recente");
  assert.equal(JSON.parse(written.get("dados/summary/ano=todos.json")!).value, "315.00");
  assert.equal(JSON.parse(written.get("dados/summary/ano=2024&uf=41.json")!).value, "125.00");
  assert.equal(JSON.parse(written.get("dados/summary/ano=2023&lavoura=1&regiao=Sul.json")!).value, "90.00");
  assert.equal(JSON.parse(written.get("dados/by-region/ano=2024.json")!).total, "205.00");
});

test("corte: UF não se combina com lavoura, e nenhum arquivo traz os dois", () => {
  const both = [...written.keys()].filter((file) => file.includes("uf=") && file.includes("lavoura="));
  assert.deepEqual(both, []);
  assert.equal(isPublished("summary", "lavoura=1&uf=41", manifest), false);
  assert.equal(isPublished("summary", "lavoura=1&regiao=Sul", manifest), true);
  assert.equal(isPublished("summary", "lavoura=2&regiao=Sul", manifest), false, "a lavoura não existe na região em nenhum ano");
  assert.equal(isPublished("summary", "regiao=Norte&uf=41", manifest), false, "a UF não é da região");
  assert.equal(isPublished("summary", "regiao=Sul&uf=41", manifest), true);
});

test("arquivo: o nome é único por consulta, e os textos equivalentes caem no mesmo", () => {
  assert.equal(fileOf("summary", ""), "dados/summary/index.json");
  assert.equal(fileOf("summary", "uf=41&ano=2024"), "dados/summary/ano=2024&uf=41.json");
  // UF com a região dela: a mesma resposta, menos na lista de UFs do seletor.
  assert.equal(fileOf("by-state", "regiao=Sul&uf=41"), "dados/by-state/uf=41.json");
  assert.equal(fileOf("filter-options", "regiao=Sul&uf=41"), "dados/filter-options/regiao=Sul&uf=41.json");
  assert.equal(fileOf("detail", "ordem=valor&dir=desc"), "dados/detail/index.json");
  assert.equal(fileOf("detail", "dir=desc"), "dados/detail/index.json");
  assert.equal(fileOf("detail", "pagina=1"), "dados/detail/index.json");
  assert.equal(fileOf("detail", "dir=asc"), "dados/detail/dir=asc&ordem=valor.json");
  assert.equal(fileOf("detail", "ordem=area"), "dados/detail/dir=desc&ordem=area.json");
  // Coluna só com "—" não ordena: a API ignora, e o arquivo é o da ordem padrão.
  assert.equal(fileOf("detail", "por=uf&ordem=quantidade&dir=asc"), "dados/detail/por=uf.json");
  assert.equal(fileOf("detail", "ano=todos&por=uf&ordem=area&dir=asc"), "dados/detail/ano=todos&por=uf.json");
  assert.equal(fileOf("detail", "ano=2024&por=uf&ordem=area&dir=asc"), "dados/detail/ano=2024&dir=asc&ordem=area&por=uf.json");
});

test("ordem: outra ordem só existe sem lavoura e região juntas e na primeira página, e todas as páginas ficam na ordem padrão", async () => {
  assert.equal(isOrderPublished(new URLSearchParams("ordem=area&dir=asc")), true);
  assert.equal(isOrderPublished(new URLSearchParams("ordem=area&dir=asc&pagina=2")), false);
  assert.equal(isOrderPublished(new URLSearchParams("ordem=area&dir=asc&lavoura=1")), true);
  assert.equal(isOrderPublished(new URLSearchParams("ordem=area&dir=asc&lavoura=1&regiao=Sul")), false);
  assert.equal(isOrderPublished(new URLSearchParams("pagina=2&lavoura=1&regiao=Sul")), true);
  assert.ok(written.has("dados/detail/ano=2024&uf=41.json"));
  assert.ok(written.has("dados/detail/ano=2024&pagina=2&uf=41.json"));
  assert.ok(written.has("dados/detail/ano=2024&dir=asc&ordem=lavoura&uf=41.json"));
  assert.ok(!written.has("dados/detail/ano=2024&dir=asc&ordem=lavoura&pagina=2&uf=41.json"));
  assert.equal(written.get("dados/detail/ano=2024&dir=asc&ordem=lavoura&uf=41.json"), await call("detail", "ano=2024&dir=asc&ordem=lavoura&uf=41"));
  assert.ok(written.has("dados/detail/ano=todos&dir=asc&lavoura=1&ordem=quantidade&por=uf.json"), "com lavoura sem região, ordena");
  assert.ok(![...written.keys()].some((file) => file.includes("ordem=") && file.includes("lavoura=") && file.includes("regiao=")), "com lavoura e região, só a ordem padrão");
  // Tabela de uma linha não tem arquivo em outra ordem, e a ordem não muda nada nela.
  assert.ok(!written.has("dados/detail/ano=2024&dir=asc&ordem=nome&por=uf&uf=41.json"));
  assert.deepEqual(await read("detail", "ano=2024&dir=asc&ordem=nome&por=uf&uf=41"), JSON.parse(await call("detail", "ano=2024&dir=asc&ordem=nome&por=uf&uf=41")));
});

test("leitura: mostra a mesma resposta da API, inclusive por outro nome", async () => {
  for (const [route, query] of [["summary", "ano=2024"], ["by-state", "regiao=Sul&uf=41"], ["summary", "regiao=Sul&uf=41&ano=2024"], ["detail", "ordem=valor&dir=desc"], ["filter-options", "regiao=Sul&uf=41"]] as [SiteRoute, string][]) {
    assert.equal(JSON.stringify(await read(route, query)), await call(route, query), `${route}?${query}`);
  }
});

test("leitura: página além do fim vem sem linhas, com o total, como a API, e a tabela leva à última", async () => {
  const query = "ano=2024&pagina=99&uf=41";
  const shown = await read("detail", query);
  assert.deepEqual(shown.rows, []);
  assert.equal(JSON.stringify(shown), await call("detail", query));
});

test("leitura: tabela de uma linha e página além do fim não pedem um arquivo que não existe", async () => {
  const asked: string[] = [];
  const recording: LoadFile = async (file) => {
    asked.push(file);
    return load(file);
  };
  await read("detail", "ano=2024&dir=asc&ordem=nome&por=uf&uf=41", recording);
  await read("detail", "ano=2024&pagina=99&uf=41", recording);
  assert.ok(asked.every((file) => written.has(file)), asked.join());
  assert.equal(asked.length, 2);
});

test("leitura: combinação fora do publicado avisa e não busca arquivo nenhum", async () => {
  let asked = 0;
  const counting: LoadFile = async (file) => {
    asked++;
    return load(file);
  };
  for (const [route, query, reason] of [
    ["summary", "lavoura=1&uf=41", /UF e lavoura não se combinam/],
    ["by-crop", "regiao=Norte&uf=41", /não faz parte desta região/],
    ["summary", "lavoura=2&regiao=Sul", /não tem produção nesta região/],
    ["detail", "lavoura=1&regiao=Sul&ordem=area&dir=asc", /ordem por valor/],
    ["detail", "ordem=area&dir=asc&pagina=2", /ordem por valor/],
  ] as [SiteRoute, string, RegExp][]) {
    await assert.rejects(read(route, query, counting), (error: SiteFailure) => error.kind === "unpublished" && reason.test(error.message), `${route}?${query}`);
  }
  assert.equal(asked, 0);
});

test("leitura: UF de outra região nunca mostra os números da UF sozinha", async () => {
  await assert.rejects(read("summary", "ano=2024&regiao=Norte&uf=41"), (error: SiteFailure) => error.kind === "unpublished");
  assert.equal(JSON.parse(await call("summary", "ano=2024&regiao=Norte&uf=41")).value, null, "a API diz que não há dado");
});

test("leitura: arquivo que deveria existir e sumiu é falha, nunca zero nem sem dados", async () => {
  const missing: LoadFile = async () => null;
  await assert.rejects(read("summary", "ano=2024", missing), (error: SiteFailure) => error.kind === "absent");
  await assert.rejects(read("detail", "ordem=area&dir=asc", missing), (error: SiteFailure) => error.kind === "absent");
  await assert.rejects(read("detail", "pagina=2", missing), (error: SiteFailure) => error.kind === "absent");
  // Página que existe, sem o arquivo dela: não vira página vazia.
  const onlyFirst: LoadFile = async (file) => (file === "dados/detail/ano=2024&uf=41.json" ? load(file) : null);
  await assert.rejects(read("detail", "ano=2024&pagina=2&uf=41", onlyFirst), (error: SiteFailure) => error.kind === "absent");
  // Outra ordem sumida em uma tabela de muitas linhas: não mostra a ordem padrão no lugar.
  await assert.rejects(read("detail", "ano=2024&dir=asc&ordem=area&uf=41", onlyFirst), (error: SiteFailure) => error.kind === "absent");
});

test("link inválido: as mesmas recusas e as mesmas mensagens da API, para cada rota", async () => {
  const { routes } = createDataRoutes(createQueries(reader), false);
  const cases = ["", "ano=2024", "ano=02024", "ano=todos", "uf=41", "regiao=Sul", "lavoura=1", "xpto=1", "ano=1999", "ano=abc", "regiao=Marte", "uf=99", "lavoura=99999", "lavoura=abc", "ano=2024&ano=2023", "uf=", "mes=1"];
  const detail = ["por=uf", "por=ano&ordem=nome", "pagina=2", "pagina=01", "pagina=000",  "por=xpto", "por=mes", "pagina=abc", "pagina=0", "ordem=xpto", "dir=xpto", "por=uf&ordem=uf", "ordem=nome", "ordem=mes", "por=lavoura&ordem=quantidade&dir=asc"];
  const all: [SiteRoute, string][] = [...(["filter-options", "summary", "by-region", "by-state", "by-crop", "detail"] as SiteRoute[]).flatMap((route) => cases.map((query): [SiteRoute, string] => [route, query])), ...detail.map((query): [SiteRoute, string] => ["detail", query])];
  for (const [route, query] of all) {
    const expected = await routes[route](new URLSearchParams(query), ALL_STATES).then(() => null, (error) => {
      assert.ok(error instanceof BadRequest, String(error));
      return error.message;
    });
    assert.equal(linkProblem(route, query, manifest), expected, `${route}?${query}`);
  }
  // As regras da API seguem sendo as de filters.ts: se elas mudarem, esta prova muda junto.
  assert.throws(() => readFilters(new URLSearchParams("xpto=1")), /desconhecido/);
  assert.throws(() => readDetail(new URLSearchParams("ordem=xpto")), /Ordem inválida/);
});

test("controles: com lavoura, a UF fica desligada, e com UF, a lavoura. Vale também para a seleção por clique", () => {
  assert.deepEqual(blockedFilters(""), { uf: false, lavoura: false });
  assert.deepEqual(blockedFilters("lavoura=1"), { uf: true, lavoura: false });
  assert.deepEqual(blockedFilters("uf=41"), { uf: false, lavoura: true });
  assert.deepEqual(blockedFilters("sel.lavouras=lavoura:1"), { uf: true, lavoura: false });
  assert.deepEqual(blockedFilters("sel.mapa=uf:41"), { uf: false, lavoura: true });
  assert.deepEqual(blockedFilters("regiao=Sul"), { uf: false, lavoura: false });
});

test("link: ordem que não existe no recorte volta à padrão, e página em outra ordem volta à primeira", () => {
  assert.equal(fixSiteLink("ano=2024"), null);
  assert.equal(fixSiteLink("ordem=area&dir=asc"), null);
  assert.equal(fixSiteLink("pagina=3"), null);
  assert.equal(fixSiteLink("lavoura=1&pagina=3"), null);
  assert.equal(fixSiteLink("lavoura=1&ordem=area&dir=asc"), null);
  assert.equal(fixSiteLink("ordem=area&dir=asc&pagina=2"), "ordem=area&dir=asc");
  assert.equal(fixSiteLink("lavoura=1&regiao=Sul&ordem=area&dir=asc"), "lavoura=1&regiao=Sul");
  assert.equal(fixSiteLink("sel.lavouras=lavoura%3A1&regiao=Sul&por=uf&ordem=nome&dir=asc"), "sel.lavouras=lavoura%3A1&regiao=Sul&por=uf");
});

test("tabela: coluna só com — não conta como outra ordem, porque a API a ignora, e a Próxima continua ligada", () => {
  assert.equal(isOtherOrder(""), false);
  assert.equal(isOtherOrder("ordem=valor&dir=desc"), false);
  assert.equal(isOtherOrder("ordem=area&dir=asc"), true);
  assert.equal(isOtherOrder("dir=asc"), true);
  assert.equal(isOtherOrder("por=uf&ordem=area&dir=asc"), true);
  assert.equal(isOtherOrder("ano=todos&por=uf&ordem=area&dir=asc"), false);
  assert.equal(isOtherOrder("por=uf&ordem=quantidade&dir=asc"), false);
  assert.equal(isOtherOrder("sel.lavouras=lavoura%3A1&por=uf&ordem=quantidade&dir=asc"), true);
});

const readWritten = (file: string) => (written.has(file) ? JSON.parse(written.get(file)!) : null);

test("cliques: da abertura, nenhum controle ligado leva a um bloco sem arquivo. Sem os controles desligados, leva", () => {
  const clicks = followClicks(manifest, readWritten);
  assert.deepEqual(clicks.failures, []);
  assert.ok(clicks.addresses > 100, String(clicks.addresses));
  const unguarded = followClicks(manifest, readWritten, { blocked: () => ({ uf: false, lavoura: false }) });
  assert.ok(unguarded.failures.length > 0, "a prova precisa reprovar sem as travas");
  assert.match(unguarded.failures[0], /lavoura=\d+.*uf=|uf=.*lavoura=\d+/);
});

test("cliques: as consultas são as da tela, pela mesma regra, e não uma cópia", () => {
  for (const search of ["", "ano=2024&sel.mapa=uf%3A41", "sel.anos=regiao%3ASul&por=uf&ordem=nome&dir=asc&pagina=2"]) {
    const screen = screenQueries(search, false);
    assert.deepEqual(requestsOf(search).map(([, query]) => query), [screen.options, screen.summary, screen.years, screen.regions, screen.states, screen.map, screen.crops, screen.detail]);
  }
});

test("cliques: percorre a tabela, com cada agrupamento, cada ordem e cada página. Sem um desses arquivos, reprova", () => {
  const clicks = followClicks(manifest, readWritten);
  assert.ok(clicks.tables > 1000, String(clicks.tables));
  const without = (file: string) => {
    assert.ok(written.has(file), file);
    return followClicks(manifest, (name) => (name === file ? null : readWritten(name))).failures;
  };
  assert.match(without("dados/detail/ano=2024&pagina=2&uf=41.json").join(), /pagina=2/, "página");
  assert.match(without("dados/detail/ano=2024&dir=asc&ordem=lavoura&uf=41.json").join(), /ordem=lavoura/, "ordem das linhas");
  assert.match(without("dados/detail/ano=2024&dir=asc&ordem=nome&por=lavoura&uf=41.json").join(), /ordem=nome/, "ordem do agrupado");
  assert.match(without("dados/detail/ano=2024&por=regiao.json").join(), /por=regiao/, "agrupamento");
});

test("link: a página e o ano são números, como na API. \"01\" é a página 1, e não falta de arquivo", async () => {
  for (const [route, query] of [["detail", "pagina=01"], ["detail", "ano=2024&uf=41&pagina=02"], ["detail", "pagina=001&por=uf"], ["summary", "ano=02024"], ["detail", "ano=02024&uf=41"]] as [SiteRoute, string][]) {
    assert.equal(linkProblem(route, query, manifest), null, query);
    assert.equal(JSON.stringify(await read(route, query)), await call(route, query), `${route}?${query}`);
  }
  assert.equal(fileOf("detail", "pagina=01"), "dados/detail/index.json");
  assert.equal(fileOf("detail", "pagina=02"), "dados/detail/pagina=2.json");
  assert.equal(fileOf("summary", "ano=02024"), "dados/summary/ano=2024.json");
});

const PROJECT = path.join(dir, "projeto");
const folder = (name: string, files: Record<string, string> = {}) => {
  const target = path.join(dir, "destinos", name);
  mkdirSync(target, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    writeFileSync(path.join(target, file), text);
  }
  return target;
};
const OWN_MANIFEST = JSON.stringify({ publicData: true, generatedAt: "2026-10-31T00:00:00.000Z", years: ["2024"] });

test("pasta de destino: aceita a que não existe, a vazia e a que o gerador criou", () => {
  mkdirSync(path.join(PROJECT, "dist-static"), { recursive: true });
  assert.doesNotThrow(() => checkOutputFolder(path.join(dir, "destinos", "nao-existe"), PROJECT));
  assert.doesNotThrow(() => checkOutputFolder(folder("vazia"), PROJECT));
  assert.doesNotThrow(() => checkOutputFolder(path.join(PROJECT, "dist-static"), PROJECT));
  // Arquivo de outra pessoa dentro de uma subpasta do site.
  assert.throws(() => checkOutputFolder(folder("site-com-alheio", { "index.html": "x", "assets/a.js": "x", "assets/meu-trabalho.psd": "x", [MANIFEST_FILE]: OWN_MANIFEST }), PROJECT), /não são de um site/);
  assert.throws(() => checkOutputFolder(folder("site-com-alheio2", { "index.html": "x", "dados/by-state/planilha.xlsx": "x", [MANIFEST_FILE]: OWN_MANIFEST }), PROJECT), /não são de um site/);
  // Com a impressão no manifesto, nem um arquivo com a extensão certa passa.
  const printed = folder("site-com-impressao", { "index.html": "x", "assets/a.js": "x", "dados/by-state/a.json": "x" });
  writeFileSync(path.join(printed, MANIFEST_FILE), JSON.stringify({ ...JSON.parse(OWN_MANIFEST), filesHash: siteFingerprint(printed) }));
  assert.doesNotThrow(() => checkOutputFolder(printed, PROJECT));
  writeFileSync(path.join(printed, "dados", "by-state", "minha.json"), "{}");
  assert.throws(() => checkOutputFolder(printed, PROJECT), /mudou depois de gerada/);
  assert.doesNotThrow(() => checkOutputFolder(folder("site", { "index.html": "x", "assets/a.js": "x", [MANIFEST_FILE]: OWN_MANIFEST }), PROJECT));
});

test("pasta de destino: recusa a raiz, o projeto, as antepassadas dele e o que não é do gerador, sem apagar nada", () => {
  mkdirSync(PROJECT, { recursive: true });
  const refused: [string, string, RegExp][] = [
    ["raiz", path.parse(PROJECT).root, /raiz/],
    ["projeto", PROJECT, /projeto/],
    ["projeto, com ponto", path.join(PROJECT, "."), /projeto/],
    ["pai do projeto", path.dirname(PROJECT), /projeto/],
    ["avô do projeto", path.dirname(path.dirname(PROJECT)), /projeto/],
    ["pasta com outros arquivos", folder("outra", { "notas.txt": "guardar" }), /não são de um site/],
    ["índice de outro programa", folder("alheio", { [MANIFEST_FILE]: '{"nome":"outro"}' }), /não são de um site/],
    ["índice quebrado", folder("quebrado", { [MANIFEST_FILE]: "{" }), /não são de um site/],
    ["site com arquivo a mais", folder("com-extra", { "index.html": "x", [MANIFEST_FILE]: OWN_MANIFEST, "CNAME": "guardar" }), /não são de um site/],
    ["arquivo", path.join(folder("com-arquivo", { "um.txt": "guardar" }), "um.txt"), /não é uma pasta/],
  ];
  for (const [name, target, reason] of refused) assert.throws(() => checkOutputFolder(target, PROJECT), reason, name);
  assert.equal(readFileSync(path.join(dir, "destinos", "outra", "notas.txt"), "utf8"), "guardar");
});

test("pasta de destino: recusa o atalho, mesmo apontando para uma pasta do gerador", (t) => {
  const real = folder("real", { "index.html": "x", [MANIFEST_FILE]: OWN_MANIFEST });
  const link = path.join(dir, "destinos", "atalho");
  try {
    symlinkSync(real, link, "junction");
  } catch {
    return t.skip("este sistema não cria atalho");
  }
  assert.throws(() => checkOutputFolder(link, PROJECT), /atalho/);
});

test("pasta de trabalho: só a vazia ou com a marca do gerador, para uma geração interrompida não travar a próxima", () => {
  assert.doesNotThrow(() => checkOutputFolder(folder("trabalho-vazia"), PROJECT, { workMark: true }));
  assert.doesNotThrow(() => checkOutputFolder(folder("trabalho-sobra", { [WORK_MARK]: "", "index.html": "x" }), PROJECT, { workMark: true }));
  assert.throws(() => checkOutputFolder(folder("trabalho-alheia", { "notas.txt": "guardar" }), PROJECT, { workMark: true }), /não reconhece/);
  assert.throws(() => checkOutputFolder(PROJECT, PROJECT, { workMark: true }), /projeto/);
});

test("gerador: recusa antes de qualquer coisa, sem banco, e não toca na pasta", () => {
  const run = (target: string) => spawnSync(process.execPath, ["dashboards/producao-agricola/scripts/build-static.ts", `--pasta=${target}`], { windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, DB_ENGINE: "sqlite", SQLITE_DIR: path.join(dir, "nao-existe"), AUTH_MODE: "", MONTH_FILTER: "" },
  });
  const kept = folder("protegida", { "notas.txt": "guardar" });
  const refused = run(kept);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Recusei a pasta/);
  assert.deepEqual(readdirSync(kept), ["notas.txt"]);
  assert.ok(!existsSync(`${kept}.tmp`));
  const self = run(".");
  assert.equal(self.status, 1);
  assert.match(self.stderr, /é a pasta do projeto/);
  assert.ok(existsSync("package.json"), "o projeto continua no lugar");
});

test("gerador: recusa dado interno, o mês e carga com falha ou ausente", () => {
  assert.throws(() => assertPublishable({ AUTH_MODE: "login" }, null), /dado interno/);
  assert.throws(() => assertPublishable({ MONTH_FILTER: "on" }, null), /mês/);
  assert.throws(() => assertPublishable({}, { updatedAt: null, warnings: [] }), /carga concluída/);
  assert.throws(() => assertPublishable({}, { updatedAt: "x", warnings: ["A última carga falhou. Os dados exibidos são da última carga concluída."] }), /falhou/);
  assert.doesNotThrow(() => assertPublishable({ AUTH_MODE: "local" }, { updatedAt: "x", warnings: [] }));
});

test("gerador: acima do limite, recusa", () => {
  assert.doesNotThrow(() => assertWithinLimits({ files: 10, bytes: 1024 }, { files: 10, bytes: 1024 }));
  assert.throws(() => assertWithinLimits({ files: 11, bytes: 10 }, { files: 10, bytes: 1024 }), /11 arquivos/);
  assert.throws(() => assertWithinLimits({ files: 1, bytes: 2 * 1024 * 1024 }, { files: 10, bytes: 1024 * 1024 }), /2\.0 MB/);
});

test("aviso de dado velho: vale no dia em que a pessoa abre", () => {
  const day = 86_400_000;
  const at = "2026-01-01T00:00:00.000Z";
  assert.equal(isStale(at, new Date(at).getTime() + 45 * day), false);
  assert.equal(isStale(at, new Date(at).getTime() + 46 * day), true);
  assert.equal(isStale(null, Date.now()), false);
});

test("varredura: a pasta limpa passa", () => {
  assert.deepEqual(scanSite(site), []);
});

test("varredura: reprova segredo, caminho, usuário, SQL, conexão, linha de origem e arquivo não previsto", () => {
  const user = userInfo().username;
  const cases: [string, string, string, RegExp][] = [
    ["segredo pelo valor", "assets/a.js", 'const k="valor-do-segredo-123"', /valor de segredo/],
    ["nome de variável de chave", "assets/a.js", "ANTHROPIC_API_KEY", /segredo/],
    ["chave", "assets/a.js", "sk-ant-abc", /segredo/],
    ["caminho do Windows", "assets/a.js", 'const a="C:\\\\Users\\\\alguem\\\\x"', /caminho local/],
    ["caminho do Linux", "assets/a.js", 'const a="/home/alguem/x"', /caminho local/],
    ["nome de usuário", "assets/a.js", `const a="${user}"`, /nome ou caminho da máquina/],
    ["SQL", "assets/a.js", 'const q="SELECT year FROM production"', /SQL/],
    ["coluna interna", "assets/a.js", "value_brl", /coluna ou tabela interna/],
    ["conexão", "assets/a.js", 'const c="postgres://u:s@servidor/banco"', /conexão de banco/],
    ["porta local", "assets/a.js", 'const c="http://127.0.0.1:8787"', /endereço da máquina/],
    ["rota de login", "assets/a.js", '"/api/login"', /rota de escrita/],
    ["rota do agente", "assets/a.js", '"/api/agent"', /rota de escrita/],
    ["botão do chat", "assets/a.js", '"Perguntar aos dados"', /chat ou login/],
    ["mapa de código", "assets/a.js", "//# sourceMappingURL=a.js.map", /mapa de código/],
    ["arquivo de banco", "dados/banco.sqlite", "x", /tipo de arquivo/],
    ["arquivo .env", ".env", "A=1", /tipo de arquivo/],
    ["mapa de código como arquivo", "assets/a.js.map", "{}", /tipo de arquivo/],
    ["linha bruta da fonte", "dados/detail/x.json", '{"rows":[{"year":2024,"variable":"215","raw":"..."}]}', /campo não previsto \(variable\)/],
    ["coluna a mais", "dados/summary/x.json", '{"value":"1.00","email":"a"}', /campo não previsto \(email\)/],
    ["rota que não existe no site", "dados/check/index.json", '{"rows":[]}', /pasta não prevista/],
    ["linha abaixo do menor agregado", "dados/detail/y.json", '{"rows":[{"year":2024,"state_name":"A","crop_name":"B"},{"year":2024,"state_name":"A","crop_name":"B"}]}', /abaixo do menor agregado/],
    ["script de fora", "index.html", '<script src="https://exemplo.org/a.js"></script>', /de fora do site/],
    ["JSON quebrado", "dados/summary/z.json", "{", /não é JSON/],
  ];
  for (const [name, file, text, expected] of cases) {
    const copy = mkdtempSync(path.join(dir, "copia-"));
    cpSync(path.join(site, MANIFEST_FILE), path.join(copy, MANIFEST_FILE), { recursive: true });
    mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    if (existsSync(path.join(copy, file))) appendFileSync(path.join(copy, file), text);
    else writeFileSync(path.join(copy, file), text);
    const findings = scanSite(copy, { secrets: ["valor-do-segredo-123"] });
    assert.ok(findings.some((finding) => expected.test(finding)), `${name}: ${findings.join("; ")}`);
    // O achado diz o arquivo e o tipo, sem repetir o valor.
    assert.ok(!findings.join().includes("valor-do-segredo-123"), name);
    rmSync(copy, { recursive: true, force: true });
  }
  const missing = mkdtempSync(path.join(dir, "vazia-"));
  writeFileSync(path.join(missing, "index.html"), "<!doctype html>");
  assert.ok(scanSite(missing).some((finding) => /índice ausente/.test(finding)));
  assert.equal(readFileSync(path.join(site, "index.html"), "utf8").includes("root"), true);
});
