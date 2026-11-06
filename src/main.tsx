import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "./lib/theme";
import "./styles.css";

initTheme();

// Die App startet aus dem Speicher (Service Worker). Gab es inzwischen eine neue Version, fehlen evtl. Teile
// der alten auf dem Server → einmal neu laden, dann läuft die neue (wurde nebenbei schon geholt).
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  const k = "drivepool.reloadedAt";
  if (Date.now() - Number(sessionStorage.getItem(k) ?? 0) < 10_000) return; // keine Endlosschleife
  sessionStorage.setItem(k, String(Date.now()));
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
