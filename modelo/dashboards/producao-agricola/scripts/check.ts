// Conferência independente: lê o total do Brasil direto na fonte e compara com a API do dashboard.
// Não usa o código da carga nem o banco. Precisa do servidor no ar, em modo local (sem login). Só lê.
export {};

const API_URL = process.env.DASHBOARD_URL ?? "http://127.0.0.1:8787";
const SOURCE = "https://apisidra.ibge.gov.br/values/t/5457/n1/1/v/215,216/p/all/c782/0?formato=json";

// A soma de 27 UFs, cada uma publicada em mil reais, pode diferir do total do Brasil por arredondamento.
const TOLERANCE: Record<string, number> = { value: 27_000, area: 0 };

type SidraRow = { D2C: string; D3N: string; V: string };
const rows = ((await (await fetch(SOURCE)).json()) as SidraRow[]).slice(1);

const check = async (year: number) => {
  const response = await fetch(`${API_URL}/api/d/producao-agricola/summary?ano=${year}`);
  if (!response.ok) throw new Error(`API respondeu ${response.status}`);
  return response.json() as Promise<{ value: string; area: string }>;
};

const options = await (await fetch(`${API_URL}/api/d/producao-agricola/filter-options`)).json() as { ano: { key: string }[] };
// Sem nenhum ano, nada foi comparado: isso não é "0 divergências".
if (options.ano.length === 0) {
  console.error("O dashboard está sem dados: nada foi comparado. Rode a carga.");
  process.exit(1);
}
let divergences = 0;

console.log("Indicador | Ano | Fonte | Dashboard | Diferença | Situação");
for (const { key } of options.ano) {
  const year = Number(key);
  const summary = await check(year);
  for (const [code, field, label, factor] of [["215", "value", "Valor (R$)", 1000], ["216", "area", "Área (ha)", 1]] as const) {
    const source = rows.find((r) => r.D2C === code && r.D3N === key);
    const expected = BigInt(source?.V ?? "0") * BigInt(factor);
    const dashboard = BigInt(summary[field].split(".")[0]);
    const difference = dashboard - expected;
    const ok = (difference < 0n ? -difference : difference) <= BigInt(TOLERANCE[field]);
    if (!ok) divergences++;
    console.log(`${label} | ${year} | ${expected} | ${dashboard} | ${difference} | ${ok ? "OK" : "DIVERGE"}`);
  }
}
console.log(`\n${divergences} divergências.`);
process.exitCode = divergences === 0 ? 0 : 1;
