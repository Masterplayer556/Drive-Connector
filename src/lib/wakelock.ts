// Bildschirm während des Uploads wach halten (iOS pausiert Uploads im Hintergrund).
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
