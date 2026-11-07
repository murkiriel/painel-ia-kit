// Compara o Postgres e o SQLite resposta a resposta, em cada dashboard que tem essa prova.
// A prova de cada um fica na pasta dele (dashboards/<slug>/scripts/compare-engines.ts); este arquivo só a chama.
//
//   npm run check:engines                 todos os dashboards que têm a prova
//   npm run check:engines -- <slug>       um só
//   npm run check:engines -- --sabotar    muda 1 centavo no SQLite: precisa reprovar
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["scripts/dash.ts", "compare-engines", ...process.argv.slice(2)], { windowsHide: true, stdio: "inherit" });
process.exit(result.status ?? 1);
