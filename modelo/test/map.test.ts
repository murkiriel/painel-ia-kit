import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareOutlines, TARGET } from "../dashboards/producao-agricola/scripts/outlines.ts";
import { ALL_STATES } from "../dashboards/producao-agricola/domain/filters.ts";
import { clickableKey, colorScale, fillColor, insideRing, labelPoint, legendEntries, mapStyle, mixColors, placeLabels, shapesBounds, type LabelInput, type Shapes } from "../web/src/components/mapRules.ts";

const PRIMARY = "#1f63b0";
const SURFACE = "#fcfcfb";
const NEUTRAL = "#f3f4f6";
const NEGATIVE = "#c0392b";
const FILE = new URL("../dashboards/producao-agricola/web/ufs.geo.json", import.meta.url);
const shapes = JSON.parse(readFileSync(FILE, "utf8")) as Shapes & { source: Record<string, string> };

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

test("contornos: os códigos são iguais aos das 27 UFs do banco", () => {
  const codes = shapes.features.map((feature) => feature.properties.codarea);
  assert.deepEqual([...codes].sort(), [...ALL_STATES].sort());
  assert.equal(new Set(codes).size, 27);
});

test("contornos: cada UF tem sigla e nome, e o arquivo diz de onde veio", () => {
  for (const { properties } of shapes.features) {
    assert.match(properties.sigla, /^[A-Z]{2}$/);
    assert.ok(properties.nome.length > 3);
  }
  assert.equal(new Set(shapes.features.map((f) => f.properties.sigla)).size, 27);
  assert.equal(shapes.source.publisher, "IBGE");
  assert.match(shapes.source.outlines, /^https:\/\/servicodados\.ibge\.gov\.br\/api\/v3\/malhas\//);
  assert.match(shapes.source.downloadedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test("contornos: o arquivo é leve e enquadra o Brasil", () => {
  assert.ok(readFileSync(FILE).length < 150_000);
  const [[west, south], [east, north]] = shapesBounds(shapes);
  assert.ok(west > -75 && east < -28 && south > -35 && north < 6, `${west} ${east} ${south} ${north}`);
});

test("contornos: o ponto do rótulo fica dentro de cada área, mesmo em forma côncava", () => {
  for (const { properties, geometry } of shapes.features) {
    const point = labelPoint(geometry);
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    assert.ok(polygons.some((polygon) => insideRing(point, polygon[0])), properties.sigla);
  }
  const shapeOfU = { type: "Polygon" as const, coordinates: [[[0, 0], [10, 0], [10, 10], [8, 10], [8, 2], [2, 2], [2, 10], [0, 10], [0, 0]]] };
  assert.ok(insideRing(labelPoint(shapeOfU), shapeOfU.coordinates[0]));
});

test("carga dos contornos: arredonda, tira repetidos e guarda só o necessário", () => {
  const square = (code: string) => ({
    properties: { codarea: code, outro: "sai" },
    geometry: { type: "Polygon" as const, coordinates: [[[0.12344, 0.12344], [0.12341, 0.12341], [1, 0], [1, 1], [0, 1], [0.12344, 0.12344]]] },
  });
  const states = ALL_STATES.map((code) => ({ id: Number(code), sigla: "XX", nome: `UF ${code}` }));
  const text = prepareOutlines({ features: [...ALL_STATES].reverse().map(square) }, states, "2026-10-31");
  const result = JSON.parse(text);
  assert.equal(result.source.downloadedAt, "2026-10-31");
  assert.equal(result.features[0].properties.codarea, "11");
  assert.deepEqual(Object.keys(result.features[0].properties), ["codarea", "sigla", "nome"]);
  assert.deepEqual(result.features[0].geometry.coordinates[0][0], [0.123, 0.123]);
  assert.equal(result.features[0].geometry.coordinates[0].length, 5);
});

test("carga dos contornos: recusa o arquivo sem as 27 UFs, para nenhum estado sumir em silêncio", () => {
  const feature = (code: string) => ({ properties: { codarea: code }, geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const states = ALL_STATES.map((code) => ({ id: Number(code), sigla: "XX", nome: "UF" }));
  assert.throws(() => prepareOutlines({ features: ALL_STATES.slice(1).map(feature) }, states, "2026-10-31"), /27 UFs/);
  assert.throws(() => prepareOutlines({ features: [...ALL_STATES.slice(1), "99"].map(feature) }, states, "2026-10-31"), /27 UFs/);
  assert.throws(() => prepareOutlines({ features: ALL_STATES.map(feature) }, states.slice(1), "2026-10-31"), /sem nome/);
});

test("escala: vai do mais claro à cor principal, e cada faixa escurece", () => {
  const scale = colorScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], PRIMARY, SURFACE, NEGATIVE);
  assert.equal(scale.classes.length, 5);
  assert.equal(scale.classes.at(-1)!.color, PRIMARY);
  for (let i = 1; i < scale.classes.length; i++) assert.ok(luminance(scale.classes[i].color) < luminance(scale.classes[i - 1].color));
  assert.deepEqual(scale.classes.map((item) => item.upTo), [2, 4, 6, 8, 10]);
  assert.equal(scale.colorOf(2), scale.classes[0].color);
  assert.equal(scale.colorOf(2.5), scale.classes[1].color);
  assert.equal(scale.colorOf(10), PRIMARY);
});

test("escala: um só tom, misturando só a superfície e a cor principal", () => {
  const scale = colorScale([1, 2, 3, 4, 5], PRIMARY, SURFACE, NEGATIVE);
  for (const { color } of scale.classes) {
    // Na mistura em linha reta, a proporção é a mesma nos três canais.
    const shares = [1, 3, 5].map((start, i) => {
      const value = Number.parseInt(color.slice(start, start + 2), 16);
      const [from, to] = [[252, 252, 251][i], [31, 99, 176][i]];
      return (value - from) / (to - from);
    });
    assert.ok(Math.max(...shares) - Math.min(...shares) < 0.03, `${color}: ${shares}`);
  }
});

test("escala: sem dado não tem cor, e zero tem cor própria, distinta do neutro e das faixas", () => {
  const scale = colorScale([0, 10, 20, null], PRIMARY, SURFACE, NEGATIVE);
  assert.equal(scale.colorOf(null), null);
  assert.equal(scale.hasZero, true);
  assert.equal(scale.colorOf(0), scale.zeroColor);
  assert.ok(contrast(scale.zeroColor, NEUTRAL) >= 1.15, `contraste ${contrast(scale.zeroColor, NEUTRAL)}`);
  assert.notEqual(scale.colorOf(10), scale.zeroColor);
  assert.equal(colorScale([10, null], PRIMARY, SURFACE, NEGATIVE).hasZero, false);
});

test("escala: negativo tem a cor do tema, distinta de zero, das faixas e de sem dado, e não entra nas faixas", () => {
  const scale = colorScale([-643, 0, 10, 20, null], PRIMARY, SURFACE, NEGATIVE);
  assert.equal(scale.colorOf(-643), NEGATIVE);
  assert.equal(scale.negativeColor, NEGATIVE);
  assert.equal(scale.hasNegative, true);
  assert.equal(scale.hasZero, true);
  assert.notEqual(scale.colorOf(-643), scale.colorOf(0));
  assert.notEqual(scale.colorOf(-643), NEUTRAL);
  assert.ok(contrast(NEGATIVE, scale.zeroColor) >= 3, `contraste ${contrast(NEGATIVE, scale.zeroColor)}`);
  assert.ok(contrast(NEGATIVE, NEUTRAL) >= 3);
  for (const { color } of scale.classes) assert.notEqual(color, NEGATIVE);
  assert.deepEqual(scale.classes.map((item) => item.upTo), [10, 20]);
  // Só negativo não vira zero, e só zero não vira negativo.
  const onlyNegative = colorScale([-1, 5], PRIMARY, SURFACE, NEGATIVE);
  assert.equal(onlyNegative.hasZero, false);
  assert.equal(onlyNegative.hasNegative, true);
  assert.equal(colorScale([0, 5], PRIMARY, SURFACE, NEGATIVE).hasNegative, false);
  assert.throws(() => colorScale([1], PRIMARY, SURFACE, "var(--x)"), /#rrggbb/);
});

const money = (value: string | null) => `R$ ${value}`;

test("legenda: negativo, zero e sem dado só aparecem quando existem, cada um com a própria cor", () => {
  const full = legendEntries(colorScale([-1, 0, 10, 20], PRIMARY, SURFACE, NEGATIVE), money, true);
  assert.deepEqual(full.map((entry) => entry.label), ["Negativo", "R$ 0", "até R$ 10", "até R$ 20", "Sem dado"]);
  assert.equal(full[0].color, NEGATIVE);
  assert.equal(full.at(-1)!.color, null);
  assert.equal(new Set(full.map((entry) => entry.color)).size, full.length);
  assert.equal(new Set(full.map((entry) => entry.key)).size, full.length);
  assert.deepEqual(legendEntries(colorScale([10], PRIMARY, SURFACE, NEGATIVE), money, false).map((entry) => entry.label), ["até R$ 10"]);
  assert.deepEqual(legendEntries(colorScale([0, 10], PRIMARY, SURFACE, NEGATIVE), money, false).map((entry) => entry.label), ["R$ 0", "até R$ 10"]);
});

test("clique: só área com dado no recorte filtra", () => {
  const inScope = new Set(["41"]);
  assert.equal(clickableKey("41", inScope), "41");
  assert.equal(clickableKey("35", inScope), null);
  assert.equal(clickableKey(null, inScope), null);
});

test("escala: poucos valores, valor repetido e nenhum valor", () => {
  const one = colorScale([42], PRIMARY, SURFACE, NEGATIVE);
  assert.deepEqual(one.classes, [{ upTo: 42, color: PRIMARY }]);
  assert.equal(colorScale([5, 5, 5, 5, 5, 5], PRIMARY, SURFACE, NEGATIVE).classes.length, 1);
  assert.equal(colorScale([1, 2], PRIMARY, SURFACE, NEGATIVE).classes.length, 2);
  const none = colorScale([null, null], PRIMARY, SURFACE, NEGATIVE);
  assert.deepEqual(none.classes, []);
  assert.equal(none.colorOf(null), null);
  const zeros = colorScale([0, 0], PRIMARY, SURFACE, NEGATIVE);
  assert.deepEqual(zeros.classes, []);
  assert.equal(zeros.colorOf(0), zeros.zeroColor);
});

test("escala: recusa cor do tema que não consegue misturar, em vez de desenhar errado", () => {
  assert.throws(() => mixColors("var(--x)", PRIMARY, 0.5), /#rrggbb/);
  assert.equal(mixColors("#000000", "#ffffff", 0.5), "#808080");
});

test("expressão de cor: sem itens, tudo fica neutro, porque o match vazio é inválido", () => {
  assert.equal(fillColor("id", [], NEUTRAL), NEUTRAL);
  assert.deepEqual(fillColor("id", [["11", PRIMARY]], NEUTRAL), ["match", ["get", "id"], "11", PRIMARY, NEUTRAL]);
});

test("estilo: nada é pedido à rede, nem tiles, nem glyphs, nem sprite", () => {
  const style = mapStyle(shapes, { neutral: NEUTRAL, outline: "#5b6570", selected: "#22262b" });
  assert.equal(style.glyphs, undefined);
  assert.equal(style.sprite, undefined);
  for (const source of Object.values(style.sources)) {
    assert.equal(source.type, "geojson");
    assert.equal(typeof (source as { data: unknown }).data, "object");
  }
  const { sources: _sources, ...withoutData } = style;
  assert.doesNotMatch(JSON.stringify(withoutData), /https?:|mapbox:/);
  assert.ok(style.layers.every((layer) => layer.type !== "symbol"));
});

const label = (key: string, x: number, y: number, size = 40): LabelInput => ({
  key, x, y, width: 80, height: 16, shortWidth: 24, shape: { left: x - size, right: x + size, top: y - size, bottom: y + size },
});
const rect = (place: { x: number; y: number }, item: LabelInput, short: boolean) => {
  const width = short ? item.shortWidth : item.width;
  return { left: place.x - width / 2, right: place.x + width / 2, top: place.y - item.height / 2, bottom: place.y + item.height / 2 };
};

test("rótulos: ficam no centro quando cabem", () => {
  const places = placeLabels([label("a", 100, 100), label("b", 300, 300)], null, 640, 640);
  assert.deepEqual(places.map((p) => [p.key, p.x, p.y, p.short, p.leader]), [["a", 100, 100, false, null], ["b", 300, 300, false, null]]);
});

test("rótulos: nunca se sobrepõem nem saem do mapa, com a área pequena ligada por uma linha", () => {
  const items = [label("grande", 320, 320, 200), label("a", 330, 320, 5), label("b", 340, 325, 5), label("c", 350, 330, 5), label("borda", 630, 320, 5)];
  const places = placeLabels(items, null, 640, 640);
  assert.equal(places.length, items.length);
  const boxes = places.map((p) => rect(p, items.find((item) => item.key === p.key)!, p.short));
  for (const [i, a] of boxes.entries()) {
    assert.ok(a.left >= 0 && a.right <= 640 && a.top >= 0 && a.bottom <= 640, places[i].key);
    for (const b of boxes.slice(i + 1)) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  }
  assert.ok(places.some((p) => p.leader !== null));
});

test("rótulos: o selecionado escolhe primeiro, mesmo sendo o menor", () => {
  const items = [label("grande", 320, 320, 200), label("pequeno", 320, 322, 5)];
  const places = placeLabels(items, "pequeno", 640, 640);
  assert.equal(places[0].key, "pequeno");
  assert.equal(places.length, 2);
  // O valor do selecionado aparece mesmo em mapa estreito, cheio de vizinhos.
  const crowded = Array.from({ length: 8 }, (_, i) => label(String(i), 60 + i * 30, 100, 6));
  const chosen = placeLabels(crowded, "3", 340, 340).find((p) => p.key === "3")!;
  assert.equal(chosen.short, false);
  assert.equal(chosen.leader, null);
});

test("rótulos: selecionar não move nenhum outro, e o clique não desloca o que está sob o mouse", () => {
  const crowded = Array.from({ length: 8 }, (_, i) => label(String(i), 60 + i * 30, 100, 6));
  const roomy = [label("grande", 320, 320, 200), label("a", 330, 320, 5), label("b", 340, 325, 5), label("c", 350, 330, 5), label("borda", 630, 320, 5)];
  for (const [items, width] of [[crowded, 340], [roomy, 640]] as const) {
    const base = new Map(placeLabels([...items], null, width, width).map((place) => [place.key, place]));
    for (const { key } of items) {
      const places = placeLabels([...items], key, width, width);
      for (const place of places) {
        if (place.key === key) continue;
        assert.deepEqual([place.x, place.y], [base.get(place.key)!.x, base.get(place.key)!.y], `${key} moveu ${place.key}`);
        // Pode ficar só com o nome, para dar lugar ao valor do selecionado, nunca o contrário.
        assert.ok(place.short || !base.get(place.key)!.short, `${key} aumentou ${place.key}`);
      }
      // Quem já mostrava o valor também fica onde estava.
      const before = base.get(key);
      if (before && !before.short) assert.deepEqual(places.find((place) => place.key === key), before);
      // E continuam sem se sobrepor.
      const boxes = places.map((p) => rect(p, items.find((item) => item.key === p.key)!, p.short));
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${key}: sobreposição`);
    }
  }
});

test("rótulos: não cobrem a própria área pequena, para o destaque ficar à vista", () => {
  const small = label("pequeno", 320, 320, 5);
  const [place] = placeLabels([small], "pequeno", 640, 640);
  const box = rect(place, small, false);
  assert.ok(box.right <= small.shape.left || box.left >= small.shape.right || box.bottom <= small.shape.top || box.top >= small.shape.bottom, JSON.stringify(box));
  assert.notEqual(place.leader, null);
});

test("rótulos: em mapa estreito, nenhum sai da própria área: fica só o nome, ou sai, e o valor continua na dica", () => {
  const items = Array.from({ length: 8 }, (_, i) => label(String(i), 60 + i * 30, 100, 6));
  const places = placeLabels(items, null, 340, 340);
  assert.ok(places.every((p) => p.leader === null));
  assert.ok(places.some((p) => p.short));
});

test("componentes do mapa: sem cor solta no código", () => {
  for (const name of ["MapBlock.tsx", "MapCanvas.tsx", "mapRules.ts"]) {
    const text = readFileSync(new URL(`../web/src/components/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, name);
  }
});

test("componentes do mapa: o MapLibre só entra no pedaço separado", () => {
  for (const name of ["web/src/components/MapBlock.tsx", "dashboards/producao-agricola/web/Dashboard.tsx"]) {
    const text = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /^import (?!type ).*(maplibre-gl|MapCanvas|ufs\.geo)/m, name);
  }
  assert.match(readFileSync(new URL("../web/src/components/MapBlock.tsx", import.meta.url), "utf8"), /lazy\(\(\) => import\("\.\/MapCanvas\.tsx"\)\)/);
});

test("contornos: o script grava o mesmo arquivo que a tela importa, sem rede", () => {
  const screen = new URL("../dashboards/producao-agricola/web/Dashboard.tsx", import.meta.url);
  const imported = readFileSync(screen, "utf8").match(/import\("(\.\/[^"]*ufs\.geo\.json)"\)/);
  assert.ok(imported, "a tela importa o arquivo dos contornos");
  const used = resolve(dirname(fileURLToPath(screen)), imported[1]);
  assert.equal(resolve(TARGET), used);
  assert.equal(resolve(TARGET), resolve(fileURLToPath(FILE)));
  assert.ok(existsSync(TARGET), "o destino do script é um arquivo que existe");
});
