// Carga periódica. Lê e confere a fonte e só então troca os dados, em uma transação.
// Se algo falhar, o dado anterior continua no ar e o log registra o erro.
import { prepareLoad } from "./prepare.ts";
import { openLoadStore } from "./store.ts";

process.loadEnvFile(".env");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(attempt * 5000);
    }
  }
}

const store = await openLoadStore().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

if (!(await store.lock())) {
  console.error("Já existe uma carga em andamento.");
  process.exit(1);
}

const logId = await store.start();

try {
  const prepared = await prepareLoad(getJson, console.log, () => sleep(1500));
  await store.replace(logId, prepared);
  console.log(`Carga concluída: ${prepared.raw.length} linhas lidas, ${prepared.production.length} gravadas.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await store.fail(logId, message);
  console.error(`Carga falhou, e o dado anterior foi mantido: ${message}`);
  process.exitCode = 1;
} finally {
  await store.close();
}
