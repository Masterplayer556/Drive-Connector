// KI-SUCHE (Test): Suchtext → Vektor (auf dem Gerät) → ähnlichste Fotos aus dem lokalen Index.
// Dazu: Feedback (👍/👎), „Ähnliche Fotos“ und Gruppen fast gleicher Fotos – alles nur mit dem Index, ohne Modell.
import type { Item } from "../lib/types";
import { catalog } from "./catalog";
import { MODELS, type ModelId } from "./protocol";
import { syncDown } from "./cloud";
import { aiModel, inTestFolders, testFolders } from "./flag";
import { embedConcepts, embedText } from "./engine";
import { conceptVocabulary, nameWords, toEnglish } from "./dict";
import { expandNameKeys, FOLDER_KEY, folderKey, isFolderKey, learnedNames, prototypeOf, rankByName } from "./names";
import { inFolder, parseQuery } from "./query";
import { frequentConcepts, pickCards, sample, type Term } from "./train";
import { allTags, inheritsTag, loadFolderTags, loadTags, markerColor, tagHits, tagKey } from "../lib/tags";
import { applyFeedback, groupSimilar, rank } from "./rank";
import { allFeedback, allVectors, deleteFeedback, getMeta, itemKey, putFeedback, putMeta, type Feedback } from "./store";

export interface AiResult {
  items: Item[];
  /** So hat die KI die Suche verstanden (nach dem Wörterbuch). */
  english: string;
  indexed: number;
  /** Vektor der Suche – für 👍/👎 */
  q: Float32Array;
  /** Bisherige Bewertungen dieser Suche: Foto-Schlüssel → +1/−1 */
  votes: Map<string, 1 | -1>;
  /** Filter aus dem Suchtext („O: Ferien“, „Video“, „#Tag“) */
  folder: string | null;
  video: boolean;
  tag: string | null;
  /** Nur gefiltert, ohne Beschreibung → neueste zuerst, keine 👍/👎 */
  filterOnly: boolean;
  /** Gelernte Namen, die in dieser Suche vorkamen (mit Anzahl gelobter Fotos) */
  names: { label: string; count: number }[];
  /** Eigene Tags in der Suche, deren Fotos der KI als Beispiele helfen */
  tagHelp: { label: string; count: number }[];
}

let vectors: { at: number; model: string; map: Map<string, Float32Array> } | null = null;
let feedback: Feedback[] | null = null;

