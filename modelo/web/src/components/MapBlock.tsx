import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { MapCanvasProps } from "./MapCanvas.tsx";
import type { Shapes } from "./mapRules.ts";

// O MapLibre fica em um pedaço separado: só quem abre um mapa baixa.
const MapCanvas = lazy(() => import("./MapCanvas.tsx"));

const FAILURE = "Não foi possível desenhar o mapa neste navegador, que pode estar sem WebGL. O restante do dashboard continua funcionando.";

function Failure({ note }: { note?: string }) {
  return <div className="state error map-box" role="alert"><span>{FAILURE}{note ? ` ${note}` : ""}</span></div>;
}

/** Falha ao baixar ou desenhar o mapa fica neste bloco, sem derrubar a tela. */
class MapBoundary extends Component<{ note?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <Failure note={this.props.note} /> : this.props.children;
  }
}

type Props = Omit<MapCanvasProps, "shapes" | "onFail"> & {
  /** Carrega o GeoJSON só quando o mapa abre. Precisa ser uma função fixa, fora do componente. */
  loadShapes: () => Promise<Shapes>;
  /** Onde o valor continua à vista se o mapa não abrir. */
  failureNote?: string;
};

/** Mapa por área, de qualquer GeoJSON: troque o arquivo, as propriedades e os valores. */
export function MapBlock({ loadShapes, failureNote, ...props }: Props) {
  const [failed, setFailed] = useState(false);
  const [shapes, setShapes] = useState<Shapes | null>(null);

  useEffect(() => {
    let current = true;
    loadShapes().then(
      (loaded) => {
        if (current) setShapes(loaded);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [loadShapes]);

  const waiting = <div className="state map-box">Carregando mapa...</div>;

  return (
    <>
      {failed ? <Failure note={failureNote} /> : (
        <MapBoundary note={failureNote}>
          <Suspense fallback={waiting}>
            {shapes ? <MapCanvas {...props} shapes={shapes} onFail={() => setFailed(true)} /> : waiting}
          </Suspense>
        </MapBoundary>
      )}
      {/* Para o teclado: o mapa não recebe foco, mas este seletor sim, e faz o mesmo que o clique. */}
      {props.onSelect && (
        <select
          className="chart-keyboard"
          aria-label={`Selecionar no mapa: ${props.label}`}
          value=""
          onChange={(event) => {
            if (event.target.value) props.onSelect?.(event.target.value);
          }}
        >
          <option value="">Selecionar no mapa: {props.label}</option>
          {props.rows.flatMap((row) => (row.key === null ? [] : [<option key={row.key} value={row.key}>{row.label}</option>]))}
        </select>
      )}
    </>
  );
}
