// O recorte de acesso de um dashboard, que é opcional e tem nome próprio: a regra de permissão, os textos, a validação ao subir
// e a leitura dos acessos do create-user. Sem banco, rede nem servidor.
import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionNote } from "../server/agent/agent.ts";
import { grantedScope } from "../server/auth.ts";
import { validateDashboards, type Dashboard } from "../server/dashboard.ts";
import { allOf, atLeastOne, countOf, groupOf, invalidItem, noneOf, onlyThese, others, these, type DashboardScope, type ScopeLabel } from "../shared/scope.ts";
import { parseAccessArgs } from "../scripts/lib/access-args.ts";
import { exemploA, exemploB, exemploC, exemploD } from "./fixtures/dashboards.ts";

const FARM: ScopeLabel = { singular: "fazenda", plural: "fazendas", gender: "f" };
const PLOT: ScopeLabel = { singular: "talhão", plural: "talhões", gender: "m" };
const THREE: DashboardScope = { label: FARM, items: [{ code: "A1", name: "Alfa" }, { code: "A2", name: "Beta" }, { code: "A3", name: "Gama" }] };

// ---------------------------------------------------------------------------------------------------------------------
// grantedScope: a única regra de permissão

test("sem recorte: só o acesso total vale, e a lista é sempre vazia", () => {
  assert.deepEqual(grantedScope({}, { full: true, codes: [] }), []);
  assert.deepEqual(grantedScope({}, { full: true, codes: ["X"] }), [], "a lista guardada não passa para a consulta");
  assert.equal(grantedScope({}, { full: false, codes: ["X"] }), null, "linha parcial antiga: o dashboard não existe para a pessoa");
  assert.equal(grantedScope({}, { full: false, codes: [] }), null);
  assert.equal(grantedScope({}, undefined), null, "sem linha de acesso");
});

test("com recorte: o acesso total dá todos os itens; o parcial sai sem repetidos e só com os conhecidos", () => {
  const d = { scope: THREE };
  assert.deepEqual(grantedScope(d, { full: true, codes: [] }), ["A1", "A2", "A3"]);
  assert.deepEqual(grantedScope(d, { full: false, codes: ["A1", "A1", "ZZ"] }), ["A1"]);
  assert.deepEqual(grantedScope(d, { full: false, codes: ["A3", "A1"] }), ["A3", "A1"]);
  assert.equal(grantedScope(d, undefined), null);
});

test("com recorte: a lista parcial vazia dá [] e nunca todos os itens", () => {
  const d = { scope: THREE };
  assert.deepEqual(grantedScope(d, { full: false, codes: [] }), []);
  assert.deepEqual(grantedScope(d, { full: false, codes: ["ZZ"] }), []);
});

test("com recorte: o mesmo código repetido tantas vezes quantos são os itens não é acesso total", () => {
  const scope = grantedScope({ scope: THREE }, { full: false, codes: ["A1", "A1", "A1"] });
  assert.deepEqual(scope, ["A1"]);
  assert.notEqual(scope!.length, THREE.items.length);
});

// ---------------------------------------------------------------------------------------------------------------------
// Textos: concordam com o gênero do nome do recorte

test("textos no feminino", () => {
  assert.equal(allOf(FARM), "Todas as fazendas");
  assert.equal(onlyThese(FARM), "Só estas fazendas");
  assert.equal(these(FARM), "estas fazendas");
  assert.equal(atLeastOne(FARM), "Escolha ao menos uma fazenda.");
  assert.equal(invalidItem(FARM), "Fazenda inválida.");
  assert.equal(noneOf(FARM), "nenhuma");
  assert.equal(others(FARM), "outras");
  assert.equal(groupOf(FARM, "Exemplo"), "Fazendas de Exemplo");
});

test("textos no masculino", () => {
  assert.equal(allOf(PLOT), "Todos os talhões");
  assert.equal(onlyThese(PLOT), "Só estes talhões");
  assert.equal(these(PLOT), "estes talhões");
  assert.equal(atLeastOne(PLOT), "Escolha ao menos um talhão.");
  assert.equal(invalidItem(PLOT), "Talhão inválido.");
  assert.equal(noneOf(PLOT), "nenhum");
  assert.equal(others(PLOT), "outros");
  assert.equal(groupOf(PLOT, "Exemplo"), "Talhões de Exemplo");
});

test("textos: sigla e contagem", () => {
  const uf: ScopeLabel = { singular: "UF", plural: "UFs", gender: "f" };
  assert.equal(allOf(uf), "Todas as UFs");
  assert.equal(invalidItem(uf), "UF inválida.");
  assert.equal(countOf(uf, 1), "1 UF");
  assert.equal(countOf(uf, 2), "2 UFs");
  assert.equal(countOf(PLOT, 0), "0 talhões");
});

// ---------------------------------------------------------------------------------------------------------------------
// validateDashboards: o servidor não sobe com o recorte mal descrito

test("validateDashboards: os dashboards de exemplo passam, com e sem recorte", () => {
  validateDashboards([exemploA, exemploB, exemploC, exemploD]);
  assert.equal(exemploD.scope, undefined);
});

