// Regras do mapa, sem React nem MapLibre, para testar sem navegador.
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

type Position = number[];
export type ShapeGeometry = { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };
export type Shapes = { type: "FeatureCollection"; features: { type: "Feature"; properties: Record<string, string>; geometry: ShapeGeometry }[] };

export type Rect = { left: number; top: number; right: number; bottom: number };

// A cor mais clara da escala é zero. Mais claro que isto se confundiria com "sem dado".
const ZERO_SHARE = 0.2;
export const FADED_OPACITY = 0.4;
const SOURCE = "shapes";
export const LAYERS = { fill: "shapes-fill", line: "shapes-line", selected: "shapes-selected" };
// Filtro que não deixa passar nada: sem seleção, não há contorno em destaque.
export const NOTHING: ExpressionSpecification = ["==", ["literal", 0], 1];

const channels = (hex: string) => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  // A escala mistura as cores do tema, e o MapLibre precisa de uma cor pronta.
  if (!match) throw new Error(`O mapa precisa de cores em #rrggbb no tema, e recebeu "${hex}".`);
  return [0, 2, 4].map((start) => Number.parseInt(match[1].slice(start, start + 2), 16));
};

/** share = 0 devolve "from", share = 1 devolve "to". */
export function mixColors(from: string, to: string, share: number): string {
  const [a, b] = [channels(from), channels(to)];
  return `#${a.map((value, i) => Math.round(value + (b[i] - value) * share).toString(16).padStart(2, "0")).join("")}`;
}

export type ColorClass = { upTo: number; color: string };
export type ColorScale = { classes: ColorClass[]; zeroColor: string; hasZero: boolean; negativeColor: string; hasNegative: boolean; colorOf: (value: number | null) => string | null };

/**
 * Escala sequencial de um só tom, da cor da superfície até a cor principal. Cada faixa reúne um número
 * parecido de itens, porque poucos valores muito grandes deixariam quase tudo na mesma cor. O limite de
 * cada faixa é um valor real do recorte. Zero e negativo têm cor própria, e sem dado não tem cor: quem chama usa o neutro.
 * Negativo é a cor de sentido do tema: sem rótulo, no celular, ele não pode se ler como zero.
 */
export function colorScale(values: (number | null)[], primary: string, surface: string, negative: string, wanted = 5): ColorScale {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const positive = known.filter((value) => value > 0).sort((a, b) => a - b);
  const limits = [...new Set(Array.from({ length: wanted }, (_, i) => positive[Math.ceil(((i + 1) * positive.length) / wanted) - 1]))].filter((limit) => limit !== undefined);
  const classes = limits.map((upTo, i) => ({
    upTo,
    color: mixColors(surface, primary, ZERO_SHARE + (1 - ZERO_SHARE) * ((i + 1) / limits.length)),
  }));
  const zeroColor = mixColors(surface, primary, ZERO_SHARE);
  // A cor do tema passa pela mesma conferência: outro formato dá erro, e o bloco mostra o aviso.
  const negativeColor = mixColors(negative, negative, 0);
  return {
    classes,
    zeroColor,
    hasZero: known.some((value) => value === 0),
    negativeColor,
    hasNegative: known.some((value) => value < 0),
    colorOf: (value) => {
      if (value === null || !Number.isFinite(value)) return null;
      if (value < 0) return negativeColor;
      if (value === 0) return zeroColor;
      return (classes.find((item) => value <= item.upTo) ?? classes[classes.length - 1]).color;
    },
  };
}

export type LegendEntry = { key: string; color: string | null; label: string };

/**
 * As entradas da legenda. É uma escala de cores, não uma lista de itens: não filtra e não parece clicável.
 * Negativo, zero e sem dado só aparecem quando existem no recorte. "color" nulo é o neutro, com contorno.
 */
export function legendEntries(scale: ColorScale, format: (value: string | null) => string, missing: boolean): LegendEntry[] {
  return [
    ...(scale.hasNegative ? [{ key: "negativo", color: scale.negativeColor, label: "Negativo" }] : []),
    ...(scale.hasZero ? [{ key: "zero", color: scale.zeroColor, label: format("0") }] : []),
    ...scale.classes.map((item) => ({ key: String(item.upTo), color: item.color, label: `até ${format(String(item.upTo))}` })),
    ...(missing ? [{ key: "vazio", color: null, label: "Sem dado" }] : []),
  ];
}

/** A chave que um clique filtra: só área com dado no recorte. O resto só levaria a "sem dados". */
export const clickableKey = (key: string | null, inScope: { has: (key: string) => boolean }) => (key !== null && inScope.has(key) ? key : null);

const rings = (geometry: ShapeGeometry) => (geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((polygon) => polygon[0]));

