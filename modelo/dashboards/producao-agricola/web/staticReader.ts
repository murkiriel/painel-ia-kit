// Site estático deste dashboard: lê o arquivo pré-calculado de cada consulta, no lugar da API.
import { ApiError } from "../../../web/src/api.ts";
import { MANIFEST_FILE, readSite, SiteFailure, type LoadFile, type SiteManifest, type SiteRoute } from "../shared/staticSite.ts";

const NOT_OPENED = "Os dados deste site não foram encontrados.";
const UNREADABLE = "O arquivo de dados deste bloco está ilegível.";
let manifest: Promise<SiteManifest> | null = null;

async function loadJson(file: string, signal?: AbortSignal, fresh = false) {
  let response: Response;
  try {
    response = await fetch(new URL(file, document.baseURI), { signal, cache: fresh ? "no-cache" : "default" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "Sem conexão com o site.");
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, `Falha ${response.status}.`);
  const data = await response.json().catch((error) => {
    if (signal?.aborted) throw error;
    throw new ApiError(response.status, UNREADABLE);
  });
  // Toda resposta traz a data da carga. Sem ela, o arquivo não é o que deveria ser.
  if (data === null || typeof data !== "object" || Array.isArray(data) || !("updatedAt" in data)) throw new ApiError(response.status, UNREADABLE);
  return data as Record<string, any>;
}

function openSite(): Promise<SiteManifest> {
  // O índice nunca vem da memória do navegador. Os arquivos levam a data da geração, para não misturar duas cargas na mesma tela.
  manifest ??= loadJson(MANIFEST_FILE, undefined, true).then((data) => {
    if (data === null || !Array.isArray(data.years)) throw new ApiError(0, NOT_OPENED);
    return data as unknown as SiteManifest;
  }).catch((error) => {
    manifest = null; // tentar de novo pode resolver
    throw error instanceof ApiError && error.status !== 0 ? new ApiError(0, NOT_OPENED) : error;
  });
  return manifest;
}

/** A mesma resposta da API, lida do arquivo daquela consulta. Só leitura: sem agente, sem login, sem conferência. */
export async function readStatic<T>(path: string, signal?: AbortSignal): Promise<T> {
  const site = await openSite();
  if (path === "info") return { canCheck: false } as T;
  const [address, query = ""] = path.split("?");
  const load: LoadFile = (file) => loadJson(`${file}?v=${encodeURIComponent(site.generatedAt)}`, signal);
  try {
    return await readSite(address as SiteRoute, query, site, load) as T;
  } catch (error) {
    if (!(error instanceof SiteFailure)) throw error;
    throw new ApiError(error.kind === "invalid" ? 400 : 404, error.message, error.kind === "unpublished");
  }
}