/** Index höchstens alle 30 s neu lesen (er wächst nebenbei). */
async function loadVectors(): Promise<Map<string, Float32Array>> {
  // Neu lesen, wenn älter als 30 s oder das Modell gewechselt hat
  if (!vectors || vectors.model !== aiModel() || Date.now() - vectors.at > 30_000) {
    vectors = { at: Date.now(), model: aiModel(), map: await allVectors() };
  }
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
  const { text, folder, video, tag } = parseQuery(query);
  // Bisherige Bewertungen wirken immer – der Schalter in den Einstellungen blendet nur die 👍/👎-Knöpfe aus
  const [all, fb, items] = await Promise.all([loadVectors(), feedback ?? allFeedback().catch(() => []), catalog()]);
  feedback = fb;

  // Filter: Ordner, nur Videos, eigener Tag
  const [tagged, tagFolders] = tag ? await Promise.all([loadTags(), loadFolderTags()]) : [null, []];
  const hasTag = (it: Item) =>
    !tag || (tagged?.get(tagKey(it)) ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()) || inheritsTag(it.path, tag, tagFolders);
  const allowed = (it: Item) => (!folder || inFolder(it.path, folder)) && (!video || !!it.mime_type?.startsWith("video/")) && hasTag(it);
  let map = without(all, exclude);
  if (folder || video || tag) map = new Map([...map].filter(([k]) => { const it = items.get(k); return !!it && allowed(it); }));
  const base = { folder, video, tag, votes: new Map<string, 1 | -1>(), names: [] as AiResult["names"], tagHelp: [] as AiResult["tagHelp"] };

  // Nur Filter, keine Beschreibung → alle passenden Fotos/Videos, neueste zuerst (auch noch nicht gelernte)
  if (!text) {
    const hidden = exclude ?? new Set<string>();
    const list = [...items.values()]
      .filter((it) => allowed(it) && !hidden.has(it.account_id))
      .sort((a, b) => (b.taken_at ?? "").localeCompare(a.taken_at ?? ""));
    return { ...base, items: list.slice(0, 60), english: "", indexed: list.length, q: new Float32Array(0), filterOnly: true };
  }

  // Eigene Tags in der Suche („Ferien“, auch ohne #): ihre Fotos sind Beispiele für die KI
  const tagEx = (await tagExamples(text, items)).map((t) => ({ ...t, keys: t.keys.filter((k) => all.has(k)) })).filter((t) => t.keys.length);

  // Gelernte Namen („Luca“, „Pikachu“): Fotos, die wie die gelobten aussehen
  const learned = learnedNames(fb);
  // Tags mit einem Namen (Wort, das das Modell nicht kennt) wirken wie gelernte Namen
  for (const t of tagEx) {
    if (nameWords(t.label).join(" ") !== t.name) continue;
    const n = learned.get(t.name);
    learned.set(t.name, { name: t.name, label: n?.label ?? t.label, keys: [...new Set([...(n?.keys ?? []), ...t.keys])] });
  }
  const fileList = filesOf(items);
  const known = nameWords(text)
    .map((n) => learned.get(n))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => ({ ...n, keys: expandNameKeys(n.keys, fileList) })) // verknüpfte Ordner → ihre Fotos
    .filter((n) => n.keys.some((k) => all.has(k)));
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
  const fbNow: { q: Float32Array; key: string; vote: 1 | -1 }[] = fb.map((f) => (f.english.toLowerCase() === same ? { ...f, q: vec } : f));
  // Getaggte Fotos zählen wie ein 👍 für diese Suche (schiebt die Suche zu ihnen hin, sie kommen nach oben)
  for (const t of tagEx) {
    if (nameWords(t.label).join(" ") === t.name) continue; // schon als Name berücksichtigt
    base.tagHelp.push({ label: t.label, count: t.keys.length });
    for (const k of t.keys.slice(0, 300)) fbNow.push({ q: vec, key: k, vote: 1 });
  }
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
export async function allNames(): Promise<{ name: string; label: string; count: number; folders: string[] }[]> {
  const [names, items] = await Promise.all([allFeedback().then(learnedNames), catalog().catch(() => new Map<string, Item>())]);
  const files = filesOf(items);
  return [...names.values()].map((n) => ({
    name: n.name,
    label: n.label,
    count: expandNameKeys(n.keys, files).length,
    folders: n.keys.filter(isFolderKey).map((k) => k.slice(FOLDER_KEY.length)),
  }));
}

/** [Schlüssel, Pfad] aller Fotos – zum Auflösen verknüpfter Ordner. */
function filesOf(items: Map<string, Item>): [string, string | null][] {
  return [...items].map(([k, it]) => [k, it.path]);
}

// ---- Ordner: mit Namen verknüpfen, passende Fotos ausserhalb finden ----

/** Namen, mit denen dieser Ordner verknüpft ist. */
export async function folderNames(path: string): Promise<string[]> {
  const key = folderKey(path).toLowerCase();
  const fb = (await allFeedback()).filter((f) => f.key.toLowerCase() === key && f.vote === 1);
  return [...new Set(fb.map((f) => f.english))];
}

/** Ordner mit einem Namen verknüpfen: alle Fotos darin (auch spätere) zählen für die Suche nach dem Namen. */
export async function linkFolderName(path: string, name: string) {
  const label = name.trim().replace(/\s+/g, " ");
  if (!label) return;
  const key = folderKey(path);
  await putFeedback({ id: feedbackId(label, key), q: new Float32Array(0), english: label, key, vote: 1, at: Date.now() });
  feedback = null;
}

export async function unlinkFolderName(path: string, name: string) {
  await deleteFeedback(feedbackId(name, folderKey(path)));
  feedback = null;
}

/**
 * Fotos ausserhalb des Ordners, die aussehen wie die darin – z. B. weitere Bilder einer Figur,
 * die noch woanders liegen. null = im Ordner ist noch nichts gelernt.
 */
