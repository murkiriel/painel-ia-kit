import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// O site estático usa esta configuração com mode "static": caminhos relativos, para abrir em subpasta,
// e o que é só dele, ou só do servidor, sai do pacote da tela. Cada site leva um dashboard só, o de STATIC_DASHBOARD.
// Veja dashboards/<slug>/scripts/build-static.ts.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "static" ? "./" : "/",
  define: {
    __STATIC_SITE__: JSON.stringify(mode === "static"),
    __STATIC_DASHBOARD__: JSON.stringify(mode === "static" ? process.env.STATIC_DASHBOARD ?? "" : ""),
  },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
}));