test("validateDashboards: reprova o states antigo, dizendo o que trocar", () => {
  const old = { ...exemploA, states: [{ code: "A1", name: "Alfa" }] } as Dashboard;
  assert.throws(() => validateDashboards([old]), /exemplo-a.*"states".*scope/);
  // Também sem recorte novo: o states sozinho não vale.
  const bare = { ...exemploD, states: [{ code: "D1", name: "x" }] } as Dashboard;
  assert.throws(() => validateDashboards([bare]), /exemplo-d.*"states"/);
});

test("validateDashboards: reprova recorte sem itens, com código repetido ou vazio, e nome do recorte incompleto", () => {
  const withScope = (scope: unknown) => ({ ...exemploA, scope }) as Dashboard;
  assert.throws(() => validateDashboards([withScope({ label: FARM, items: [] })]), /não tem itens/);
  assert.throws(() => validateDashboards([withScope({ label: FARM, items: [{ code: "A1", name: "a" }, { code: "A1", name: "b" }] })]), /repete o código A1/);
  assert.throws(() => validateDashboards([withScope({ label: FARM, items: [{ code: "", name: "a" }] })]), /sem código/);
  assert.throws(() => validateDashboards([withScope({ label: { ...FARM, singular: "" }, items: THREE.items })]), /singular, plural e gênero/);
  assert.throws(() => validateDashboards([withScope({ label: { ...FARM, plural: "  " }, items: THREE.items })]), /singular, plural e gênero/);
  assert.throws(() => validateDashboards([withScope({ label: { ...FARM, gender: "x" }, items: THREE.items })]), /singular, plural e gênero/);
  assert.throws(() => validateDashboards([withScope({ items: THREE.items })]), /singular, plural e gênero/);
});

// ---------------------------------------------------------------------------------------------------------------------
// A nota de permissão do agente

test("permissionNote: vazia sem recorte ou com tudo permitido; com o nome do recorte e os nomes nos outros casos", () => {
  assert.equal(permissionNote(undefined, []), "");
  assert.equal(permissionNote(undefined, ["Alfa"]), "");
  assert.equal(permissionNote(THREE, ["Alfa", "Beta", "Gama"]), "");
  assert.match(permissionNote(THREE, ["Alfa"]), /só pode ver estas fazendas: Alfa\. Nunca ofereça, sugira nem cite outras/);
  assert.match(permissionNote(THREE, []), /estas fazendas: nenhuma\./);
  const plots: DashboardScope = { label: PLOT, items: [{ code: "1", name: "Norte" }, { code: "2", name: "Sul" }] };
  assert.match(permissionNote(plots, ["Norte"]), /estes talhões: Norte\. Nunca ofereça, sugira nem cite outros/);
  assert.match(permissionNote(plots, []), /estes talhões: nenhum\./);
});

// ---------------------------------------------------------------------------------------------------------------------
// create-user: leitura dos acessos

const dashboards = [{ slug: "com-recorte", scope: THREE }, { slug: "sem-recorte" }];

test("create-user: dashboard sem recorte aceita o nome puro, :todas e :todos", () => {
  for (const item of ["sem-recorte", "sem-recorte:todas", "sem-recorte:todos"]) {
    assert.deepEqual(parseAccessArgs(dashboards, [item]), { grants: [{ slug: "sem-recorte", full: true, codes: [] }] }, item);
  }
  assert.match((parseAccessArgs(dashboards, ["sem-recorte:A1"]) as { error: string }).error, /não tem recorte/);
});

test("create-user: dashboard com recorte aceita :todas, :todos e a lista, mas não o nome puro", () => {
  for (const item of ["com-recorte:todas", "com-recorte:todos"]) {
    assert.deepEqual(parseAccessArgs(dashboards, [item]), { grants: [{ slug: "com-recorte", full: true, codes: [] }] }, item);
  }
  assert.deepEqual(parseAccessArgs(dashboards, ["com-recorte:A3,A1"]), { grants: [{ slug: "com-recorte", full: false, codes: ["A1", "A3"] }] });
  assert.match((parseAccessArgs(dashboards, ["com-recorte"]) as { error: string }).error, /tem recorte: use com-recorte:todas/);
});

test("create-user: tira os repetidos, e a lista de um item repetido não vira total", () => {
  assert.deepEqual(parseAccessArgs(dashboards, ["com-recorte:A1,A1,A1"]), { grants: [{ slug: "com-recorte", full: false, codes: ["A1"] }] });
});

test("create-user: mensagens pelo nome do recorte, e dashboard desconhecido ou repetido", () => {
  assert.match((parseAccessArgs(dashboards, ["com-recorte:"]) as { error: string }).error, /Escolha ao menos uma fazenda\./);
  assert.match((parseAccessArgs(dashboards, ["com-recorte:A1,ZZ"]) as { error: string }).error, /Fazenda inválida\. \(ZZ\)/);
  assert.match((parseAccessArgs(dashboards, ["outro"]) as { error: string }).error, /Dashboard desconhecido: outro/);
  assert.match((parseAccessArgs(dashboards, ["sem-recorte", "sem-recorte"]) as { error: string }).error, /repetido/);
  const plots = [{ slug: "t", scope: { label: PLOT, items: [{ code: "1", name: "Norte" }] } }];
  assert.match((parseAccessArgs(plots, ["t:9"]) as { error: string }).error, /Talhão inválido\./);
  assert.match((parseAccessArgs(plots, ["t:"]) as { error: string }).error, /Escolha ao menos um talhão\./);
});
