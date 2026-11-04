// KI-SUCHE (Test): Suchtext → Vektor (auf dem Gerät) → ähnlichste Fotos aus dem lokalen Index.
// Dazu: Feedback (👍/👎), „Ähnliche Fotos“ und Gruppen fast gleicher Fotos – alles nur mit dem Index, ohne Modell.
import type { Item } from "../lib/types";
import { catalog } from "./catalog";
import { embedText } from "./engine";
import { nameWords, toEnglish } from "./dict";
import { learnedNames, prototypeOf, rankByName } from "./names";
import { inFolder, parseQuery } from "./query";
import { applyFeedback, groupSimilar, rank } from "./rank";
import { allFeedback, allVectors, deleteFeedback, itemKey, putFeedback, type Feedback } from "./store";

export interface AiResult {
  items: Item[];
  /** So hat die KI die Suche verstanden (nach dem Wörterbuch). */
  english: string;
  indexed: number;
  /** Vektor der Suche – für 👍/👎 */
  q: Float32Array;
  /** Bisherige Bewertungen dieser Suche: Foto-Schlüssel → +1/−1 */
  votes: Map<string, 1 | -1>;
  /** Filter aus dem Suchtext („O: Ferien“, „Video“) */
  folder: string | null;
  video: boolean;
  /** Nur gefiltert, ohne Beschreibung → neueste zuerst, keine 👍/👎 */
  filterOnly: boolean;
  /** Gelernte Namen, die in dieser Suche vorkamen (mit Anzahl gelobter Fotos) */
  names: { label: string; count: number }[];
}

let vectors: { at: number; map: Map<string, Float32Array> } | null = null;
let feedback: Feedback[] | null = null;

/** Index höchstens alle 30 s neu lesen (er wächst nebenbei). */
async function loadVectors(): Promise<Map<string, Float32Array>> {
  if (!vectors || Date.now() - vectors.at > 30_000) vectors = { at: Date.now(), map: await allVectors() };
  return vectors.map;
}

const feedbackId = (english: string, key: string) => `${english.toLowerCase()}|${key}`;

/** Index ohne die Fotos bestimmter Konten (z. B. private). Schlüssel = "konto/datei". */
function without(map: Map<string, Float32Array>, accounts?: Set<string>): Map<string, Float32Array> {
  if (!accounts?.size) return map;
  return new Map([...map].filter(([k]) => !accounts.has(k.slice(0, k.indexOf("/")))));
}

/** Konten mit der Rolle „Privat“. */
export const privateAccounts = (accounts: { id: string; role: string }[]) =>
  new Set(accounts.filter((a) => a.role === "privat").map((a) => a.id));