/** Área com sinal do anel. O sinal só depende do sentido em que ele foi desenhado. */
const ringArea = (ring: Position[]) => ring.slice(1).reduce((sum, [x, y], i) => sum + ring[i][0] * y - x * ring[i][1], 0) / 2;

/** Caixa em graus: "top" é a maior latitude. */
export function shapeBox(geometry: ShapeGeometry): Rect {
  const points = rings(geometry).flat();
  return {
    left: Math.min(...points.map((point) => point[0])),
    right: Math.max(...points.map((point) => point[0])),
    top: Math.max(...points.map((point) => point[1])),
    bottom: Math.min(...points.map((point) => point[1])),
  };
}

export function shapesBounds(shapes: Shapes): [[number, number], [number, number]] {
  const boxes = shapes.features.map((feature) => shapeBox(feature.geometry));
  return [
    [Math.min(...boxes.map((box) => box.left)), Math.min(...boxes.map((box) => box.bottom))],
    [Math.max(...boxes.map((box) => box.right)), Math.max(...boxes.map((box) => box.top))],
  ];
}

export function insideRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ponto do rótulo: o centro da maior parte da área. Em forma côncava, troca por um ponto de dentro dela. */
export function labelPoint(geometry: ShapeGeometry): [number, number] {
  const ring = rings(geometry).reduce((largest, current) => (Math.abs(ringArea(current)) > Math.abs(ringArea(largest)) ? current : largest));
  const area = ringArea(ring);
  const sum = ring.slice(1).reduce(
    (total, [x, y], i) => {
      const cross = ring[i][0] * y - x * ring[i][1];
      return [total[0] + (ring[i][0] + x) * cross, total[1] + (ring[i][1] + y) * cross];
    },
    [0, 0],
  );
  const center: [number, number] = [sum[0] / (6 * area), sum[1] / (6 * area)];
  if (insideRing(center, ring)) return center;
  // Na linha que passa pelo centro, o meio do trecho mais largo que fica dentro da área.
  const crossings = ring.slice(1).flatMap(([x, y], i) => {
    const [px, py] = ring[i];
    return py > center[1] !== y > center[1] ? [((x - px) * (center[1] - py)) / (y - py) + px] : [];
  }).sort((a, b) => a - b);
  let best = center;
  let width = 0;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    if (crossings[i + 1] - crossings[i] > width) {
      width = crossings[i + 1] - crossings[i];
      best = [(crossings[i] + crossings[i + 1]) / 2, center[1]];
    }
  }
  return best;
}

export type LabelInput = { key: string; x: number; y: number; width: number; height: number; shortWidth: number; shape: Rect };
export type LabelPlace = { key: string; x: number; y: number; short: boolean; leader: { x: number; y: number } | null };

const rectAt = (x: number, y: number, width: number, height: number): Rect => ({ left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 });
const overlap = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const holds = (rect: Rect, point: { x: number; y: number }) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
const areaOf = (rect: Rect) => (rect.right - rect.left) * (rect.bottom - rect.top);

// Em graus, a partir da direção que sai do centro do mapa: rótulo deslocado tende a ir para fora dele.
const TURNS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
// O rótulo é mais largo que alto, então o deslocamento também é.
const STRETCH = 2.5;
// Em mapa estreito, não há lugar livre: o rótulo que sai da própria área cairia sobre outra e pareceria ser dela.
const MIN_WIDTH_TO_SHIFT = 480;

/**
 * Posição de cada rótulo, sem sobreposição e dentro do mapa. As áreas grandes escolhem primeiro, no próprio
 * centro. A pequena vai para o lado mais próximo, com uma linha até ela. Onde o nome e o valor não couberem,
 * fica só o nome. Onde nem isso couber, o rótulo sai, e o valor continua na dica do mouse e no gráfico por item.
 *
 * Selecionar não move nenhum rótulo, porque o clique não desloca o que está sob o mouse. O selecionado só ganha o valor
 * se ainda não o mostrava, e o rótulo que ficaria embaixo dele perde o valor ou, sem lugar nem para o nome, sai.
 */
export function placeLabels(items: LabelInput[], selected: string | null, width: number, height: number): LabelPlace[] {
  const places = placeAll(items, null, width, height);
  const current = places.find((place) => place.key === selected);
  if (selected === null || !items.some((item) => item.key === selected)) return places;
  if (current && !current.short) return [current, ...places.filter((place) => place !== current)];
  const chosen = placeAll(items, selected, width, height).find((place) => place.key === selected);
  if (!chosen) return places;
  const item = items.find((other) => other.key === selected)!;
  const rect = rectAt(chosen.x, chosen.y, chosen.short ? item.shortWidth : item.width, item.height);
  // Quem ficaria embaixo fica só com o nome, no mesmo lugar. Se nem isso couber, sai.
  return [chosen, ...places.flatMap((place) => {
    if (place.key === selected) return [];
    const other = items.find((candidate) => candidate.key === place.key)!;
    const free = (labelWidth: number) => !overlap(rect, rectAt(place.x, place.y, labelWidth, other.height));
    if (free(place.short ? other.shortWidth : other.width)) return [place];
    return !place.short && free(other.shortWidth) ? [{ ...place, short: true }] : [];
  })];
}

