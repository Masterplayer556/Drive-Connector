// KI-SUCHE (Test): Wie die Suche dem Bildmodell (CLIP) gestellt wird. Reine Funktionen (getestet).
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
