// KI-SUCHE (Test): englischer Wortschatz für die Suche. Gesucht wird nur noch auf Englisch – der Suchtext geht
// unverändert ans Modell (kein Deutsch→Englisch-Wörterbuch mehr, das mit doppeldeutigen Wörtern verwirrt hat).
// Der Wortschatz dient nur dazu, Namen („Luca“, „Pikachu“) von normalen Wörtern zu unterscheiden und Begriffe
// zum Trainieren vorzuschlagen.

/** Dinge und Eigenschaften, die man auf Fotos sieht (auch Begriffe zum Trainieren). */
const PHRASES = [
  "advent wreath", "aerial view", "airplane", "airport", "alpaca", "alps", "angry", "animal", "animals", "ant",
  "apartment", "apple", "arm", "art", "autumn", "autumn leaves", "award ceremony", "baby", "backpack", "bag",
  "bakery", "baking", "balcony", "ball", "balloon", "balloons", "banana", "banknote", "baptism", "bar", "barbecue",
  "barbecue party", "barcode", "barn", "basement", "basketball", "bathroom", "battery", "beach", "bear", "beard",
  "beautiful", "bed", "bedroom", "bee", "beer", "beetle", "beige", "bicycle", "big", "bikini", "binder", "biology",
  "bird", "birdhouse", "birds", "birthday", "black", "blackboard", "blanket", "blue", "blurry", "board game",
  "boat", "book", "books", "boots", "border", "bottle", "boy", "braided bread", "branch", "bread", "breakfast",
  "bridge", "bright", "brother", "brown", "building", "bull", "burger", "bus", "bus timetable", "bush",
  "butterfly", "cable", "cable car", "cactus", "cafe", "cake", "calculator", "calendar", "calf", "calm", "camel",
  "camera", "camper van", "campfire", "camping", "candle", "cap", "car", "carnival", "carpet", "carrot", "cars",
  "castle", "cat", "cats", "cave", "celebration", "chair", "chairlift", "champagne", "chapel", "charger", "chart",
  "chat messages", "cheese", "chemistry", "cherries", "cherry", "chicken", "chickens", "child", "children",
  "chocolate", "christmas", "christmas tree", "church", "church tower", "cinema", "city", "class photo",
  "classroom", "climbing", "close-up", "cloud", "clouds", "cloudy", "coast", "cocktail", "code", "coffee", "coin",
  "coins", "cold", "colorful", "computer", "computer science", "concert", "contract", "cookies", "cooking",
  "costume", "couple", "cow", "cows", "cozy", "crab", "crafting", "crafts", "credit card", "crepe", "crocodile",
  "croissant", "cross-country skiing", "crowd", "cucumber", "cup", "curtain", "cute", "cutlery", "cycling",
  "dancing", "dark", "dark blue", "dark green", "decoration", "deer", "desert", "desk", "dew", "diagram", "dinner",
  "diploma", "diving", "document", "documents", "dog", "dogs", "doll", "dolphin", "donkey", "door", "drawing",
  "dress", "drink", "drinking", "duck", "ducks", "dune", "dusk", "eagle", "ear", "easter", "economics", "egg",
  "eggs", "elephant", "email", "empty", "english", "eraser", "evening", "exam", "exercise", "eye", "eyes", "face",
  "family", "farm", "father", "feet", "field", "finger", "fir tree", "fire", "fireworks", "fish", "fishing",
  "five", "floor plan", "floorball", "flower", "flowers", "foal", "fog", "foggy", "folder", "fondue", "food",
  "foot", "forest", "fork", "form", "formula", "fountain", "fountain pen", "four", "fox", "frame", "french",
  "french fries", "fridge", "friend", "friends", "frog", "fruit", "fruits", "full", "funny", "game",
  "game console", "garage", "garden", "garland", "garlic", "geography", "german", "gift", "gifts", "giraffe",
  "girl", "glacier", "glass", "glasses", "gloves", "glue", "goat", "gold", "golden", "golf", "gondola", "gorge",
  "grade", "grades", "graduation", "grandfather", "grandmother", "grapes", "grass", "green", "grey", "group",
  "group photo", "guinea pig", "guitar", "gym", "gym workout", "gymnastics", "hail", "hair", "halloween",
  "hallway", "hamster", "hand", "hands", "handwriting", "happy", "harbor", "hash browns", "hat", "headphones",
  "hedge", "hedgehog", "helmet", "highway", "hike", "hiking", "hill", "historic", "history", "hockey", "honey",
  "horse", "horse riding", "horses", "hospital", "hot", "hotel", "house", "houses", "hut", "ice", "ice cream",
  "ice hockey", "id card", "insect", "intersection", "invoices", "island", "jacket", "jeans", "jellyfish",
  "jogging", "juice", "jumping", "kebab", "keyboard", "keys", "kitchen", "kitten", "knife", "label", "ladybug",
  "lake", "lamb", "lamp", "landscape", "laptop", "laughing", "leaves", "leg", "lego", "lemon", "letter", "library",
  "light blue", "light green", "lightning", "lion", "list", "living room", "llama", "lunch", "man", "map",
  "market", "mask", "match", "math", "math calculation", "math formulas", "meadow", "meal", "meat", "medal", "men",
  "menu", "message", "milk", "mirror", "modern", "money", "monkey", "monument", "moon", "moonlight", "morning",
  "mosque", "mother", "motorcycle", "mountain", "mountain hut", "mountains", "mouse", "mouth", "muesli", "muffin",
  "mug", "museum", "mushroom", "mushrooms", "music", "nativity scene", "nature", "necklace", "new", "new year",
  "new year's eve", "night", "noodles", "northern lights", "nose", "notebook", "notes", "nut", "nuts", "office",
  "old", "old town", "onion", "orange", "oven", "owl", "page", "painting", "palm tree", "pan", "panorama", "pants",
  "paper", "park", "parking lot", "parrot", "party", "passport", "pasta", "path", "pen", "pencil", "penguin",
  "pens", "people", "person", "pet", "phone", "photo", "physics", "piano", "picnic", "picture", "pig", "pigeon",
  "pillow", "pink", "pizza", "plan", "plant", "plants", "plate", "playground", "playing", "playing cards", "pond",
  "portrait", "poster", "pot", "potato", "potatoes", "presentation", "printer", "pumpkin", "puppy", "purple",
  "puzzle", "qr code", "rabbit", "raclette", "railway", "rain", "rainbow", "reading", "receipt", "recipe", "red",
  "remote control", "report card", "restaurant", "rhino", "rice", "riding", "ring", "river", "rock", "rocks",
  "romantic", "roof", "room", "root", "rose", "roses", "ruins", "ruler", "running", "sad", "sailing", "salad",
  "salmon", "sand", "sandwich", "santa claus", "sausage", "scarf", "school", "school building", "schoolyard",
  "scissors", "scooter", "screen", "screenshot", "sea", "seagull", "selfie", "shark", "sheep", "sheet of paper",
  "shelf", "ship", "shirt", "shoes", "shop", "shopping mall", "shore", "sign", "signpost", "silver", "sister",
  "sketch", "ski lift", "skiing", "skirt", "sky", "skyscraper", "sled", "sledding", "sleeping", "slide", "small",
  "small dog", "smile", "snake", "snow", "snowboard", "snowman", "snowy", "soccer", "sofa", "solution",
  "solutions", "soup", "spider", "spoon", "sports", "spring", "square", "squirrel", "stadium", "stairs",
  "starry sky", "stars", "steak", "stone", "storm", "stormy", "stove", "strawberries", "strawberry", "stream",
  "street", "stroller", "student", "suit", "suitcase", "summary", "summer", "summit", "sun", "sunflower",
  "sunglasses", "sunny", "sunrise", "sunset", "supermarket", "surfing", "sushi", "swamp", "sweater", "swimming",
  "swimming pool", "swimsuit", "t-shirt", "table", "table chart", "tablet", "tattoo", "taxi", "tea", "teacher",
  "teddy bear", "temple", "tennis", "tent", "terrace", "text", "textbook", "theater", "three", "thunderstorm",
  "ticket", "tie", "tiger", "timetable", "tired", "tomato", "tomatoes", "tournament", "tower", "toy", "tractor",
  "traffic light", "train", "train station", "training", "tram", "travel", "tree", "trees", "trip", "trophy",
  "truck", "tulip", "tunnel", "turquoise", "turtle", "tv", "two", "uniform", "university", "vacation", "valley",
  "vase", "vegetables", "village", "vocabulary", "volcano", "volleyball", "waffle", "wardrobe", "warm", "wasp",
  "watch", "water", "water bottle", "waterfall", "wave", "waves", "wedding", "wet", "whale", "white", "whiteboard",
  "window", "wine", "winter", "wolf", "woman", "women", "words", "worksheet", "wristwatch", "writing", "yellow",
  "yoga", "yogurt", "zebra", "zoo",
];

