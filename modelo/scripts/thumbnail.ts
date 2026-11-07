// Tira a foto real da tela de cada dashboard, para o cartão do portal. Roda depois de cada carga (npm run load) ou à mão:
//
//   npm run thumbnail                 todos os dashboards
//   npm run thumbnail -- <slug>       um só
//
// Usa o Edge (ou outro navegador baseado em Chromium) já instalado na máquina, em modo headless, sem instalar nada:
// `msedge --headless --screenshot`. Sem navegador, o cartão fica sem imagem, e o script avisa.
// A foto mostra dados, então fica em .data/thumbs (ignorada pelo git) e só é servida a quem tem acesso àquele dashboard.
//
// Como o navegador não faz login, o script sobe, por alguns segundos, um servidor só desta máquina (127.0.0.1, porta sorteada)
// em modo local, com o mesmo banco, e tira a foto dele. Esse servidor não existe fora desta execução.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DASHBOARDS } from "../server/dashboards.ts";
import { dataDir } from "../server/db/open.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const WIDTH = 1366;
const HEIGHT = 720;
const WAIT_MS = 30_000;

const candidates = () => [
  process.env.BROWSER_EXE ?? "",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/microsoft-edge",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((file) => file !== "" && existsSync(file));

const slugs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const wanted = slugs.length ? DASHBOARDS.filter((d) => slugs.includes(d.slug)) : DASHBOARDS;
const unknown = slugs.filter((slug) => !DASHBOARDS.some((d) => d.slug === slug));
if (unknown.length) {
  console.error(`Dashboard desconhecido: ${unknown.join(", ")}.`);
  process.exit(1);
}

const browser = candidates()[0];
if (!browser) {
  console.warn("Miniatura: nenhum navegador baseado em Chromium foi encontrado nesta máquina, e os cartões ficam sem imagem. Aponte BROWSER_EXE para o Edge ou o Chrome.");
  process.exit(0);
}

const thumbs = path.resolve(dataDir(), "thumbs");
mkdirSync(thumbs, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), "dash-thumb-"));

// O servidor temporário: modo local, só nesta máquina, sem agente.
const server = spawn(process.execPath, ["server/main.ts"], { windowsHide: true,
  env: { ...process.env, AUTH_MODE: "local", HOST: "127.0.0.1", PORT: "0", AGENT_PROVIDER: "", COOKIE_SECURE: "false" },
  stdio: ["ignore", "pipe", "inherit"],
});
const stop = () => {
  server.kill();
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
};
process.on("exit", stop);

const base = await new Promise<string>((resolve, reject) => {
  let text = "";
  const timer = setTimeout(() => reject(new Error("O servidor temporário não subiu.")), WAIT_MS);
  server.stdout!.on("data", (chunk) => {
    text += chunk;
    const found = /http:\/\/127\.0\.0\.1:\d+/.exec(text);
    if (found) {
      clearTimeout(timer);
      resolve(found[0]);
    }
  });
  server.once("exit", (code) => reject(new Error(`O servidor temporário parou (${code}).`)));
}).catch((error) => {
  console.warn(`Miniatura: ${error.message} Os cartões ficam como estavam.`);
  stop();
  process.exit(0);
});

let failed = 0;
for (const dashboard of wanted) {
  const temporary = path.join(work, `${dashboard.slug}.png`);
  // #miniatura: a tela esconde o botão do agente. Fica no fragmento para nunca virar filtro na API.
  const result = spawnSync(browser, [
    "--headless=new",
    `--screenshot=${temporary}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-extensions",
    "--disable-sync",
    `--user-data-dir=${path.join(work, "perfil")}`,
    // Sem placa de vídeo, o mapa usa o desenho por software.
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--virtual-time-budget=20000",
    `${base}/d/${dashboard.slug}#miniatura`,
  ], { windowsHide: true, encoding: "utf8", timeout: WAIT_MS * 2 });
  if (!existsSync(temporary) || statSync(temporary).size < 5_000) {
    console.warn(`Miniatura de ${dashboard.slug}: o navegador não gerou a imagem${result.error ? ` (${result.error.message})` : ""}. O cartão fica como estava.`);
    failed++;
    continue;
  }
  // A foto nova só entra inteira: o cartão nunca vê uma imagem pela metade.
  renameSync(temporary, path.join(thumbs, `${dashboard.slug}.png`));
  console.log(`Miniatura de ${dashboard.slug}: ${Math.round(statSync(path.join(thumbs, `${dashboard.slug}.png`)).size / 1024)} KB.`);
}
stop();
process.exit(failed === 0 ? 0 : 1);
