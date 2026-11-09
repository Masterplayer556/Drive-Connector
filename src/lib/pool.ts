// Viele Aufrufe nebeneinander, aber nie mehr als `limit` gleichzeitig (z. B. 300 Fotos löschen:
// einzeln nacheinander dauert es Minuten, alle auf einmal bremst Google).

/** Wie `Promise.all(items.map(fn))`, aber mit höchstens `limit` laufenden Aufrufen. Ergebnisse in der Reihenfolge der Liste. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** So viele Schreib-Aufrufe an Google gleichzeitig (löschen, verschieben, wiederherstellen). */
export const DRIVE_PARALLEL = 5;
