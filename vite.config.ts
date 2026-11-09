import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** App-Updates fürs Protokoll: Merges (mit ihren Pushes) und direkte Pushes auf main, aus der Git-Historie. */
function appChanges() {
  try {
    const git = (args: string) => execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 24 });
    const out = [];
    for (const rec of git("log --first-parent -n 400 --format=%H%x1f%P%x1f%cI%x1f%s%x1f%b%x1e HEAD").split("\x1e")) {
      const [sha, parents, at, subject, body] = rec.trim().split("\x1f");
      if (!sha) continue;
      const ps = parents.split(" ").filter(Boolean);
      const pr = /#(\d+)/.exec(subject);
      if (ps.length > 1) {
        const commits = git(`log --format=%cI%x1f%s%x1e ${ps[0]}..${ps[1]}`)
          .split("\x1e")
          .map((r) => r.trim().split("\x1f"))
          .filter(([a]) => a)
          .map(([a, t]) => ({ at: a, title: t }));
        const title = (body ?? "").trim().split("\n")[0] || subject;
        out.push({ type: "merge", at, pr: pr ? Number(pr[1]) : null, title, sha, commits });
      } else {
        out.push({ type: "push", at, pr: null, title: subject, sha, commits: [] });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Trägt nach dem Bauen die Dateien unter assets/ in den Service Worker ein. Der löscht damit beim Update
 * die Programmteile früherer Versionen aus dem Gerätespeicher (public/sw.js, pruneOldAssets).
 */
function swAssets(): Plugin {
  const MARK = "/*__ASSETS__*/ null";
  let outDir = "dist";
  return {
    name: "drivepool-sw-assets",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const sw = join(outDir, "sw.js");
      const dir = join(outDir, "assets");
      if (!existsSync(sw) || !existsSync(dir)) return;
      const src = readFileSync(sw, "utf8");
      if (src.includes("const ASSETS = [")) return; // schon eingetragen (Hook lief zweimal)
      if (!src.includes(MARK)) throw new Error("sw.js: Platzhalter für die Asset-Liste fehlt");
      const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
        .filter((d) => d.isFile())
        .map((d) => join(d.parentPath, d.name).slice(outDir.length + 1).replaceAll("\\", "/"))
        .sort();
      writeFileSync(sw, src.replace(MARK, JSON.stringify(files)));
    },
  };
}

// base "./" damit die App unter jedem Pfad läuft (z. B. GitHub Pages /Drive-Connector/)
export default defineConfig({
  base: "./",
  plugins: [react(), swAssets()],
  define: { __APP_CHANGES__: JSON.stringify(appChanges()) },
  // KI-SUCHE: der Worker lädt Teile nach → ES-Modul-Format nötig
  worker: { format: "es" },
});
