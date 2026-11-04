// KI-SUCHE: „KI trainieren“ – Begriffe, die auf deinen Fotos oft vorkommen (und gelernte Namen),
// und je Begriff eine Reihe Fotos zum Wischen (passt / passt nicht). Reine Funktionen (getestet).

export interface Term {
  label: string;
  /** Woher der Begriff kommt – für die Anzeige */
  source: "foto" | "name" | "suche";
  /** Zusatz für die Anzeige, z. B. wie oft es vorkommt */
  note?: string;
}

/**
 * Fotos zum Wischen: abwechselnd sichere Treffer (vorne in der Rangliste) und unsichere (weiter hinten –
 * dort lernt die Suche am meisten). Schon bewertete fallen weg.
 */
export function pickCards(ranked: string[], voted: Set<string>, n = 12, random: () => number = Math.random): string[] {
  const open = ranked.filter((k) => !voted.has(k));
  const sure = open.slice(0, 30);
  const unsure = open.slice(30);
  const take = (list: string[]) => (list.length ? list.splice(Math.floor(random() * Math.min(list.length, 15)), 1)[0] : undefined);
  const out: string[] = [];
  while (out.length < n && (sure.length || unsure.length)) {
    const k = out.length % 2 === 0 ? (take(sure) ?? take(unsure)) : (take(unsure) ?? take(sure));
    if (k) out.push(k);
  }
  return out;
}

/**
 * Welche Begriffe kommen auf deinen Fotos oft vor? Für jedes Foto zählen die `topK` Begriffe, die am
 * besten passen (wie eine Einordnung). Ergebnis: Index des Begriffs + Anzahl Fotos, häufigste zuerst.
 * `yieldEvery` gibt zwischendurch die Kontrolle ab, damit die App bedienbar bleibt.
 */
export async function frequentConcepts(
  concepts: Float32Array[],
  photos: Float32Array[],
  { topK = 3, minShare = 0.01, yieldEvery = 100 }: { topK?: number; minShare?: number; yieldEvery?: number } = {},
): Promise<{ index: number; count: number }[]> {
  const counts = new Array<number>(concepts.length).fill(0);
  const scores = new Float32Array(concepts.length);
  for (let p = 0; p < photos.length; p++) {
    const v = photos[p];
    for (let c = 0; c < concepts.length; c++) {
      const w = concepts[c];
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * w[i];
      scores[c] = s;
    }
    // Die besten topK finden (topK ist klein)
    const best: number[] = [];
    for (let c = 0; c < concepts.length; c++) {
      if (best.length < topK) best.push(c);
      else {
        let worst = 0;
        for (let j = 1; j < best.length; j++) if (scores[best[j]] < scores[best[worst]]) worst = j;
        if (scores[c] > scores[best[worst]]) best[worst] = c;
      }
    }
    for (const c of best) counts[c]++;
    if (yieldEvery && p % yieldEvery === yieldEvery - 1) await new Promise((r) => setTimeout(r, 0));
  }
  const min = Math.max(2, Math.ceil(photos.length * minShare));
  return counts
    .map((count, index) => ({ index, count }))
    .filter((c) => c.count >= min)
    .sort((a, b) => b.count - a.count);
}

/** Zufällige Stichprobe (ohne Zurücklegen). */
export function sample<T>(list: T[], n: number, random: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
