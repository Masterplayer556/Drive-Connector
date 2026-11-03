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
  // ---- Erweiterung ----
  // Tiere
  hündchen: "small dog", vogelhaus: "birdhouse", taube: "pigeon", möwe: "seagull", adler: "eagle", eule: "owl",
  papagei: "parrot", frosch: "frog", schildkröte: "turtle", igel: "hedgehog", fuchs: "fox", reh: "deer",
  hirsch: "deer", wolf: "wolf", delfin: "dolphin", wal: "whale", hai: "shark", qualle: "jellyfish", krebs: "crab",
  marienkäfer: "ladybug", käfer: "beetle", ameise: "ant", wespe: "wasp", pinguin: "penguin", kamel: "camel",
  zebra: "zebra", nashorn: "rhino", krokodil: "crocodile", meerschweinchen: "guinea pig", hamster: "hamster",
  alpaka: "alpaca", lama: "llama", esel: "donkey", stier: "bull", kalb: "calf", lamm: "lamb", fohlen: "foal",
  // Menschen, Körper, Kleidung
  oma: "grandmother", opa: "grandfather", mama: "mother", papa: "father", mutter: "mother", vater: "father",
  bruder: "brother", schwester: "sister", freund: "friend", freundin: "friend", lehrer: "teacher", lehrerin: "teacher",
  schüler: "student", schülerin: "student", klassenfoto: "class photo", paar: "couple", menge: "crowd",
  haare: "hair", auge: "eye", augen: "eyes", mund: "mouth", nase: "nose", ohr: "ear", fuss: "foot", füsse: "feet",
  bein: "leg", arm: "arm", finger: "finger", bart: "beard", tattoo: "tattoo", rucksack: "backpack", tasche: "bag",
  koffer: "suitcase", uhr: "watch", armbanduhr: "wristwatch", kette: "necklace", ring: "ring", schal: "scarf",
  handschuhe: "gloves", stiefel: "boots", hose: "pants", jeans: "jeans", rock: "skirt", pullover: "sweater",
  pulli: "sweater", tshirt: "t-shirt", anzug: "suit", krawatte: "tie", badehose: "swimsuit", bikini: "bikini",
  sonnenbrille: "sunglasses", helm: "helmet", uniform: "uniform", kostüm: "costume", maske: "mask",
  // Natur
  alpen: "alps", gipfel: "summit", hügel: "hill", tal: "valley", schlucht: "gorge", felsen: "rock", fels: "rock",
  sand: "sand", düne: "dune", küste: "coast", ufer: "shore", hafen: "harbor", bach: "stream", teich: "pond",
  sumpf: "swamp", vulkan: "volcano", blätter: "leaves", ast: "branch", wurzel: "root",
  pilz: "mushroom", pilze: "mushrooms", rose: "rose", rosen: "roses", tulpe: "tulip", sonnenblume: "sunflower",
  kaktus: "cactus", palme: "palm tree", tanne: "fir tree", pflanze: "plant", pflanzen: "plants", busch: "bush",
  hecke: "hedge", kürbis: "pumpkin", blitz: "lightning", sturm: "storm", hagel: "hail", tau: "dew",
  dämmerung: "dusk", mondschein: "moonlight", sternenhimmel: "starry sky", polarlicht: "northern lights",
  // Orte, Gebäude
  hütte: "hut", berghütte: "mountain hut", stall: "barn", bauernhof: "farm", zoo: "zoo", museum: "museum",
  stadion: "stadium", kino: "cinema", theater: "theater", schwimmbad: "swimming pool", pool: "swimming pool",
  bibliothek: "library", markt: "market", supermarkt: "supermarket", einkaufszentrum: "shopping mall",
  bäckerei: "bakery", café: "cafe", cafe: "cafe", bar: "bar", turm: "tower", denkmal: "monument", brunnen: "fountain",
  platz: "square", altstadt: "old town", hochhaus: "skyscraper", wohnung: "apartment", balkon: "balcony",
  terrasse: "terrace", dach: "roof", keller: "basement", garage: "garage", flur: "hallway", gang: "hallway",
  turnhalle: "gym", sporthalle: "gym", pausenplatz: "schoolyard", schulhaus: "school building", universität: "university",
  kirchturm: "church tower", kapelle: "chapel", tempel: "temple", moschee: "mosque", ruine: "ruins",
  grenze: "border", tunnel: "tunnel", autobahn: "highway", parkplatz: "parking lot", kreuzung: "intersection",
  ampel: "traffic light", bahn: "train", bahngleis: "railway", gleis: "railway", seilbahn: "cable car",
  gondel: "gondola", sessellift: "chairlift", skilift: "ski lift", traktor: "tractor", taxi: "taxi",
  roller: "scooter", trottinett: "scooter", kinderwagen: "stroller", wohnmobil: "camper van",
  // Dinge im Haus
  schlüssel: "keys", flasche: "bottle", glas: "glass", teller: "plate", tasse: "cup", becher: "mug",
  besteck: "cutlery", messer: "knife", gabel: "fork", löffel: "spoon", pfanne: "pan", topf: "pot",
  ofen: "oven", herd: "stove", kühlschrank: "fridge", spiegel: "mirror", lampe: "lamp", kissen: "pillow",
  decke: "blanket", vorhang: "curtain", teppich: "carpet", regal: "shelf", schrank: "wardrobe",
  pult: "desk", schreibtisch: "desk", foto: "photo", rahmen: "frame", vase: "vase",
  ball: "ball", spielzeug: "toy", puppe: "doll", teddy: "teddy bear", lego: "lego", brettspiel: "board game",
  karten: "playing cards", puzzle: "puzzle", konsole: "game console", kopfhörer: "headphones",
  natel: "phone", smartphone: "phone", tablet: "tablet", ipad: "tablet",
  drucker: "printer", kabel: "cable", ladegerät: "charger", batterie: "battery", fernbedienung: "remote control",
  // Essen & Trinken
  rösti: "hash browns", käse: "cheese", wurst: "sausage", cervelat: "sausage", pommes: "french fries",
  reis: "rice", ei: "egg", eier: "eggs", gipfeli: "croissant", zopf: "braided bread", müesli: "muesli",
  joghurt: "yogurt", erdbeere: "strawberry", erdbeeren: "strawberries", kirsche: "cherry", kirschen: "cherries",
  traube: "grapes", trauben: "grapes", zitrone: "lemon", tomate: "tomato",
  tomaten: "tomatoes", kartoffel: "potato", kartoffeln: "potatoes", karotte: "carrot", rüebli: "carrot",
  gurke: "cucumber", zwiebel: "onion", knoblauch: "garlic", nuss: "nut", nüsse: "nuts",
  sushi: "sushi", kebab: "kebab", döner: "kebab", sandwich: "sandwich", grill: "barbecue", grillieren: "barbecue",
  grillen: "barbecue", steak: "steak", poulet: "chicken", hähnchen: "chicken", lachs: "salmon",
  guetzli: "cookies", kekse: "cookies", muffin: "muffin", waffel: "waffle", crêpe: "crepe", honig: "honey",
  milch: "milk", saft: "juice", wasserflasche: "water bottle", cocktail: "cocktail", sekt: "champagne",
  // Schule & Dokumente
  schulbuch: "textbook", lösung: "solution", lösungen: "solutions", vokabeln: "vocabulary", voci: "vocabulary",
  wörter: "words", französisch: "french", englisch: "english", deutsch: "german", geschichte: "history",
  geografie: "geography", geographie: "geography", biologie: "biology", bio: "biology", chemie: "chemistry",
  physik: "physics", informatik: "computer science", wirtschaft: "economics", kunst: "art", werken: "crafts",
  zusammenfassung: "summary", stundenplan: "timetable", zeugnis: "report card", note: "grade", noten: "grades",
  lineal: "ruler", taschenrechner: "calculator", bleistift: "pencil", stift: "pen", stifte: "pens",
  kugelschreiber: "pen", füller: "fountain pen", radiergummi: "eraser", schere: "scissors", leim: "glue",
  ordner: "binder", mappe: "folder", brief: "letter", vertrag: "contract", formular: "form", kalender: "calendar",
  plan: "plan", grundriss: "floor plan", liste: "list", rezept: "recipe", menükarte: "menu", speisekarte: "menu",
  schild: "sign", wegweiser: "signpost", etikett: "label", barcode: "barcode", qr: "qr code", code: "code",
  geld: "money", münze: "coin", münzen: "coins", banknote: "banknote", kreditkarte: "credit card",
  pass: "passport", reisepass: "passport", fahrkarte: "ticket", busfahrplan: "bus timetable", fahrplan: "timetable",
  präsentation: "presentation", folie: "slide", chat: "chat messages", nachricht: "message", email: "email",
  // Aktivitäten & Anlässe
  fahren: "riding", velofahren: "cycling", radfahren: "cycling", schlitteln: "sledding", schlitten: "sled",
  snowboard: "snowboard", langlauf: "cross-country skiing", tanzen: "dancing", kochen: "cooking", backen: "baking",
  lesen: "reading", schreiben: "writing", malen: "painting", basteln: "crafting", spielen: "playing",
  turnen: "gymnastics", klettern: "climbing", reiten: "horse riding", joggen: "jogging", rennen: "running",
  laufen: "running", springen: "jumping", schlafen: "sleeping", trinken: "drinking",
  fischen: "fishing", angeln: "fishing", segeln: "sailing", surfen: "surfing", tauchen: "diving",
  campen: "camping", camping: "camping", picknick: "picnic", lagerfeuer: "campfire", grillfest: "barbecue party",
  hockey: "hockey", eishockey: "ice hockey", tennis: "tennis", basketball: "basketball", volleyball: "volleyball",
  unihockey: "floorball", golf: "golf", yoga: "yoga", fitness: "gym workout", training: "training",
  match: "match", turnier: "tournament", pokal: "trophy", medaille: "medal", siegerehrung: "award ceremony",
  abschluss: "graduation", diplom: "diploma", taufe: "baptism", fasnacht: "carnival", karneval: "carnival",
  halloween: "halloween", silvester: "new year's eve", neujahr: "new year", nikolaus: "santa claus",
  adventskranz: "advent wreath", krippe: "nativity scene", luftballon: "balloon", ballone: "balloons",
  ballon: "balloon", girlande: "garland", dekoration: "decoration", deko: "decoration",
  // Eigenschaften & Stimmung
  glücklich: "happy", traurig: "sad", müde: "tired", wütend: "angry", schlafend: "sleeping",
  sonnig: "sunny", bewölkt: "cloudy", neblig: "foggy", verschneit: "snowy", stürmisch: "stormy",
  warm: "warm", kalt: "cold", heiss: "hot", heiß: "hot", ruhig: "calm", modern: "modern", historisch: "historic",
  gemütlich: "cozy", romantisch: "romantic", unscharf: "blurry", verschwommen: "blurry", nahaufnahme: "close-up",
  panorama: "panorama", porträt: "portrait", portrait: "portrait", luftaufnahme: "aerial view",
  silber: "silver", gold: "gold", golden: "golden", türkis: "turquoise", beige: "beige", dunkelblau: "dark blue",
  hellblau: "light blue", dunkelgrün: "dark green", hellgrün: "light green",
};

