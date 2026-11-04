// KI-SUCHE: Wie die Suche dem Bildmodell (CLIP) gestellt wird. Reine Funktionen (getestet).
// CLIP wurde mit Bildunterschriften trainiert. Mehrere Formulierungen derselben Suche, gemittelt
// („Prompt-Ensemble“, wie im CLIP-Paper), treffen zuverlässiger als eine einzige.

const TEMPLATES = [
  "a photo of {}.",
  "a picture of {}.",
  "a close-up photo of {}.",
  "a photo showing {}.",
  "a cropped photo of {}.",
  "{}.",
];

/** „photo of a dog“ → „a dog“ (sonst würde daraus „a photo of photo of a dog“). */
export function stripPhotoWords(text: string): string {
  return text
    .trim()
    .replace(/^(?:an?\s+)?(?:photos?|pictures?|images?|pics?)\s+(?:of|with|showing)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

/** Alle Formulierungen für eine Suche. */
export function promptsFor(english: string): string[] {
  const core = stripPhotoWords(english) || english.trim();
  return TEMPLATES.map((t) => t.replace("{}", core));
}

/** Für ein einzelnes Stichwort reicht eine Formulierung (spart Rechenzeit). */
export const keywordPrompt = (keyword: string) => `a photo of ${stripPhotoWords(keyword) || keyword}.`;

// ---- Synonyme: mehrere Wörter für dasselbe – zusammen treffen sie zuverlässiger ----
const SYNONYMS: Record<string, string[]> = {
  car: ["automobile", "vehicle"],
  cars: ["automobiles", "vehicles"],
  bicycle: ["bike"],
  bike: ["bicycle"],
  motorcycle: ["motorbike"],
  truck: ["lorry"],
  child: ["kid"],
  children: ["kids"],
  kid: ["child"],
  kids: ["children"],
  boy: ["young boy"],
  girl: ["young girl"],
  man: ["guy"],
  woman: ["lady"],
  people: ["persons", "crowd"],
  dog: ["puppy", "pet dog"],
  dogs: ["puppies"],
  cat: ["kitten", "pet cat"],
  cats: ["kittens"],
  bird: ["birds"],
  sea: ["ocean"],
  ocean: ["sea"],
  beach: ["seaside", "shore"],
  lake: ["lakeside"],
  mountain: ["mountains", "alps"],
  mountains: ["alps", "peaks"],
  forest: ["woods"],
  woods: ["forest"],
  city: ["town", "cityscape"],
  street: ["road"],
  road: ["street"],
  house: ["home", "building"],
  room: ["interior"],
  food: ["meal", "dish"],
  meal: ["food", "dish"],
  drink: ["beverage"],
  phone: ["smartphone", "mobile phone"],
  smartphone: ["phone"],
  tv: ["television"],
  television: ["tv"],
  computer: ["pc", "laptop"],
  laptop: ["notebook computer"],
  screenshot: ["screen capture", "phone screenshot"],
  selfie: ["self portrait"],
  photo: ["picture"],
  picture: ["photo"],
  drawing: ["sketch", "illustration"],
  sketch: ["drawing"],
  painting: ["artwork"],
  cartoon: ["animation", "animated character"],
  anime: ["manga", "animated character"],
  character: ["cartoon character"],
  worksheet: ["school worksheet", "exercise sheet"],
  document: ["paper document", "page of text"],
  notes: ["handwritten notes"],
  handwriting: ["handwritten text"],
  receipt: ["bill"],
  ticket: ["admission ticket"],
  map: ["city map"],
  sunset: ["dusk", "evening sky"],
  sunrise: ["dawn"],
  night: ["nighttime", "dark"],
  snow: ["snowfall", "winter landscape"],
  rain: ["rainy weather"],
  party: ["celebration"],
  birthday: ["birthday party"],
  wedding: ["marriage ceremony"],
  christmas: ["xmas"],
  concert: ["live music"],
  football: ["soccer"],
  soccer: ["football"],
  game: ["video game"],
  toy: ["toys"],
  flower: ["flowers", "blossom"],
  flowers: ["blossoms"],
  tree: ["trees"],
  sky: ["clouds"],
  cake: ["dessert"],
  pizza: ["italian pizza"],
  coffee: ["cup of coffee"],
  school: ["classroom"],
  classroom: ["school class"],
  friends: ["group of friends"],
  family: ["family photo"],
  baby: ["infant"],
  cute: ["adorable"],
  funny: ["humorous", "meme"],
  meme: ["funny image"],
};

/**
 * Weitere Formulierungen mit Synonymen (höchstens `max`), z. B. „dog in the snow“ →
 * „puppy in the snow“, „dog in the snowy“ … Jedes Wort wird einzeln ersetzt.
 */
export function synonymVariants(english: string, max = 3): string[] {
  const words = english.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < max; i++) {
    const m = /^([^\p{L}]*)([\p{L}]+)([^\p{L}]*)$/u.exec(words[i]);
    if (!m) continue;
    for (const syn of SYNONYMS[m[2].toLowerCase()] ?? []) {
      if (out.length >= max) break;
      out.push([...words.slice(0, i), `${m[1]}${syn}${m[3]}`, ...words.slice(i + 1)].join(" "));
    }
  }
  return out;
}

/** Formulierungen für die ganze Suche: Grundformen + Synonym-Varianten. */
export function searchPrompts(english: string): string[] {
  const core = stripPhotoWords(english) || english.trim();
  return [...promptsFor(core), ...synonymVariants(core).map((v) => `a photo of ${v}.`)];
}

/** Formulierungen für ein Stichwort: das Wort und seine Synonyme. */
export function keywordPrompts(keyword: string): string[] {
  const core = stripPhotoWords(keyword) || keyword;
  return [keywordPrompt(core), ...synonymVariants(core, 2).map((v) => `a photo of ${v}.`)];
}

// ---- Geschriebenes Wort statt Sache: Fotos, auf denen das Suchwort nur als Text steht ----
/** Suchen, bei denen Text auf dem Bild gerade gewünscht ist – dort nichts abziehen. */
const TEXTY = /\b(text|word|words|letter|letters|writing|written|handwrit\w*|screenshot\w*|document\w*|page|sign|signs|poster|label|logo|meme\w*|receipt|ticket|worksheet\w*|notes?|book|books|menu|chat|message\w*|caption|title|quote)\b/i;

/**
 * Formulierungen für „das Wort steht nur als Text auf dem Bild“. Dieser Anteil wird von der Suche
 * abgezogen (manche Modelle finden sonst vor allem Bilder, auf denen das Wort geschrieben steht).
 * Leer, wenn die Suche selbst nach Text fragt.
 */
export function typographicPrompts(english: string): string[] {
  const core = stripPhotoWords(english) || english.trim();
  if (!core || TEXTY.test(core)) return [];
  return [`the word "${core}".`, `text that says "${core}".`, `a sign that says "${core}".`, `a screenshot with the text "${core}".`];
}
