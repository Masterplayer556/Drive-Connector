// Reine Funktionen für Namen, Sortierung und Nummerierung (getestet in naming.test.ts).

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/** Natürliche Sortierung: 2.png vor 10.png, Gross/Klein egal. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export function splitExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

/** Zahl, wenn der Name (ohne Endung) nur aus Ziffern besteht – z. B. "0080.png" → 80. */
export function pureNumber(name: string): number | null {
  const { base } = splitExt(name);
  return /^[0-9]{1,15}$/.test(base) ? Number(base) : null;
}

/** Höchste reine Zahl unter den Namen, 0 wenn keine. */
export function maxNumber(names: Iterable<string>): number {
  let max = 0;
  for (const n of names) {
    const v = pureNumber(n);
    if (v !== null && v > max) max = v;
  }
  return max;
}

export function childKey(parentKey: string, name: string): string {
  const n = name.toLowerCase();
  return parentKey ? `${parentKey}/${n}` : n;
}

export function childPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Zahlen-Schutz (Regel 14): neuer Name im Format Foto_JJJJ-MM-TT_HH-MM-SS.ext,
 * bei Gleichstand mit _2, _3 … – "taken" enthält belegte Namen in Kleinbuchstaben.
 */
export function protectedName(original: string, now: Date, taken: Set<string>): string {
  const { ext } = splitExt(original);
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  let name = `Foto_${stamp}${ext}`;
  let i = 2;
  while (taken.has(name.toLowerCase())) {
    name = `Foto_${stamp}_${i}${ext}`;
    i++;
  }
  return name;
}

export function validFolderName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Name fehlt";
  if (n.includes("/")) return "Der Name darf kein „/“ enthalten";
  if (n.length > 200) return "Name ist zu lang";
  return null;
}
