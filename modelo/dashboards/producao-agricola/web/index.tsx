// A tela deste dashboard para o portal.
import type { DashboardView } from "../../../web/src/dashboardView.ts";
import { CheckPage } from "./CheckPage.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { HELP } from "./indicators.ts";

export const view: DashboardView = {
  title: "Produção agrícola do Brasil",
  Screen: ({ info, onScope }) => <Dashboard onScope={onScope} hasMonth={info.hasMonth === true} />,
  Check: () => <CheckPage />,
  agent: { help: HELP.agent, placeholder: "Quais são as maiores lavouras?" },
};
