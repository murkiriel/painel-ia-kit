import { Map as MapLibre, setWorkerUrl, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useMemo, useRef, useState } from "react";
import { chartValue } from "../../../shared/format.ts";
import type { Tokens } from "../tokens.ts";
import { clickableKey, colorScale, FADED_OPACITY, fillColor, labelPoint, LAYERS, legendEntries, mapStyle, NOTHING, placeLabels, shapeBox, shapesBounds, type Shapes } from "./mapRules.ts";

// O MapLibre procura o worker ao lado do próprio arquivo, mas o Vite junta tudo em outro nome.
setWorkerUrl(workerUrl);

export type MapRow = { key: string | null; label: string; value: string | null };

export type MapCanvasProps = {
  shapes: Shapes;
  /** Propriedades do GeoJSON com a chave do filtro, a sigla e o nome. */
  properties: { id: string; short: string; name: string };
  rows: MapRow[];
  selected: string | null;
  /** Sem esta função, o mapa só mostra: o estado não filtra e não parece clicável. */
  onSelect?: (key: string) => void;
  tokens: Tokens;
  /** Valor resumido, na tela, e exato, na dica do mouse. */
  format: (value: string | null) => string;
  formatExact: (value: string | null) => string;
  label: string;
  caption: string;
  /** Parte da largura reservada à direita, para os rótulos das áreas pequenas. */
  rightRoom?: number;
  onFail: () => void;
};

const LABEL_HEIGHT = 16;
const LABEL_PADDING = 8;
const MARGIN = 8;

