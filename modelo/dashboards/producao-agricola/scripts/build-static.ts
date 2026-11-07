// Gera o site estático: a mesma tela, com cada resposta pré-calculada pelas consultas do modelo, em uma pasta ignorada pelo git.
// Só para dado público. Todo arquivo gerado pode ser baixado por qualquer pessoa. Não publica nada.
import { existsSync, mkdirSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { openReader, readEngine } from "../../../server/db/open.ts";
import { DB } from "../db.ts";
import { ALL_STATES } from "../domain/filters.ts";
import { createQueries } from "../domain/queries.ts";
import { createDataRoutes } from "../domain/routes.ts";
import { DATA_DIR, fileOf, MANIFEST_FILE, type SiteRoute } from "../shared/staticSite.ts";
import { assertPublishable, assertWithinLimits, checkOutputFolder, measureSite, readManifest, scanSite, walkSite, WORK_MARK, type Call, siteFingerprint } from "./static-tools.ts";

const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--pasta="))?.slice("--pasta=".length) ?? "dist-static");
const WORK_DIR = `${OUT_DIR}.tmp`;
// Antes de tudo: as duas são apagadas mais adiante.
const PROJECT = process.cwd();
try {
  checkOutputFolder(OUT_DIR, PROJECT);
  checkOutputFolder(WORK_DIR, PROJECT, { workMark: true });
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
// Limite: acima disso, o gerador recusa, e o site anterior continua como estava.
const MAX_MEGABYTES = Number(process.env.STATIC_MAX_MB || 200);
const MAX_FILES = Number(process.env.STATIC_MAX_FILES || 100_000);
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

console.log("Site estático: só para dado público. Todo arquivo gerado pode ser baixado por qualquer pessoa, mesmo que nenhuma tela o mostre.");
console.log("Dado interno exige servidor com login. O gerador usa o acesso total aos dados públicos do exemplo, sem nenhuma permissão limitada.\n");
assertPublishable(process.env, null);

const reader = await openReader(DB);
const { routes } = createDataRoutes(createQueries(reader), false);
// Acesso total: é o dado público inteiro, e nunca o recorte de um usuário.
const call: Call = async (route, query) => JSON.stringify(await routes[route](new URLSearchParams(query), ALL_STATES));

const started = Date.now();
const generatedAt = new Date().toISOString();
const manifest = await readManifest(call, generatedAt);
assertPublishable(process.env, { updatedAt: manifest.updatedAt, warnings: JSON.parse(await call("summary", "")).warnings });
console.log(`Banco: ${readEngine(process.env.DB_ENGINE)}. Carga de ${manifest.updatedAt}. Gerando em ${WORK_DIR}...`);

rmSync(WORK_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
mkdirSync(WORK_DIR, { recursive: true });
writeFileSync(path.join(WORK_DIR, WORK_MARK), "");
// A tela do site leva só este dashboard: veja vite.config.ts.
process.env.STATIC_DASHBOARD = DB.slug;
await build({ mode: "static", logLevel: "error", build: { outDir: WORK_DIR, emptyOutDir: false } });

const folders = new Set<string>();
const counts: Record<string, { files: number; bytes: number }> = {};
const emit = async (route: SiteRoute, query: string, text: string) => {
  const file = path.join(WORK_DIR, fileOf(route, query));
  const folder = path.dirname(file);
  if (!folders.has(folder)) {
    mkdirSync(folder, { recursive: true });
    folders.add(folder);
  }
  await writeFile(file, text);
  const count = (counts[route] ??= { files: 0, bytes: 0 });
  count.files++;
  count.bytes += Buffer.byteLength(text);
};
await walkSite(manifest, call, emit);

// A carga não pode ter mudado no meio: todos os arquivos precisam ser da mesma.
const after = JSON.parse(await call("summary", ""));
if (after.updatedAt !== manifest.updatedAt) throw new Error("Uma carga terminou durante a geração. Nada foi publicado: gere de novo.");
await reader.end();

rmSync(path.join(WORK_DIR, WORK_MARK));
const measured = measureSite(WORK_DIR);
manifest.files = measured.files + 1;
manifest.bytes = measured.bytes;
manifest.filesHash = siteFingerprint(WORK_DIR);
const text = JSON.stringify(manifest);
writeFileSync(path.join(WORK_DIR, MANIFEST_FILE), text);
const total = { files: measured.files + 1, bytes: measured.bytes + Buffer.byteLength(text) };

const fail = (message: string): never => {
  rmSync(WORK_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  throw new Error(`${message} O site anterior continua como estava.`);
};
try {
  assertWithinLimits(total, { files: MAX_FILES, bytes: MAX_MEGABYTES * 1024 * 1024 });
} catch (error) {
  fail((error as Error).message);
}

// Valores do .env nunca saem. A varredura diz o arquivo e o tipo, sem repetir o valor.
const secrets = Object.entries(process.env).flatMap(([name, value]) => (/PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL/.test(name) && value ? [value] : []));
const findings = scanSite(WORK_DIR, { secrets });
if (findings.length > 0) {
  for (const finding of findings.slice(0, 30)) console.error(finding);
  fail(`A varredura reprovou o site, com ${findings.length} achados.`);
}

// De novo, porque a geração leva minutos.
checkOutputFolder(OUT_DIR, PROJECT);
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
renameSync(WORK_DIR, OUT_DIR);

console.log(`\nSite gerado em ${OUT_DIR}, em ${Math.round((Date.now() - started) / 1000)} s: ${total.files} arquivos, ${megabytes(total.bytes)} MB. Limite: ${MAX_FILES} arquivos e ${MAX_MEGABYTES} MB.`);
console.log("Por rota:");
for (const [route, count] of Object.entries(counts)) console.log(`  ${DATA_DIR}/${route}: ${count.files} arquivos, ${megabytes(count.bytes)} MB`);
console.log("\nFicou de fora, e a tela avisa ou desliga o controle:");
console.log("  - UF combinada com lavoura, como filtro. O valor de cada UF em uma lavoura está no mapa, no gráfico por UF e no detalhe.");
console.log("  - Outra ordem da tabela com lavoura e região juntas: ela fica na ordem por valor.");
console.log("  - Em outra ordem, as páginas depois da primeira: todas as páginas ficam na ordem por valor, do maior para o menor.");
console.log("  - Conferência, agente e login: não existem neste site.");
console.log("\nNão foi publicado em lugar nenhum. Para provar: com o servidor no ar, npm run check:static.");
