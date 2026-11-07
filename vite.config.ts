import { execSync } from "node:child_process";
import { defineConfig } from "vite";
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

// base "./" damit die App unter jedem Pfad läuft (z. B. GitHub Pages /Drive-Connector/)
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __APP_CHANGES__: JSON.stringify(appChanges()) },
  // KI-SUCHE: der Worker lädt Teile nach → ES-Modul-Format nötig
  worker: { format: "es" },
});
