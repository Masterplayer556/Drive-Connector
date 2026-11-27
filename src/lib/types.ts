/** Bereich eines Kontos. "schule" = Archiv (früherer Name, bleibt in der Datenbank so). */
export type Role = "schule" | "privat" | "claude";

export interface Account {
  id: string;
  email: string;
  role: Role;
  root_folder_id: string | null;
  quota_limit: number | null;
  quota_usage: number | null;
  status: "active" | "error";
  status_message: string | null;
  last_sync_at: string | null;
  /** Zuletzt selbst direkt bei Google eingeloggt (vom Nutzer bestätigt); leer = seit dem Verbinden */
  last_login_at?: string | null;
  created_at: string;
}

export interface Item {
  account_id: string;
  drive_id: string;
  name: string;
  is_folder: boolean;
  mime_type: string | null;
  parent_drive_id: string | null;
  size: number | null;
  md5: string | null;
  taken_at: string | null;
  /** Bildmasse wie angezeigt (aus Drive; leer bei älteren Einträgen bis zum nächsten Abgleich) */
  width?: number | null;
  height?: number | null;
  description: string | null;
  path: string | null;
  parent_key: string | null;
}

/** Ein Ordner im Frontend – kann aus mehreren physischen Ordnern (Konten) bestehen. */
export interface LogicalFolder {
  key: string;
  name: string;
  path: string;
  parts: Item[];
}

export interface FolderContent {
  folders: LogicalFolder[];
  files: Item[];
  /** Ohne Netz: gespeicherter Stand eines offline verfügbaren Ordners (Zeitpunkt der Sicherung) */
  offlineAt?: string;
}

/** Position im Drive (Pfad aus Ordnernamen, Schlüssel in Kleinbuchstaben). */
export interface Crumb {
  name: string;
  path: string;
  key: string;
}

export type LogKind = "upload" | "rename" | "delete" | "move" | "folder" | "account" | "sync" | "error" | "setup" | "check" | "app";

export interface LogEntry {
  id: number;
  created_at: string;
  kind: LogKind;
  message: string;
  details: unknown;
}