export async function aiSearch(query: string, { exclude }: { exclude?: Set<string> } = {}): Promise<AiResult> {
  const { text, folder, video } = parseQuery(query);
  // Bisherige Bewertungen wirken immer – der Schalter in den Einstellungen blendet nur die 👍/👎-Knöpfe aus
  const [all, fb, items] = await Promise.all([loadVectors(), feedback ?? allFeedback().catch(() => []), catalog()]);
  feedback = fb;

  // Filter: Ordner und/oder nur Videos
  const allowed = (it: Item) => (!folder || inFolder(it.path, folder)) && (!video || !!it.mime_type?.startsWith("video/"));
  let map = without(all, exclude);
  if (folder || video) map = new Map([...map].filter(([k]) => { const it = items.get(k); return !!it && allowed(it); }));
  const base = { folder, video, votes: new Map<string, 1 | -1>(), names: [] as AiResult["names"] };

  // Nur Filter, keine Beschreibung → alle passenden Fotos/Videos, neueste zuerst (auch noch nicht gelernte)
  if (!text) {
    const hidden = exclude ?? new Set<string>();
    const list = [...items.values()]
      .filter((it) => allowed(it) && !hidden.has(it.account_id))
      .sort((a, b) => (b.taken_at ?? "").localeCompare(a.taken_at ?? ""));
    return { ...base, items: list.slice(0, 60), english: "", indexed: list.length, q: new Float32Array(0), filterOnly: true };
  }

  // Gelernte Namen („Luca“, „Pikachu“): Fotos, die wie die gelobten aussehen
  const learned = learnedNames(fb);
  const known = nameWords(text)
    .map((n) => learned.get(n))
    .filter((n): n is NonNullable<typeof n> => !!n && n.keys.some((k) => all.has(k)));
  if (known.length) {
    const keys = [...new Set(known.flatMap((n) => n.keys))];
    const proto = prototypeOf(keys, all)!;
    base.names = known.map((n) => ({ label: n.label, count: n.keys.filter((k) => all.has(k)).length }));
    const isName = new Set(known.flatMap((n) => n.name.split(" ")));
    const rest = text
      .split(/\s+/)
      .filter((w) => !isName.has(w.toLowerCase().replace(/[^\p{L}'-]/gu, "")))
      .join(" ")
      .trim();
    const restEnglish = rest ? toEnglish(rest).trim() : "";
    const label = known.map((n) => n.label).join(" ");
    const english = restEnglish ? `${label} ${restEnglish}` : text.trim();
    const sameQuery = (f: Feedback) => f.english.toLowerCase() === english.toLowerCase();
    for (const f of fb) if (sameQuery(f)) base.votes.set(f.key, f.vote);
    const adjust = { boost: new Map<string, number>(), hide: new Set(fb.filter((f) => sameQuery(f) && f.vote < 0).map((f) => f.key)) };
    const byName = rankByName(proto, keys.filter((k) => map.has(k)), map, { limit: restEnglish ? 400 : 30, adjust });

    if (!restEnglish) {
      return { ...base, items: byName.map((h) => items.get(h.key)).filter((x): x is Item => !!x), english, indexed: map.size, q: proto, filterOnly: false };
    }
    // Name + Beschreibung („Luca am Strand“): unter den Fotos des Namens nach der Beschreibung sortieren
    const { vec } = await embedText(rest);
    const sub = new Map(byName.map((h) => [h.key, map.get(h.key)!]));
    let hits = rank(vec, sub, { limit: 30, adjust });
    if (!hits.length) hits = byName.slice(0, 30);
    return { ...base, items: hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x), english, indexed: sub.size, q: vec, filterOnly: false };
  }

  const { vec, english, kvecs } = await embedText(text);
  // Feedback dieser und ähnlicher Suchen einrechnen. Gleiche Suche = immer voll (auch wenn sie früher
  // anders ans Modell gestellt wurde und der gespeicherte Vektor darum leicht abweicht)
  const same = english.toLowerCase();
  const fbNow = fb.map((f) => (f.english.toLowerCase() === same ? { ...f, q: vec } : f));
  const { query: q2, adjust } = applyFeedback(vec, fbNow, map);
  const hits = rank(q2, map, { limit: 30, adjust, keywords: kvecs }); // wenige Vorschaubilder = wenig Speicher
  for (const f of fb) if (f.english.toLowerCase() === english.toLowerCase()) base.votes.set(f.key, f.vote);
  return {
    ...base,
    items: hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x),
    english,
    indexed: map.size,
    q: vec,
    filterOnly: false,
  };
}

/** 👍/👎 speichern; null nimmt die Bewertung zurück. */
export async function vote(result: Pick<AiResult, "q" | "english">, item: Item, value: 1 | -1 | null) {
  const key = itemKey(item);
  const id = feedbackId(result.english, key);
  if (value === null) await deleteFeedback(id);
  else await putFeedback({ id, q: result.q, english: result.english, key, vote: value, at: Date.now() });
  feedback = null; // beim nächsten Suchen neu lesen
}

/** Fotos, die diesem am ähnlichsten sehen. null = Foto ist noch nicht gelernt. */
export async function similarTo(item: Item, { exclude }: { exclude?: Set<string> } = {}): Promise<Item[] | null> {
  const [all, items] = await Promise.all([loadVectors(), catalog()]);
  const v = all.get(itemKey(item));
  const map = without(all, exclude);
  if (!v) return null;
  // Bild-zu-Bild: sehr ähnlich ≈ 0.9+, gleiche Art Szene ≈ 0.8, Unpassendes ≈ 0.5–0.7
  const hits = rank(v, map, { limit: 40, floor: 0.72, window: 0.25, skip: itemKey(item) });
  return hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x);
}

/** Gruppen fast gleicher Fotos, die NICHT schon exakt gleich sind (die zeigt die normale Duplikat-Suche). */
export async function similarGroups(): Promise<Item[][]> {
  const [map, items] = await Promise.all([loadVectors(), catalog(true)]);
  // Nach Aufnahmezeit (sonst Name) sortiert: Serienbilder liegen so nebeneinander
  const entries = [...items.values()]
    .filter((it) => map.has(itemKey(it)))
    .sort((a, b) => (a.taken_at ?? "").localeCompare(b.taken_at ?? "") || a.name.localeCompare(b.name))
    .map((it) => ({ key: itemKey(it), vec: map.get(itemKey(it))! }));
  const groups = await groupSimilar(entries);
  return groups
    .map((g) => g.map((k) => items.get(k)).filter((x): x is Item => !!x))
    .filter((g) => g.length > 1 && new Set(g.map((i) => i.md5 ?? i.drive_id)).size > 1);
}

// ---- Namen von der Foto-Ansicht aus ----

/** Namen, die diesem Foto gegeben wurden (👍 bei einer Suche mit dem Namen). */
export async function namesOf(item: Item): Promise<string[]> {
  const key = itemKey(item);
  const fb = await allFeedback();
  const names = learnedNames(fb.filter((f) => f.key === key));
  return [...names.values()].map((n) => n.label);
}

/** Alle gelernten Namen mit Anzahl Fotos (neueste zuletzt). */
export async function allNames(): Promise<{ name: string; label: string; count: number }[]> {
  const names = learnedNames(await allFeedback());
  return [...names.values()].map((n) => ({ name: n.name, label: n.label, count: n.keys.length }));
}

/** Diesem Foto einen Namen geben. false = Foto ist noch nicht gelernt. */
export async function giveName(item: Item, name: string): Promise<boolean> {
  const label = name.trim().replace(/\s+/g, " ");
  if (!label) return false;
  const key = itemKey(item);
  const v = (await loadVectors()).get(key) ?? (await allVectors()).get(key);
  if (!v) return false;
  await putFeedback({ id: feedbackId(label, key), q: v, english: label, key, vote: 1, at: Date.now() });
  feedback = null;
  return true;
}

/** Namen von einem Foto entfernen (oder mit item = null: Namen ganz vergessen). */
export async function removeName(item: Item | null, name: string) {
  const n = name.toLowerCase();
  const key = item ? itemKey(item) : null;
  const fb = await allFeedback();
  for (const f of fb) {
    if (key && f.key !== key) continue;
    if (nameWords(f.english).includes(n.trim().replace(/\s+/g, " "))) await deleteFeedback(f.id);
  }
  feedback = null;
}