export default function MapCanvas({ shapes, properties, rows, selected, onSelect, tokens, format, formatExact, label, caption, rightRoom = 0, onFail }: MapCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [ready, setReady] = useState(false);
  // Muda a cada enquadramento, para os rótulos serem recalculados.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [tip, setTip] = useState<{ key: string; x: number; y: number } | null>(null);

  const byKey = useMemo(() => new Map(rows.flatMap((row) => (row.key === null ? [] : [[row.key, row] as const]))), [rows]);
  const scale = useMemo(() => colorScale(rows.map((row) => chartValue(row.value)), tokens.primary, tokens.surface, tokens.negative), [rows, tokens]);
  const places = useMemo(() => shapes.features.map((feature) => ({
    key: feature.properties[properties.id],
    short: feature.properties[properties.short],
    name: feature.properties[properties.name],
    point: labelPoint(feature.geometry),
    box: shapeBox(feature.geometry),
  })), [shapes, properties]);

  // Os cliques e o mouse ficam registrados uma vez só, e leem sempre o valor atual daqui.
  const latest = useRef({ byKey, onSelect, onFail });
  latest.current = { byKey, onSelect, onFail };

  useEffect(() => {
    const container = element.current!;
    // Trocar de aba depressa cria e desfaz mapas em sequência. Nada disso pode virar o aviso de falha:
    // erro de um mapa que já saiu da tela é ignorado; a criação tenta de novo (a placa de vídeo pode ainda estar liberando o anterior);
    // e o contexto gráfico perdido tem 3 s para voltar sozinho antes do aviso.
    let disposed = false;
    let instance: MapLibre | null = null;
    let observer: ResizeObserver | null = null;
    let retry: number | undefined;
    let lost: number | undefined;
    const fail = () => {
      if (!disposed) latest.current.onFail();
    };
    const start = (attempt: number) => {
      if (disposed) return;
      try {
        instance = new MapLibre({
          container,
          style: mapStyle(shapes, { neutral: tokens.background, outline: tokens.muted, selected: tokens.text }),
          // Sem zoom nem arraste: a rolagem da página passa direto pelo mapa, também no celular.
          interactive: false,
          attributionControl: false,
          renderWorldCopies: false,
          fadeDuration: 0,
          locale: { "Map.Title": label },
        });
      } catch {
        if (attempt < 3) retry = window.setTimeout(() => start(attempt + 1), 300 * attempt);
        else fail();
        return;
      }
      wire(instance);
    };
    const wire = (instance: MapLibre) => {
      map.current = instance;
      const bounds = shapesBounds(shapes);
      const fit = () => {
        const { clientWidth: width, clientHeight: height } = container;
        if (width < 50 || height < 50) return;
        instance.resize();
        instance.fitBounds(bounds, { padding: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN + width * rightRoom }, animate: false });
        setSize({ width, height });
      };
      instance.once("load", () => {
        fit();
        setReady(true);
      });
      // Este mapa não busca nada na rede: erro dele é falha de desenho ou do worker. Carregamento cancelado (troca de aba) não é falha.
      instance.on("error", (event) => {
        if ((event as { error?: { name?: string } }).error?.name !== "AbortError") fail();
      });
      instance.on("webglcontextlost", () => {
        window.clearTimeout(lost);
        lost = window.setTimeout(fail, 3000);
      });
      instance.on("webglcontextrestored", () => window.clearTimeout(lost));
  
      const keyAt = (point: { x: number; y: number }) => {
        const found = instance.queryRenderedFeatures([point.x, point.y], { layers: [LAYERS.fill] });
        return found.length ? String(found[0].properties[properties.id]) : null;
      };
      instance.on("mousemove", (event) => {
        const key = keyAt(event.point);
        // Só área com dado no recorte filtra: o resto não parece clicável.
        instance.getCanvas().style.cursor = latest.current.onSelect && clickableKey(key, latest.current.byKey) !== null ? "pointer" : "";
        setTip(key === null ? null : { key, x: event.point.x, y: event.point.y });
      });
      instance.getCanvas().addEventListener("mouseleave", () => setTip(null));
      instance.on("click", (event) => {
        const key = clickableKey(keyAt(event.point), latest.current.byKey);
        if (key !== null) latest.current.onSelect?.(key);
      });
  
      observer = new ResizeObserver(fit);
      observer.observe(container);
    };
    start(1);
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      window.clearTimeout(lost);
      observer?.disconnect();
      map.current = null;
      instance?.remove();
    };
    // O mapa é criado uma vez. Os dados e a seleção entram no efeito abaixo.
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const colors = rows.flatMap((row): [string, string][] => {
      const color = row.key === null ? null : scale.colorOf(chartValue(row.value));
      return row.key !== null && color !== null ? [[row.key, color]] : [];
    });
    // Se a seleção não está no recorte, nada se apaga.
    const active = selected !== null && byKey.has(selected);
    const isSelected: ExpressionSpecification = ["==", ["get", properties.id], selected ?? ""];
    instance.setPaintProperty(LAYERS.fill, "fill-color", fillColor(properties.id, colors, tokens.background));
    instance.setPaintProperty(LAYERS.fill, "fill-opacity", active ? ["case", isSelected, 1, FADED_OPACITY] : 1);
    instance.setFilter(LAYERS.selected, active ? isSelected : NOTHING);
  }, [ready, rows, selected, scale, byKey, tokens, properties]);

  // No toque não há "mouse saiu": a dica fecha ao tocar fora do mapa ou ao rolar a página.
  const tipOpen = tip !== null;
  useEffect(() => {
    if (!tipOpen) return;
    const close = () => setTip(null);
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", close, true);
    };
  }, [tipOpen]);

  const labels = useMemo(() => {
    const instance = map.current;
    if (!ready || !size || !instance) return [];
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return [];
    context.font = `600 11px ${getComputedStyle(box.current!).fontFamily}`;
    const widthOf = (text: string) => Math.ceil(context.measureText(text).width) + LABEL_PADDING;
    const inputs = places.flatMap((place) => {
      const row = byKey.get(place.key);
      if (!row || chartValue(row.value) === null) return [];
      const center = instance.project(place.point);
      const corner = instance.project([place.box.left, place.box.top]);
      const opposite = instance.project([place.box.right, place.box.bottom]);
      const full = `${place.short} ${format(row.value)}`;
      return [{
        key: place.key,
        short: place.short,
        full,
        x: center.x,
        y: center.y,
        width: widthOf(full),
        height: LABEL_HEIGHT,
        shortWidth: widthOf(place.short),
        shape: { left: corner.x, top: corner.y, right: opposite.x, bottom: opposite.y },
      }];
    });
    return placeLabels(inputs, selected, size.width, size.height).map((placed) => {
      const input = inputs.find((item) => item.key === placed.key)!;
      return { ...placed, text: placed.short ? input.short : input.full, anchorX: input.x, anchorY: input.y };
    });
  }, [ready, size, places, byKey, selected, format]);

  const tipPlace = tip && places.find((place) => place.key === tip.key);
  const tipRow = tip ? byKey.get(tip.key) : undefined;
  const missing = places.some((place) => chartValue(byKey.get(place.key)?.value ?? null) === null);

  return (
    <>
      <div ref={box} className="map-box" role="img" aria-label={label}>
        <div ref={element} className="map-canvas" />
        <svg className="map-leaders" aria-hidden="true" width="100%" height="100%">
          {labels.flatMap((item) => (item.leader ? [<line key={item.key} x1={item.anchorX} y1={item.anchorY} x2={item.leader.x} y2={item.leader.y} />] : []))}
        </svg>
        {labels.map((item) => (
          <div
            key={item.key}
            aria-hidden="true"
            className="map-label"
            data-key={item.key}
            style={{ left: item.x, top: item.y, height: LABEL_HEIGHT, ...(onSelect ? {} : { cursor: "default" }) }}
            onClick={() => onSelect?.(item.key)}
            onMouseMove={(event) => {
              const rect = box.current!.getBoundingClientRect();
              setTip({ key: item.key, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
            onMouseLeave={() => setTip(null)}
          >
            {item.text}
          </div>
        ))}
        {tip && tipPlace && size && (
          <div
            className="map-tip"
            role="tooltip"
            // Fica sempre dentro do mapa: passa para o outro lado do mouse depois do meio.
            style={{
              left: tip.x,
              top: tip.y,
              transform: `translate(${tip.x > size.width / 2 ? "calc(-100% - 12px)" : "12px"}, ${tip.y > size.height / 2 ? "calc(-100% - 12px)" : "12px"})`,
            }}
          >
            <strong>{tipPlace.name}</strong>
            {/* Só o valor exato: o resumido repetia o mesmo número com menos casas ("57%" e "56,5%"). */}
            {tipRow && chartValue(tipRow.value) !== null ? (
              <span>{formatExact(tipRow.value)}</span>
            ) : (
              <span>Sem dado neste recorte</span>
            )}
          </div>
        )}
      </div>
      {/* Escala de cores, não uma lista de itens: não filtra e não parece clicável. */}
      <div className="map-legend" role="group" aria-label={`Legenda: ${label}`}>
        {legendEntries(scale, format, missing).map((entry) => (
          <span key={entry.key}>{entry.color === null ? <i className="map-legend-empty" /> : <i style={{ background: entry.color }} />}{entry.label}</span>
        ))}
        <small>{caption}</small>
      </div>
    </>
  );
}
