// KI-SUCHE (Test): kleines Wörterbuch Deutsch → Englisch für Suchbegriffe.
// Ersetzt das Übersetzungsmodell (~100 MB+ Arbeitsspeicher). Das Bildmodell versteht Englisch am besten;
// unbekannte Wörter (Namen, englische Wörter, Zahlen) bleiben einfach stehen.

const W: Record<string, string> = {
  // Füllwörter / Verbindungen
  der: "", die: "", das: "", den: "", dem: "", des: "", ein: "a", eine: "a", einen: "a", einem: "a", einer: "a",
  im: "in the", in: "in", am: "at the", an: "at", auf: "on", unter: "under", über: "over", vor: "in front of",
  hinter: "behind", neben: "next to", zwischen: "between", mit: "with", ohne: "without", und: "and", oder: "or",
  bei: "at", beim: "at the", von: "of", vom: "from the", zum: "to the", zur: "to the", aus: "from", nach: "after",
  viele: "many", viel: "lots of", wenig: "few", zwei: "two", drei: "three", vier: "four", fünf: "five",
  // Tiere
  hund: "dog", hunde: "dogs", katze: "cat", katzen: "cats", pferd: "horse", pferde: "horses", vogel: "bird",
  vögel: "birds", fisch: "fish", fische: "fish", kuh: "cow", kühe: "cows", schaf: "sheep", schafe: "sheep",
  hase: "rabbit", kaninchen: "rabbit", maus: "mouse", ente: "duck", enten: "ducks", huhn: "chicken", hühner: "chickens",
  schwein: "pig", ziege: "goat", bär: "bear", löwe: "lion", tiger: "tiger", elefant: "elephant", affe: "monkey",
  giraffe: "giraffe", insekt: "insect", schmetterling: "butterfly", biene: "bee", spinne: "spider", schlange: "snake",
  tier: "animal", tiere: "animals", haustier: "pet", welpe: "puppy", kätzchen: "kitten", eichhörnchen: "squirrel",
  // Menschen
  mensch: "person", menschen: "people", leute: "people", person: "person", personen: "people", mann: "man",
  männer: "men", frau: "woman", frauen: "women", kind: "child", kinder: "children", baby: "baby", junge: "boy",
  mädchen: "girl", familie: "family", freunde: "friends", gruppe: "group", gruppenfoto: "group photo",
  selfie: "selfie", gesicht: "face", hand: "hand", hände: "hands", lächeln: "smile", lachen: "laughing",
  brille: "glasses", hut: "hat", mütze: "cap", jacke: "jacket", kleid: "dress", schuhe: "shoes", hemd: "shirt",
  // Natur, Wetter, Landschaft
  strand: "beach", meer: "sea", see: "lake", fluss: "river", wasser: "water", welle: "wave", wellen: "waves",
  berg: "mountain", berge: "mountains", wald: "forest", baum: "tree", bäume: "trees", blume: "flower",
  blumen: "flowers", gras: "grass", wiese: "meadow", feld: "field", garten: "garden", park: "park", wüste: "desert",
  insel: "island", himmel: "sky", wolke: "cloud", wolken: "clouds", sonne: "sun", mond: "moon", sterne: "stars",
  regen: "rain", schnee: "snow", eis: "ice", nebel: "fog", gewitter: "thunderstorm", regenbogen: "rainbow",
  sonnenuntergang: "sunset", sonnenaufgang: "sunrise", nacht: "night", abend: "evening", morgen: "morning",
  winter: "winter", sommer: "summer", frühling: "spring", herbst: "autumn", laub: "autumn leaves", stein: "stone",
  steine: "rocks", landschaft: "landscape", natur: "nature", wasserfall: "waterfall", höhle: "cave", gletscher: "glacier",
  // Orte, Gebäude, Verkehr
  stadt: "city", dorf: "village", haus: "house", häuser: "houses", gebäude: "building", kirche: "church",
  schloss: "castle", burg: "castle", brücke: "bridge", strasse: "street", straße: "street", weg: "path",
  zimmer: "room", küche: "kitchen", bad: "bathroom", schlafzimmer: "bedroom", wohnzimmer: "living room",
  bett: "bed", tisch: "table", stuhl: "chair", sofa: "sofa", fenster: "window", tür: "door", treppe: "stairs",
  schule: "school", klasse: "classroom", schulzimmer: "classroom", büro: "office", laden: "shop", restaurant: "restaurant",
  bahnhof: "train station", flughafen: "airport", hotel: "hotel", spital: "hospital", krankenhaus: "hospital",
  auto: "car", autos: "cars", bus: "bus", zug: "train", tram: "tram", velo: "bicycle", fahrrad: "bicycle",
  motorrad: "motorcycle", flugzeug: "airplane", schiff: "ship", boot: "boat", lastwagen: "truck",
  // Essen
  essen: "food", mahlzeit: "meal", frühstück: "breakfast", mittagessen: "lunch", abendessen: "dinner",
  pizza: "pizza", burger: "burger", pasta: "pasta", nudeln: "noodles", salat: "salad", suppe: "soup",
  brot: "bread", kuchen: "cake", torte: "cake", glace: "ice cream", eiscreme: "ice cream", schokolade: "chocolate",
  obst: "fruit", früchte: "fruits", apfel: "apple", banane: "banana", gemüse: "vegetables", fleisch: "meat",
  kaffee: "coffee", tee: "tea", getränk: "drink", bier: "beer", wein: "wine", fondue: "fondue", raclette: "raclette",
  // Schule, Dokumente, Technik
  arbeitsblatt: "worksheet", blatt: "sheet of paper", papier: "paper", dokument: "document", dokumente: "documents",
  text: "text", heft: "notebook", buch: "book", bücher: "books", seite: "page", notizen: "notes", tabelle: "table chart",
  diagramm: "diagram", grafik: "chart", karte: "map", landkarte: "map", formel: "formula", formeln: "math formulas",
  mathe: "math", mathematik: "math", rechnung: "math calculation", aufgabe: "exercise", prüfung: "exam", test: "exam",
  tafel: "blackboard", wandtafel: "blackboard", whiteboard: "whiteboard", handschrift: "handwriting",
  zeichnung: "drawing", skizze: "sketch", bild: "picture", plakat: "poster", quittung: "receipt", rechnungen: "invoices",
  ausweis: "id card", ticket: "ticket", screenshot: "screenshot", bildschirm: "screen", handy: "phone",
  computer: "computer", laptop: "laptop", tastatur: "keyboard", fernseher: "tv", kamera: "camera",
  // Freizeit, Anlässe
  geburtstag: "birthday", party: "party", fest: "celebration", hochzeit: "wedding", weihnachten: "christmas",
  weihnachtsbaum: "christmas tree", ostern: "easter", geschenk: "gift", geschenke: "gifts", konzert: "concert",
  ferien: "vacation", urlaub: "vacation", reise: "travel", ausflug: "trip", wandern: "hiking", wanderung: "hike",
  ski: "skiing", skifahren: "skiing", schwimmen: "swimming", fussball: "soccer", fußball: "soccer", sport: "sports",
  spiel: "game", spielplatz: "playground", zelt: "tent", feuer: "fire", feuerwerk: "fireworks", kerze: "candle",
  schneemann: "snowman", musik: "music", gitarre: "guitar", klavier: "piano",
  // Farben & Eigenschaften
  rot: "red", rote: "red", roter: "red", rotes: "red", blau: "blue", blaue: "blue", blauer: "blue", blaues: "blue",
  grün: "green", grüne: "green", grüner: "green", gelb: "yellow", gelbe: "yellow", schwarz: "black", schwarze: "black",
  weiss: "white", weiß: "white", weisse: "white", weiße: "white", grau: "grey", braun: "brown", orange: "orange",
  rosa: "pink", pink: "pink", violett: "purple", lila: "purple", bunt: "colorful", bunte: "colorful",
  gross: "big", groß: "big", grosse: "big", große: "big", klein: "small", kleine: "small", alt: "old", alte: "old",
  neu: "new", dunkel: "dark", hell: "bright", nass: "wet", leer: "empty", voll: "full", schön: "beautiful",
  lustig: "funny", süss: "cute", süß: "cute",
};

/** Suchtext grob ins Englische übertragen (Wort für Wort). */
export function toEnglish(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((word) => {
      const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}-]+)([^\p{L}\p{N}]*)$/u.exec(word);
      if (!m) return word;
      const [, pre, core, post] = m;
      const hit = W[core.toLowerCase()];
      return hit === undefined ? word : hit ? `${pre}${hit}${post}` : "";
    })
    .filter(Boolean)
    .join(" ");
}