export async function similarToFolder(path: string, { exclude }: { exclude?: Set<string> } = {}): Promise<{ items: Item[]; learned: number } | null> {
  const [all, items] = await Promise.all([loadVectors(), catalog()]);
  const prefix = `${path.toLowerCase()}/`;
  const inside = [...items].filter(([, it]) => it.path?.toLowerCase().startsWith(prefix)).map(([k]) => k);
  const proto = prototypeOf(inside, all);
  if (!proto) return null;
  const skip = new Set(inside);
  const outside = new Map([...without(all, exclude)].filter(([k]) => !skip.has(k)));
  const hits = rank(proto, outside, { limit: 60, floor: 0.72, window: 0.2 });
  return { items: hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x), learned: inside.filter((k) => all.has(k)).length };
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

// ---- KI trainieren (Wischen: passt / passt nicht) ----

const CONCEPTS_KEY = "concepts";
const RANK_KEY = "concept-rank";
const DAY = 24 * 3600_000;

/**
 * Begriffe zum Trainieren: was auf deinen Fotos oft vorkommt (die KI ordnet eine Stichprobe deiner Fotos
 * rund 600 Begriffen zu und zählt), dazu deine gelernten Namen. Beim ersten Mal werden die Begriffe einmal
 * durchs Textmodell geschickt (dauert etwas, wird gespeichert); die Zählung gilt einen Tag.
 */
export async function trainingTerms(onProgress?: (msg: string) => void): Promise<Term[]> {
  const [fb, all] = await Promise.all([allFeedback(), loadVectors()]);
  const names: Term[] = [...learnedNames(fb).values()].map((n) => ({ label: n.label, source: "name", note: "Gelernter Name" }));

  type Ranked = { en: string; de: string; share: number };
  const cached = await getMeta<{ at: number; photos: number; terms: Ranked[] }>(RANK_KEY).catch(() => undefined);
  let ranked: Ranked[] | null =
    cached && Date.now() - cached.at < DAY && Math.abs(cached.photos - all.size) <= all.size * 0.1 ? cached.terms : null;

  if (!ranked && all.size >= 20) {
    const vocab = conceptVocabulary();
    let cv = await getMeta<{ labels: string[]; vecs: Float32Array[] }>(CONCEPTS_KEY).catch(() => undefined);
    if (!cv || cv.labels.length !== vocab.length || cv.labels.some((l, i) => l !== vocab[i].en)) {
      const vecs = await embedConcepts(
        vocab.map((v) => v.en),
        (d) => onProgress?.(`Begriffe vorbereiten (nur beim ersten Mal) … ${Math.round((d / vocab.length) * 100)} %`),
      );
      cv = { labels: vocab.map((v) => v.en), vecs };
      await putMeta(CONCEPTS_KEY, cv).catch(() => undefined);
    }
    onProgress?.("Deine Fotos durchsehen …");
    const photos = sample([...all.values()], 1500);
    const freq = await frequentConcepts(cv.vecs, photos);
    ranked = freq.slice(0, 40).map((f) => ({ en: vocab[f.index].en, de: vocab[f.index].de, share: f.count / photos.length }));
    await putMeta(RANK_KEY, { at: Date.now(), photos: all.size, terms: ranked }).catch(() => undefined);
  }

  const concepts: Term[] = (ranked ?? []).map((t) => ({
    label: t.en,
    source: "foto",
    note: `${t.de} · bei ca. ${Math.max(1, Math.round(t.share * 100))} % deiner Fotos`,
  }));
  // Häufige Begriffe zuerst, gelernte Namen dazwischen (nach jedem dritten)
  const out: Term[] = [];
  const seen = new Set<string>();
  const push = (t: Term) => !seen.has(t.label.toLowerCase()) && (seen.add(t.label.toLowerCase()), out.push(t));
  let ni = 0;
  concepts.forEach((t, i) => {
    push(t);
    if (i % 3 === 2 && ni < names.length) push(names[ni++]);
  });
  names.slice(ni).forEach(push);
  return out;
}

export interface TrainingBatch {
  term: string;
  /** So wird bewertet (gleich wie bei der Suche) */
  english: string;
  q: Float32Array;
  items: Item[];
}

/**
 * Fotos zum Wischen für einen Begriff (das nächste Paket). null = der Begriff passt zu keinem Foto gut
 * genug oder alle passenden sind schon bewertet. `skip` = schon gezeigte Fotos (Schlüssel wie im Index).
 */
