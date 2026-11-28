// Upload: Fotos erkennen, die gleich aussehen wie eines im Zielordner – auch wenn es eine andere Datei ist
// (z. B. einmal als HEIC, einmal von Safari als JPEG umgewandelt; anders komprimiert; andere Auflösung).
// Die Prüfsumme findet nur byte-gleiche Dateien, das hier den Rest.
import { needsFine } from "./duplicates";
import { nearLook, sameFine, sameLook } from "./lookalike";
import { ensureSigs, fineFor, fineFromBlob, lookFromBlob, storeSigs, type LocalLook } from "./lookScan";
import { fineKey } from "./lookVerify";
import type { Item } from "./types";

const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;

/** Abbild einer ausgewählten Datei (nur Bilder; null = kein Bild oder nicht lesbar). */
export async function localLook(file: File): Promise<LocalLook | null> {
  if (!file.type.startsWith("image/") && !IMAGE_EXT.test(file.name)) return null;
  return lookFromBlob(file).catch(() => null);
}

export interface LocalFile {
  id: string;
  file: File;
  md5: string;
  look: LocalLook | null;
}

/**
 * Abbilder der ausgewählten Fotos gleich speichern – dann muss sie später niemand mehr aus der Vorschau berechnen.
 * Nicht bei Screenshots/Grafiken: dort passt das Abbild aus der Datei nicht genau genug zu dem aus Googles
 * Vorschau (anders verkleinerter Text) – die werden später wie alle anderen aus der Vorschau berechnet.
 */
export function rememberLooks(files: LocalFile[]): void {
  void storeSigs(files.filter((f) => f.look && !fineOfLocal(f)).map((f) => [f.md5, f.look!.sig]));
}

/** Screenshot/Grafik? (braucht die Feinprüfung) */
function fineOfLocal(f: LocalFile): boolean {
  return needsFine({ name: f.file.name, mime_type: f.file.type || null, path: null, width: f.look?.width, height: f.look?.height });
}

/**
 * Welche ausgewählten Fotos sehen aus wie ein Foto im Zielordner (oder wie ein früheres in der Auswahl)?
 * Ergebnis: Datei-ID → Name des gleichen Fotos. Byte-gleiche Dateien zählen hier nicht – die findet die Prüfsumme.
 * Bei Screenshots/Grafiken entscheidet zusätzlich die Feinprüfung; klappt sie nicht, wird hochgeladen
 * (lieber einmal doppelt als ein Foto, das fehlt).
 */
export async function lookDuplicates(files: LocalFile[], targets: Item[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const locals = files.filter((f) => f.look);
  if (!locals.length) return out;
  const images = targets.filter((t) => !t.is_folder && t.md5 && t.mime_type?.startsWith("image/"));
  const sigs = images.length
    ? await ensureSigs(
        images.map((t) => ({ account_id: t.account_id, drive_id: t.drive_id, parent_drive_id: t.parent_drive_id, md5: t.md5! })),
        600,
        signal,
      )
    : new Map();
  const targetMd5 = new Set(images.map((t) => t.md5!));
  const localFine = new Map<string, Uint8Array | null>();
  const fineLocal = async (f: LocalFile) => {
    if (!localFine.has(f.id)) localFine.set(f.id, await fineFromBlob(f.file).catch(() => null));
    return localFine.get(f.id) ?? null;
  };
  const fineTarget = new Map<string, Uint8Array | null>();
  const fineRemote = async (t: Item) => {
    const k = fineKey(t);
    if (!fineTarget.has(k)) fineTarget.set(k, (await fineFor([t])).get(k) ?? null);
    return fineTarget.get(k) ?? null;
  };

  const accepted: LocalFile[] = [];
  for (const f of locals) {
    if (signal?.aborted) break;
    if (targetMd5.has(f.md5)) continue; // byte-gleich im Ordner → das erledigt die Prüfsumme
    const sig = f.look!.sig;
    let match: string | null = null;
    for (const t of images) {
      const ts = sigs.get(t.md5!);
      if (!ts || t.md5 === f.md5) continue;
      const fine = fineOfLocal(f) || needsFine(t);
      // Screenshots: lockerer Vorfilter, die Feinprüfung entscheidet (siehe nearLook)
      if (!(fine ? nearLook(sig, ts) : sameLook(sig, ts))) continue;
      if (fine) {
        const [a, b] = await Promise.all([fineLocal(f), fineRemote(t)]);
        if (!a || !b || !sameFine(a, b)) continue;
      }
      match = t.name;
      break;
    }
    if (!match) {
      for (const o of accepted) {
        if (o.md5 === f.md5 || !sameLook(sig, o.look!.sig)) continue;
        if (fineOfLocal(f) || fineOfLocal(o)) {
          const [a, b] = await Promise.all([fineLocal(f), fineLocal(o)]);
          if (!a || !b || !sameFine(a, b)) continue;
        }
        match = `${o.file.name} (in der Auswahl)`;
        break;
      }
    }
    if (match) out.set(f.id, match);
    else accepted.push(f);
  }
  return out;
}
