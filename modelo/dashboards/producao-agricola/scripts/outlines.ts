// Baixa os contornos das UFs da API de malhas do IBGE e grava o arquivo usado pelo mapa.
// Só usa a rede quando chamado, com npm run outlines. A tela lê o arquivo guardado no projeto.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALL_STATES } from "../domain/filters.ts";

const API = "https://servicodados.ibge.gov.br/api";
// A malha "mínima" é a mais simplificada que o IBGE publica, com a divisão por UF.
const OUTLINES_URL = `${API}/v3/malhas/paises/BR?intrarregiao=UF&qualidade=minima&formato=application/vnd.geo%2Bjson`;
const STATES_URL = `${API}/v1/localidades/estados`;
// Onde o arquivo fica, ao lado da tela que o importa, qualquer que seja a pasta de onde o script roda.
export const TARGET = fileURLToPath(new URL("../web/ufs.geo.json", import.meta.url));
// Diz quem está chamando. Nunca se passe por navegador.
const USER_AGENT = "painel-ia-kit (script de contornos das UFs)";
// 3 casas são cerca de 100 m, muito menos que um pixel neste mapa.
const DIGITS = 3;

type Position = number[];
type Geometry = { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };
type RawOutlines = { features: { properties: { codarea?: string }; geometry: Geometry }[] };
type RawState = { id: number; sigla: string; nome: string };

function roundRing(ring: Position[]): Position[] {
  const factor = 10 ** DIGITS;
  const rounded = ring.map(([lng, lat]) => [Math.round(lng * factor) / factor, Math.round(lat * factor) / factor]);
  return rounded.filter((point, i) => i === 0 || point[0] !== rounded[i - 1][0] || point[1] !== rounded[i - 1][1]);
}

const roundPolygon = (polygon: Position[][]) => polygon.map(roundRing).filter((ring) => ring.length >= 4);

function roundGeometry(geometry: Geometry): Geometry {
  if (geometry.type === "Polygon") return { type: "Polygon", coordinates: roundPolygon(geometry.coordinates) };
  if (geometry.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: geometry.coordinates.map(roundPolygon).filter((polygon) => polygon.length > 0) };
  throw new Error(`Geometria inesperada: ${(geometry as { type: string }).type}.`);
}

/** Sem rede, para testar. Recusa o arquivo se ele não trouxer exatamente as 27 UFs, para nenhum estado sumir em silêncio. */
export function prepareOutlines(raw: RawOutlines, states: RawState[], downloadedAt: string): string {
  const codes = raw.features.map((feature) => String(feature.properties.codarea));
  const expected = [...ALL_STATES].sort().join();
  if ([...codes].sort().join() !== expected) throw new Error(`A malha não traz as 27 UFs: ${codes.join()}.`);
  const named = new Map(states.map((state) => [String(state.id), state]));
  const features = raw.features
    .map((feature) => {
      const code = String(feature.properties.codarea);
      const state = named.get(code);
      if (!state) throw new Error(`UF sem nome na fonte: ${code}.`);
      return { type: "Feature", properties: { codarea: code, sigla: state.sigla, nome: state.nome }, geometry: roundGeometry(feature.geometry) };
    })
    .sort((a, b) => a.properties.codarea.localeCompare(b.properties.codarea));
  // Campo a mais no GeoJSON é permitido: a origem fica junto do dado, e o mapa ignora.
  const source = { publisher: "IBGE", outlines: OUTLINES_URL, names: STATES_URL, downloadedAt };
  return `{"type":"FeatureCollection","source":${JSON.stringify(source)},"features":[\n${features.map((feature) => JSON.stringify(feature)).join(",\n")}\n]}\n`;
}

async function download(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw new Error(`Falha ao baixar ${url}: ${(error as Error).message}`);
    }
  }
}

if (import.meta.main) {
  const [outlines, states] = await Promise.all([download(OUTLINES_URL), download(STATES_URL)]);
  const text = prepareOutlines(outlines as RawOutlines, states as RawState[], new Date().toISOString().slice(0, 10));
  writeFileSync(TARGET, text);
  console.log(`ufs.geo.json: ${text.length} bytes.`);
}
