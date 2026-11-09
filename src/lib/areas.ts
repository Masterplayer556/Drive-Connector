// Die Bereiche ganz oben im Drive. Privat und Claude sind abgeschottet.
// Hinweis: In der Datenbank heisst die Rolle des Archiv-Bereichs weiterhin "schule" (früherer Name).
import type { Role } from "./types";

export const AREA_LABEL: Record<Role, string> = { schule: "Archiv", privat: "Privat", claude: "Claude" };
export const AREA_FOLDER: Record<Role, string> = { schule: "Archiv", privat: "Privat", claude: "Claude" };

/** Reihenfolge der Bereiche (Auswahl, Diagramm-Seiten, Karten) */
export const ROLES: Role[] = ["schule", "privat", "claude"];

/** Abgeschottete Bereiche: nichts kommt hinein oder heraus */
export const isSealed = (r: Role | null | undefined): boolean => r === "privat" || r === "claude";

/** Ordnerschlüssel auf oberster Ebene, die zu einem Bereich gehören ("schule" = alter Name von Archiv). */
export const AREA_KEYS = new Set(["archiv", "privat", "schule", "claude"]);