// Wörter, die es auf Deutsch UND Englisch gibt (mit anderer Bedeutung). In einer englischen Suche
// behalten sie die englische Bedeutung, sonst gilt die deutsche (z. B. „See“ allein → lake).
const AMBIGUOUS = new Set(["see", "bad", "hell", "die", "test", "an", "in", "gift", "art", "also", "will", "war", "fast", "mist", "rock", "kind", "hut", "rot", "note", "pass", "plan", "rennen", "boot", "taste"]);
// Klare Hinweise, dass die Suche auf Englisch ist
const ENGLISH_HINTS = new Set(["the", "a", "of", "with", "and", "on", "at", "my", "near", "behind", "without", "from", "is", "are", "some", "photo", "photos", "picture", "pictures", "this", "that", "his", "her", "our"]);
const GERMAN_HINTS = new Set(["der", "die", "das", "den", "dem", "des", "ein", "eine", "einem", "einen", "im", "am", "mit", "und", "ohne", "auf", "vom", "zum", "zur", "beim", "unter", "neben", "vor", "hinter", "bei"]);

/** Einzelnes Wort nachschlagen – auch Mehrzahl/Endungen und zusammengesetzte Wörter (Schneeberg → snow mountain). */
function lookup(raw: string): string | undefined {
  const w = raw.toLowerCase();
  const direct = W[w] ?? W[w.replace(/ß/g, "ss")];
  if (direct !== undefined) return direct;
  // Endungen abschneiden: Bergen → Berg, Blumen → Blume, Kindern → Kinder, Autos → Auto
  for (const suffix of ["ern", "en", "er", "es", "n", "e", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      const hit = W[w.slice(0, -suffix.length)];
      if (hit) return hit;
    }
  }
  // Zusammengesetzt: längster bekannter Anfang + bekannter Rest (auch mit Fugen-s/-n)
  if (w.length >= 7) {
    for (let i = w.length - 3; i >= 3; i--) {
      const head = W[w.slice(0, i)];
      if (!head) continue;
      for (const rest of [w.slice(i), w.slice(i + 1)]) {
        const tail = rest.length >= 3 ? lookup(rest) : undefined;
        if (tail) return `${head} ${tail}`;
      }
    }
  }
  return undefined;
}

/** Ist die Suche wohl auf Englisch? (englische Füllwörter, keine deutschen, keine Umlaute) */
export function looksEnglish(query: string): boolean {
  const words = query.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some((w) => GERMAN_HINTS.has(w) || /[äöüß]/.test(w))) return false;
  return words.some((w) => ENGLISH_HINTS.has(w));
}

/** Suchtext grob ins Englische übertragen (Wort für Wort). In englischen Suchen bleiben mehrdeutige Wörter englisch. */
export function toEnglish(query: string): string {
  const english = looksEnglish(query);
  return query
    .trim()
    .split(/\s+/)
    .map((word) => {
      const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}-]+)([^\p{L}\p{N}]*)$/u.exec(word);
      if (!m) return word;
      const [, pre, core, post] = m;
      if (english && (AMBIGUOUS.has(core.toLowerCase()) || ENGLISH_HINTS.has(core.toLowerCase()))) return word;
      const hit = lookup(core);
      return hit === undefined ? word : hit ? `${pre}${hit}${post}` : "";
    })
    .filter(Boolean)
    .join(" ");
}