export async function trainingBatch(
  term: string,
  { exclude, skip, n = 12 }: { exclude?: Set<string>; skip?: Set<string>; n?: number } = {},
): Promise<TrainingBatch | null> {
  const [all, fb, items] = await Promise.all([loadVectors(), allFeedback(), catalog()]);
  const map = without(all, exclude);
  const learned = learnedNames(fb);
  const runs = nameWords(term);
  const name = runs.length === 1 && runs[0] === term.trim().toLowerCase().replace(/\s+/g, " ") ? learned.get(runs[0]) : undefined;

  let q: Float32Array;
  let english: string;
  let ranked: string[];
  if (name) {
    // Gelernter Name: Fotos, die wie die bisherigen aussehen
    const keys = expandNameKeys(name.keys, filesOf(items));
    const proto = prototypeOf(keys, all);
    if (!proto) return null;
    q = proto;
    english = term.trim();
    const liked = new Set(keys);
    ranked = rank(proto, map, { limit: 600, floor: 0.6, window: 1 }).map((h) => h.key).filter((k) => !liked.has(k));
  } else {
    const e = await embedText(term);
    q = e.vec;
    english = e.english;
    const hits = rank(q, map, { limit: 600, floor: 0, window: 1, keywords: e.kvecs });
    if (!hits.length || hits[0].score < 0.2) return null; // passt zu nichts in deiner Ablage
    ranked = hits.map((h) => h.key);
  }
  // Schon bewertet oder in dieser Runde schon gezeigt (auch „weiss nicht“) → nicht nochmals
  const voted = new Set(fb.filter((f) => f.english.toLowerCase() === english.toLowerCase()).map((f) => f.key));
  skip?.forEach((k) => voted.add(k));
  const cards = pickCards(ranked, voted, n);
  if (!cards.length) return null;
  return { term, english, q, items: cards.map((k) => items.get(k)).filter((x): x is Item => !!x) };
}

/**
 * Eigene Tags, die in der Suche vorkommen (ganzes Wort, ohne #; keine Merkzeichen-Farben), mit ihren
 * Fotos – direkt getaggt oder in einem getaggten Ordner. Schlüssel im Format des KI-Index.
 */
async function tagExamples(text: string, items: Map<string, Item>): Promise<{ name: string; label: string; keys: string[] }[]> {
  const [byItem, folders] = await Promise.all([loadTags(), loadFolderTags()]).catch(
    (): [Map<string, string[]>, { tag: string; path: string }[]] => [new Map(), []],
  );
  const hits = tagHits(text, allTags().filter((t) => !markerColor(t.tag)));
  return hits
    .map((h) => {
      const low = h.tag.toLowerCase();
      const keys: string[] = [];
      for (const [k, it] of items) {
        const direct = (byItem.get(tagKey(it)) ?? []).some((t) => t.toLowerCase() === low);
        if (direct || inheritsTag(it.path, h.tag, folders)) keys.push(k);
      }
      return { name: low, label: h.tag, keys };
    })
    .filter((t) => t.keys.length);
}

// ---- Vergleich der Modelle (nur Testordner, ohne 👍/👎, Namen und Tags – reiner Modellvergleich) ----

export interface CompareSide {
  items: Item[];
  /** So viele Fotos aus den Testordnern hat dieses Modell schon gelernt */
  learned: number;
}

export async function compareModels(
  query: string,
  left: ModelId,
  right: ModelId,
  { exclude }: { exclude?: Set<string> } = {},
): Promise<{ english: string; left: CompareSide; right: CompareSide }> {
  const folders = testFolders();
  const items = await catalog();
  const inTest = new Set([...items].filter(([, it]) => inTestFolders(it.path, folders)).map(([k]) => k));
  const side = async (model: ModelId): Promise<CompareSide & { english: string }> => {
    // Was der PC gelernt hat, zuerst holen (auch wenn gerade ein anderes Modell gewählt ist)
    if (MODELS[model].cloud) await syncDown(model).catch(() => 0);
    const all = without(await allVectors(model), exclude);
    const map = new Map([...all].filter(([k]) => inTest.has(k)));
    if (!map.size) return { items: [], learned: 0, english: "" };
    const { vec, english, kvecs } = await embedText(query, model);
    const hits = rank(vec, map, { limit: 12, keywords: kvecs });
    return { items: hits.map((h) => items.get(h.key)).filter((x): x is Item => !!x), learned: map.size, english };
  };
  // Nacheinander, nicht gleichzeitig (Arbeitsspeicher)
  const l = await side(left);
  const r = await side(right);
  return { english: l.english || r.english, left: l, right: r };
}
