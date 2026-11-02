/** Bereich eines Kontos. "schule" = Archiv (früherer Name, bleibt in der Datenbank so). */
export type Role = "schule" | "privat";

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
}

/** Position im Drive (Pfad aus Ordnernamen, Schlüssel in Kleinbuchstaben). */
export interface Crumb {
  name: string;
  path: string;
  key: string;
}

export type LogKind = "upload" | "rename" | "delete" | "move" | "folder" | "account" | "sync" | "error" | "setup";

export interface LogEntry {
  id: number;
  created_at: string;
  kind: LogKind;
  message: string;
  details: unknown;
}
