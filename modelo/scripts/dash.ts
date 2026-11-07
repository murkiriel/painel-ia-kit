// Roda um comando de um dashboard, ou de todos. Cada dashboard guarda os seus em dashboards/<slug>/scripts.
//
//   node scripts/dash.ts <comando> [slug] [argumentos...]
//
// Sem slug, roda em todos os dashboards que têm o comando. "load" é a carga (dashboards/<slug>/load/run.ts) e,
// ao terminar bem, tira a miniatura do cartão (scripts/thumbnail.ts). Sai com erro se algum comando sair com erro.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const [command, ...rest] = process.argv.slice(2);
const all = existsSync("dashboards") ? readdirSync("dashboards", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
const slug = all.includes(rest[0]) ? rest[0] : null;
const args = slug ? rest.slice(1) : rest;

if (!command || command.startsWith("-")) {
  console.error("Uso: node scripts/dash.ts <comando> [slug] [argumentos]. Dashboards:", all.join(", "));
  process.exit(1);
}

const fileOf = (dashboard: string) => (command === "load" ? `dashboards/${dashboard}/load/run.ts` : `dashboards/${dashboard}/scripts/${command}.ts`);
const targets = (slug ? [slug] : all).filter((dashboard) => existsSync(fileOf(dashboard)));
if (targets.length === 0) {
  console.error(slug ? `O dashboard ${slug} não tem o comando "${command}".` : `Nenhum dashboard tem o comando "${command}".`);
  process.exit(1);
}

const node = (file: string, extra: string[] = []) =>
  spawnSync(process.execPath, ["--env-file-if-exists=.env", file, ...extra], { windowsHide: true, stdio: "inherit" }).status ?? 1;

let failed = false;
for (const dashboard of targets) {
  console.log(`\n== ${dashboard}: ${command}`);
  if (node(fileOf(dashboard), args) !== 0) {
    failed = true;
    continue;
  }
  // A foto do cartão depende de a carga ter dado certo. Falta de navegador não reprova a carga.
  if (command === "load" && node("scripts/thumbnail.ts", [dashboard]) !== 0) console.warn(`A miniatura de ${dashboard} não foi atualizada.`);
}
process.exit(failed ? 1 : 0);