/** Häufige englische Wörter, die keine Namen sind (Verben, Füllwörter, Beschreibungen). */
const COMMON = new Set(
  (
    "a an the of and or but to for by at in on into onto from with without near behind under over above below " +
    "between beside next front back top bottom left right inside outside around through across along up down off " +
    "after before during while together alone some any all each every both one two three four five six seven eight " +
    "nine ten many few lots lot much more most less other another same different only just very really also too " +
    "is are was were be been being am has have had do does did not no yes this that these those there here " +
    "i me my mine you your he him his she her hers it its we us our they them their who what where when which why how " +
    "photo photos picture pictures image images pic pics shot shots selfie selfies video videos screenshot " +
    "standing sitting lying holding wearing walking running eating drinking looking smiling laughing posing playing " +
    "sleeping talking reading writing riding swimming jumping dancing singing cooking waving hugging kissing " +
    "young little tiny huge large long short tall high low light dark color colour colored coloured close closeup " +
    "view side half full whole part like near far new old first last best good nice cool cute"
  ).split(" "),
);

/** Füllwörter: machen aus Stichwörtern einen Satz */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "with", "without", "in", "on", "at", "to", "for", "by", "from", "near",
  "behind", "under", "over", "my", "his", "her", "our", "their", "is", "are", "this", "that", "some",
]);