function placeAll(items: LabelInput[], selected: string | null, width: number, height: number): LabelPlace[] {
  const taken: Rect[] = [];
  const places: LabelPlace[] = [];
  const placed = new Set<string>();
  const roomy = width >= MIN_WIDTH_TO_SHIFT;
  // Rótulo não cobre área menor que ele, nem a própria: ela continua à vista, com o destaque, e fácil de acertar com o mouse.
  const tiny = items.filter((item) => areaOf(item.shape) < (roomy ? item.width : item.shortWidth) * item.height);
  // Nem cobre o centro de outra área: um rótulo em cima dela pareceria ser dela. O lugar do nome curto fica guardado.
  const centers = items.map((item) => ({ key: item.key, rect: rectAt(item.x, item.y, item.shortWidth, item.height) }));
  const free = (rect: Rect, item: LabelInput) => {
    if (rect.left < 0 || rect.top < 0 || rect.right > width || rect.bottom > height) return false;
    if (taken.some((other) => overlap(rect, other))) return false;
    if (roomy && tiny.some((other) => other.key === item.key && overlap(rect, other.shape))) return false;
    // O selecionado escolhe primeiro, e o valor dele sempre aparece, em qualquer largura.
    if (item.key === selected) return true;
    return !tiny.some((other) => other.key !== item.key && overlap(rect, other.shape))
      && !centers.some((other) => other.key !== item.key && !placed.has(other.key) && overlap(rect, other.rect));
  };

  const place = (item: LabelInput, x: number, y: number, w: number, short: boolean) => {
    const rect = rectAt(x, y, w, item.height);
    taken.push(rect);
    placed.add(item.key);
    places.push({
      key: item.key,
      x,
      y,
      short,
      leader: holds(rect, item) ? null : { x: Math.min(Math.max(item.x, rect.left), rect.right), y: Math.min(Math.max(item.y, rect.top), rect.bottom) },
    });
  };

  const ordered = [...items].sort((a, b) => Number(b.key === selected) - Number(a.key === selected) || areaOf(b.shape) - areaOf(a.shape));
  const missing: LabelInput[] = [];
  for (const item of ordered) {
    const outward = Math.atan2(item.y - height / 2, item.x - width / 2);
    let done = free(rectAt(item.x, item.y, item.width, item.height), item);
    if (done) place(item, item.x, item.y, item.width, false);
    for (let radius = item.height; !done && radius <= Math.max(width, height) * 0.2; radius += item.height / 2) {
      for (const turn of TURNS) {
        const angle = outward + (turn * Math.PI) / 180;
        const x = item.x + Math.cos(angle) * radius * STRETCH;
        const y = item.y + Math.sin(angle) * radius;
        const rect = rectAt(x, y, item.width, item.height);
        if ((roomy || holds(rect, item)) && free(rect, item)) {
          place(item, x, y, item.width, false);
          done = true;
          break;
        }
      }
    }
    if (!done) missing.push(item);
  }
  // Por último, para o nome curto não tomar o lugar de um rótulo completo.
  for (const item of missing) {
    if (free(rectAt(item.x, item.y, item.shortWidth, item.height), item)) place(item, item.x, item.y, item.shortWidth, true);
  }
  return places;
}

/**
 * Estilo do mapa: só os contornos guardados no projeto. Sem glyphs, sprite ou tiles, nada é pedido à rede,
 * e o MapLibre não desenha texto: os rótulos são elementos da página.
 */
export function mapStyle(shapes: Shapes, colors: { neutral: string; outline: string; selected: string }): StyleSpecification {
  return {
    version: 8,
    sources: { [SOURCE]: { type: "geojson", data: shapes as never, tolerance: 0.2 } },
    layers: [
      { id: LAYERS.fill, type: "fill", source: SOURCE, paint: { "fill-color": colors.neutral } },
      { id: LAYERS.line, type: "line", source: SOURCE, paint: { "line-color": colors.outline, "line-width": 0.6 } },
      { id: LAYERS.selected, type: "line", source: SOURCE, filter: NOTHING, paint: { "line-color": colors.selected, "line-width": 2 } },
    ],
  };
}

export function fillColor(idProperty: string, colors: [string, string][], neutral: string): ExpressionSpecification | string {
  return colors.length === 0 ? neutral : (["match", ["get", idProperty], ...colors.flat(), neutral] as unknown as ExpressionSpecification);
}
