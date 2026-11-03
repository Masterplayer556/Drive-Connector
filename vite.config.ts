import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" damit die App unter jedem Pfad läuft (z. B. GitHub Pages /Drive-Connector/)
export default defineConfig({
  base: "./",
  plugins: [react()],
  // KI-SUCHE: der Worker lädt Teile nach → ES-Modul-Format nötig
  worker: { format: "es" },
});
