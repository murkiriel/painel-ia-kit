// O login, o primeiro acesso, a troca de senha, o título da página e as mensagens do servidor são do projeto: usam o nome do projeto
// e nunca o de um dashboard. O nome de um dashboard só aparece dentro dele (e no cartão dele, no painel).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DASHBOARDS } from "../server/dashboards.ts";
import { PROJECT_NAME } from "../web/src/project.ts";

/** Telas e textos que são do projeto. O painel lista os cartões e a administração lista os dashboards por dado, vindo da API, nunca escrito no código. */
const PROJECT_FILES = [
  "index.html",
  "web/src/main.tsx",
  "web/src/project.ts",
  "web/src/portal/Entry.tsx",
  "web/src/portal/Portal.tsx",
  "web/src/portal/Admin.tsx",
  "server/app.ts",
  "server/auth.ts",
  "server/admin.ts",
  "server/main.ts",
  ...readdirSync("server/sql").filter((name) => name.includes("portal")).map((name) => `server/sql/${name}`),
];

/** O que identifica um dashboard: nome do cartão, endereço e a fonte. */
const identifiers = () => DASHBOARDS.flatMap((dashboard) => [dashboard.card.name, dashboard.slug, dashboard.slug.replaceAll("-", "_"), dashboard.card.source]);

/** Tudo o que no texto cita um dashboard. */
export const dashboardNamesIn = (text: string, names: string[]) => names.filter((name) => text.toLowerCase().includes(name.toLowerCase()));

test("o projeto tem um nome, e ele é o do login e da aba", () => {
  assert.ok(PROJECT_NAME.length > 0);
  assert.ok(!identifiers().some((name) => name.toLowerCase() === PROJECT_NAME.toLowerCase()), "o nome do projeto não pode ser o de um dashboard");
  assert.match(readFileSync("index.html", "utf8"), new RegExp(`<title>${PROJECT_NAME}</title>`));
  const entry = readFileSync("web/src/portal/Entry.tsx", "utf8");
  assert.ok(entry.includes("PROJECT_NAME"), "o login usa o nome do projeto");
});

test("nenhuma tela nem mensagem do projeto cita o nome de um dashboard", () => {
  const names = identifiers();
  assert.ok(names.length >= 4);
  for (const file of PROJECT_FILES) {
    assert.deepEqual(dashboardNamesIn(readFileSync(file, "utf8"), names), [], file);
  }
});

test("a varredura pega de verdade: um nome de dashboard em tela do projeto reprova", () => {
  const names = identifiers();
  assert.notDeepEqual(dashboardNamesIn(`<h1>${DASHBOARDS[0].card.name}</h1>`, names), []);
  assert.notDeepEqual(dashboardNamesIn(`<title>${DASHBOARDS[0].slug}</title>`, names), []);
  assert.deepEqual(dashboardNamesIn(`<h1>${PROJECT_NAME}</h1>`, names), []);
});

/** O portal não sabe o que é UF: o recorte de cada dashboard tem nome próprio (UF, fazenda, talhão...), e o texto vem do rótulo dele. */
const SCOPE_FREE_FILES = [
  "server/app.ts",
  "server/auth.ts",
  "server/admin.ts",
  "server/agent/agent.ts",
  "web/src/portal/Admin.tsx",
  ...readdirSync("server/sql").filter((name) => name.includes("portal")).map((name) => `server/sql/${name}`),
];

/** As ocorrências da palavra "UF" (ou "UFs"), sem pegar "UFRJ" nem texto maior. */
export const ufIn = (text: string) => text.match(/\bUFs?\b/g) ?? [];

test("o portal e o agente não falam de UF: o nome do recorte vem do rótulo de cada dashboard", () => {
  for (const file of SCOPE_FREE_FILES) {
    assert.deepEqual(ufIn(readFileSync(file, "utf8")), [], file);
  }
});

test("a varredura de UF pega de verdade: a palavra em tela, servidor ou SQL do portal reprova", () => {
  assert.notDeepEqual(ufIn("<button>Dashboards e UFs</button>"), []);
  assert.notDeepEqual(ufIn('throw new BadRequest("UF inválida.");'), []);
  assert.notDeepEqual(ufIn("-- Lista de UF, em JSON."), []);
  assert.deepEqual(ufIn("<button>Dashboards e acessos</button>"), []);
  assert.deepEqual(ufIn("buffer, ufo e UFRJ"), []);
});
