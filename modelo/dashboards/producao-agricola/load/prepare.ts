// Lê e confere tudo antes de qualquer gravação. Se algo estiver errado, lança erro,
// e o dado anterior continua no ar. Recebe getJson para ser testada sem rede.
import { parseNational, parseYear, reconcile, reconcileNational, type NationalTotal, type Production, type SidraRow } from "./sidra.ts";

export const API = "https://apisidra.ibge.gov.br/values/t/5457";
export const METADATA = "https://servicodados.ibge.gov.br/api/v3/agregados/5457/metadados";
const VARIABLES = "v/214,215,216";
const YEARS = 10;
const STATES = 27;

export type Prepared = {
  raw: SidraRow[];
  production: Production[];
  national: NationalTotal[];
};

export async function prepareLoad(
  getJson: (url: string) => Promise<unknown>,
  log: (message: string) => void = () => {},
  pause: () => Promise<void> = async () => {},
): Promise<Prepared> {
  const metadata = (await getJson(METADATA)) as { periodicidade?: { fim?: unknown } };
  const lastYear = Number(metadata.periodicidade?.fim);
  if (!Number.isInteger(lastYear) || lastYear < 1974) throw new Error("A fonte não informou o último ano.");

  const prepared: Prepared = { raw: [], production: [], national: [] };
  const rejected: string[] = [];

  // A API recusa consultas grandes com erro 400, então a leitura vai ano a ano.
  for (let year = lastYear - YEARS + 1; year <= lastYear; year++) {
    const rows = ((await getJson(`${API}/n3/all/${VARIABLES}/p/${year}/c782/all?formato=json`)) as SidraRow[]).slice(1);
    if (rows.length === 0) throw new Error(`A fonte não devolveu linhas para ${year}.`);

    const parsed = parseYear(rows);
    const states = new Set(parsed.production.map((p) => p.state_code)).size;
    if (states !== STATES) throw new Error(`Esperava ${STATES} UFs em ${year}, e vieram ${states}.`);
    const problems = reconcile(parsed);
    if (problems.length > 0) throw new Error(`A soma não fecha com o total da fonte em ${year}: ${problems.slice(0, 5).join("; ")}`);

    await pause();
    const national = parseNational(((await getJson(`${API}/n1/1/${VARIABLES}/p/${year}/c782/all?formato=json`)) as SidraRow[]).slice(1));
    if (national.length === 0) throw new Error(`A fonte não devolveu o total do Brasil para ${year}.`);
    const nationalProblems = reconcileNational(parsed.production, national);
    if (nationalProblems.length > 0) throw new Error(`Não fecha com o total do Brasil em ${year}: ${nationalProblems.slice(0, 5).join("; ")}`);

    prepared.raw.push(...rows);
    prepared.production.push(...parsed.production);
    prepared.national.push(...national);
    rejected.push(...parsed.rejected);
    log(`${year}: ${rows.length} linhas lidas, ${parsed.production.length} linhas de produção.`);
    await pause();
  }
  if (rejected.length > 0) throw new Error(`Valores não previstos na fonte: ${rejected.slice(0, 5).join("; ")}`);
  return prepared;
}
