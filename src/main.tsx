import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { reloadOnce } from "./lib/reload";
import { initScrollLock } from "./lib/scrollLock";
import { initTheme } from "./lib/theme";
import "./styles.css";

initTheme();
initScrollLock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary full>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Nach einem App-Update fehlt der alten Seite ein Programmteil → einmal neu laden (sonst zeigt der Fehler-Fang den Knopf)
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnce()) event.preventDefault();
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