const NOT_CONCEPTS = new Set([
  // Füllwörter, Zahlen
  "a", "and", "at", "at the", "after", "behind", "between", "from", "from the", "in", "in front of", "in the", "next to",
  "of", "on", "or", "over", "to the", "under", "with", "without", "lots of", "many", "few", "one", "two", "three",
  "four", "five",
  // Farben und Eigenschaften (beschreiben, sind aber selbst kein Motiv)
  "red", "blue", "green", "yellow", "black", "white", "grey", "brown", "orange", "pink", "purple", "colorful", "beige",
  "turquoise", "silver", "gold", "golden", "dark blue", "light blue", "dark green", "light green", "big", "small", "old",
  "new", "dark", "bright", "wet", "empty", "full", "beautiful", "funny", "cute", "happy", "sad", "tired", "angry", "warm",
  "cold", "hot", "calm", "modern", "historic", "cozy", "romantic", "blurry", "sunny", "cloudy", "foggy", "snowy", "stormy",
  // Schulfächer/abstrakt – auf Fotos kaum erkennbar
  "english", "french", "german", "history", "geography", "economics", "biology", "chemistry", "physics",
  "computer science", "art", "grade", "grades", "plan", "solution", "solutions", "summary", "training", "travel", "trip",
  "photo", "picture", "playing", "exercise", "money", "code",
]);

// Wörter des Wortschatzes (aus allen Begriffen, z. B. „autumn leaves“ → autumn, leaves)
const VOCAB = new Set(PHRASES.flatMap((p) => p.split(/[^\p{L}]+/u)).filter((w) => w.length > 1));

const known = (w: string) => COMMON.has(w) || VOCAB.has(w);

/** Bekanntes englisches Wort – auch Mehrzahl und -ing/-ed-Formen (dogs, jumping, painted). */
function isKnownWord(w: string): boolean {
  if (known(w)) return true;
  for (const suffix of ["ies", "es", "s", "ing", "ed", "ly", "er"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      const base = w.slice(0, -suffix.length);
      if (known(base) || known(`${base}e`) || known(`${base}ing`) || (suffix === "ies" && known(`${base}y`))) return true;
    }
  }
  return w.length > 5 && w.endsWith("ing"); // -ing-Formen sind keine Namen
}

/**
 * Wort, das kein bekanntes englisches Wort ist – meist ein Name („Luca“, „Pikachu“, eine eigene Figur).
 * Solche Wörter lernt die Suche über 👍.
 */
export function isNameWord(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 2 || !/^[\p{L}][\p{L}'-]*$/u.test(w)) return false;
  return !isKnownWord(w);
}

/**
 * Stichwort-Suche („dog snow mountain“): 2–5 Wörter ohne Füllwörter wie „the“, „with“.
 * Liefert die einzelnen Stichwörter – die Suche bevorzugt dann Fotos, auf denen ALLE zu sehen sind.
 * Bei einem ganzen Satz („dog in the snow“) oder einem einzelnen Wort: [].
 */
export function keywordsOf(query: string): string[] {
  const words = query.trim().split(/[\s,;+]+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return [];
  const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");
  if (words.some((w) => STOPWORDS.has(bare(w)))) return [];
  const out = words
    .map(bare)
    .filter((w) => w && !/^\d+$/.test(w)) // Zahlen (Jahre) helfen dem Bildmodell nicht
    .filter((w) => !isNameWord(w)); // Namen kennt das Modell nicht – die lernt die Suche über 👍 (names.ts)
  return out.length >= 2 ? [...new Set(out)] : [];
}

/**
 * Die Namen in einer Suche, klein geschrieben. Aufeinanderfolgende Namenswörter sind ein Name
 * („Darth Vader at the beach“ → ["darth vader"]).
 */
export function nameWords(text: string): string[] {
  return nameRuns(text).map((r) => r.name);
}

/** Wie nameWords, dazu die Schreibweise aus dem Text („Darth Vader“). */
export function nameRuns(text: string): { name: string; label: string }[] {
  const out: { name: string; label: string }[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const label = run.join(" ");
      if (!out.some((o) => o.name === label.toLowerCase())) out.push({ name: label.toLowerCase(), label });
    }
    run = [];
  };
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (w && isNameWord(w)) run.push(w);
    else flush();
    // Satzzeichen am Wortende (Komma …) beendet den Namen
    if (/[^\p{L}'-]$/u.test(raw)) flush();
  }
  flush();
  return out;
}

/** Begriffe zum Trainieren – ohne Farben/Eigenschaften und doppelte Mehrzahl. */
export function conceptVocabulary(): { en: string }[] {
  const all = new Set(PHRASES);
  const singular = (w: string) =>
    (w.endsWith("ies") && all.has(`${w.slice(0, -3)}y`)) || (w.endsWith("es") && all.has(w.slice(0, -2))) || (w.endsWith("s") && all.has(w.slice(0, -1)));
  return PHRASES.filter((en) => !NOT_CONCEPTS.has(en) && !singular(en)).map((en) => ({ en }));
}
