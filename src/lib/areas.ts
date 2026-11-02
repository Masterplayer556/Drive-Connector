// Die zwei Bereiche ganz oben im Drive.
// Hinweis: In der Datenbank heisst die Rolle des Archiv-Bereichs weiterhin "schule" (früherer Name).
import type { Role } from "./types";

export const AREA_LABEL: Record<Role, string> = { schule: "Archiv", privat: "Privat" };
export const AREA_FOLDER: Record<Role, string> = { schule: "Archiv", privat: "Privat" };

/** Ordnerschlüssel auf oberster Ebene, die zu einem Bereich gehören ("schule" = alter Name von Archiv). */
export const AREA_KEYS = new Set(["archiv", "privat", "schule"]);
