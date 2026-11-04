// Bildschirm wach halten (Uploads, Löschen, Verschieben … – iOS pausiert die App sonst, wenn der Bildschirm ausgeht).
import { useEffect } from "react";
type Sentinel = { release: () => Promise<void> };

export async function keepAwake(): Promise<() => void> {
  const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
  let sentinel: Sentinel | null = null;
  const acquire = async () => {
    try {
      sentinel = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      sentinel = null;
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };
  await acquire();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void sentinel?.release().catch(() => undefined);
  };
}

/** React: Bildschirm wach halten, solange `active` (Löschen, Hochladen, Verschieben …). */
export function useKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let release: (() => void) | null = null;
    let gone = false;
    void keepAwake().then((r) => {
      if (gone) r();
      else release = r;
    });
    return () => {
      gone = true;
      release?.();
    };
  }, [active]);
}
