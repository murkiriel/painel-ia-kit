// Os dashboards do projeto. Para acrescentar um, veja "Acrescentar um dashboard" no README: copie a pasta de um existente e liste aqui.
import { producaoAgricola } from "../dashboards/producao-agricola/dashboard.ts";
import type { Dashboard } from "./dashboard.ts";

export const DASHBOARDS: Dashboard[] = [producaoAgricola];
