// Rebalancing ausführen (Regel 6) – Warteschlange in Teilschritten, ohne dass eine Datei geöffnet wird:
// 1. Quellkonto gibt den Ordner intern für das Zielkonto frei (Leserecht, ohne E-Mail)
// 2. Zielkonto erstellt eine serverseitige Kopie bei Google
// 3. Vergleich von MD5 und Grösse
// 4. Erst bei Übereinstimmung kommt das Original in den Papierkorb (Google löscht nach 30 Tagen endgültig)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DRIVE, FOLDER_MIME, getAccessToken, gfetch } from "./google.ts";
import { HttpError } from "./http.ts";

interface StepUnit {
  account_id: string;
  parent_key: string;
  folder_id: string;
  path: string;
}
interface Step {
  from: string;
  to: string;
  label: string;
  units: StepUnit[];
}
interface Task {
  id: number;
  plan_id: string;
  owner_id: string;
  src_account: string;
  dst_account: string;
  src_folder: string;
  path: string;
  drive_id: string;
  name: string;
  size: number | null;
  md5: string | null;
}
type Log = (msg: string) => void;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
/** Google-IDs bestehen nur aus diesen Zeichen – alles andere kommt nicht in eine Drive-Abfrage */
const ID_RE = /^[\w-]{5,200}$/;
const isLocked = (key: string, locks: string[]) => locks.some((l) => key === l || key.startsWith(l + "/"));
/** Gebiet des Pfads: "privat", "claude" oder "schule" (Archiv) – ohne Bereich null (dann wie das Quellkonto) */
const zoneOfPath = (path: string): string | null => {
  const top = path.split("/")[0]?.toLowerCase();
  if (top === "privat") return "privat";
  if (top === "claude") return "claude";
  if (top === "archiv" || top === "schule") return "schule";
  return null;
};

/**
 * Schritte eines Plans in Datei-Aufgaben aufteilen (gesperrte Ordner werden übersprungen).
 * Nur ein Lauf darf das tun: der Plan wird vorher reserviert (queued → running, noch nicht eingereiht).
 */
async function expandPlan(admin: SupabaseClient, plan: { id: string; owner_id: string; steps: Step[] }) {
  const { data: claimed } = await admin
    .from("rebalance_plans")
    .update({ status: "running", expanded: false })
    .eq("id", plan.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return 0; // ein anderer Lauf reiht gerade ein
  const { data: lockRows } = await admin.from("folder_locks").select("path_key").eq("owner_id", plan.owner_id);
  const locks = (lockRows ?? []).map((l) => l.path_key as string);
  // Privat und Claude sind abgeschottet: nie zwischen Konten verschiedener Gebiete verschieben
  const { data: accRows } = await admin.from("accounts").select("id, role").eq("owner_id", plan.owner_id);
  const roleOf = new Map((accRows ?? []).map((a) => [a.id as string, (a.role as string) ?? "schule"]));
  let total = 0;
  for (const step of plan.steps) {
    // Der Plan kommt aus der App: nur zwischen eigenen, verschiedenen Konten
    if (!roleOf.has(step.from) || !roleOf.has(step.to) || step.from === step.to) continue;
    for (const u of step.units ?? []) {
      if (typeof u.folder_id !== "string" || !ID_RE.test(u.folder_id)) continue;
      if (typeof u.path !== "string" || !u.path || typeof u.parent_key !== "string") continue;
      if (isLocked(u.parent_key, locks)) continue;
      const zone = zoneOfPath(u.path) ?? roleOf.get(step.from) ?? "schule";
      if ((roleOf.get(step.to) ?? "schule") !== zone) continue;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin
          .from("items")
          .select("drive_id, name, size, md5")
          .eq("account_id", step.from)
          .eq("parent_drive_id", u.folder_id)
          .eq("is_folder", false)
          .order("drive_id")
          .range(from, from + 999);
        if (error) throw error;
        if (!data?.length) break;
        const rows = data.map((f) => ({
          plan_id: plan.id,
          owner_id: plan.owner_id,
          src_account: step.from,
          dst_account: step.to,
          src_folder: u.folder_id,
          path: u.path,
          drive_id: f.drive_id,
          name: f.name,
          size: f.size,
          md5: f.md5,
        }));
        const ins = await admin.from("rebalance_tasks").insert(rows);
        if (ins.error) throw ins.error;
        total += rows.length;
        if (data.length < 1000) break;
      }
    }
  }
  await admin.from("rebalance_plans").update({ status: "running", total, expanded: true }).eq("id", plan.id);
  return total;
}

/** Zielordner-Pfad im Zielkonto sicherstellen (fehlende Ordner anlegen und in den Index eintragen). */
class FolderMaker {
  private cache = new Map<string, string>();
  constructor(private admin: SupabaseClient) {}

  async ensure(accountId: string, ownerId: string, token: string, path: string): Promise<string> {
    const segs = path.split("/");
    const { data: acc } = await this.admin.from("accounts").select("root_folder_id").eq("id", accountId).single();
    let parent: string = acc!.root_folder_id;
    for (let i = 1; i <= segs.length; i++) {
      const prefix = segs.slice(0, i).join("/");
      const key = `${accountId}|${prefix.toLowerCase()}`;
      let id = this.cache.get(key);
      if (!id) {
        const { data } = await this.admin
          .from("items")
          .select("drive_id")
          .eq("account_id", accountId)
          .eq("is_folder", true)
          .ilike("path", escapeLike(prefix))
          .limit(1);
        id = data?.[0]?.drive_id;
      }
      if (!id) {
        const f = await gfetch<{ id: string }>(token, `${DRIVE}/files?fields=id`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: segs[i - 1], mimeType: FOLDER_MIME, parents: [parent] }),
        });
        id = f.id;
        await this.admin.from("items").insert({
          account_id: accountId,
          owner_id: ownerId,
          drive_id: id,
          name: segs[i - 1],
          is_folder: true,
          mime_type: FOLDER_MIME,
          parent_drive_id: parent,
          path: prefix,
          parent_key: segs.slice(0, i - 1).join("/").toLowerCase(),
        });
      }
      this.cache.set(key, id);
      parent = id;
    }
    return parent;
  }
}

async function moveOne(
  admin: SupabaseClient,
  t: Task,
  ctx: { emails: Map<string, string>; shared: Set<string>; folders: FolderMaker },
) {
  const src = (await getAccessToken(admin, t.src_account)).token;
  const dst = (await getAccessToken(admin, t.dst_account)).token;

  // 1. Freigabe des Quellordners für das Zielkonto (einmal pro Ordner)
  const shareKey = `${t.src_folder}>${t.dst_account}`;
  if (!ctx.shared.has(shareKey)) {
    await gfetch(src, `${DRIVE}/files/${t.src_folder}/permissions?sendNotificationEmail=false&fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user", role: "reader", emailAddress: ctx.emails.get(t.dst_account) }),
    });
    ctx.shared.add(shareKey);
  }

  // 2. Serverseitige Kopie im Zielkonto – gibt es sie schon (abgebrochener Lauf), wird sie wiederverwendet
  const parent = await ctx.folders.ensure(t.dst_account, t.owner_id, dst, t.path);
  type Copy = { id: string; md5Checksum?: string; size?: string; mimeType?: string };
  const q = `'${parent}' in parents and name = '${t.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
  const existing = t.md5
    ? (await gfetch<{ files: Copy[] }>(dst, `${DRIVE}/files?${new URLSearchParams({ q, fields: "files(id,md5Checksum,size,mimeType)", pageSize: "10" })}`)).files.find(
        (f) => f.md5Checksum === t.md5,
      )
    : undefined;
  let copy: Copy | undefined = existing;
  // Direkt nach der Freigabe sieht das Zielkonto die Datei manchmal noch nicht (404) → kurz warten, nochmals
  for (let attempt = 0; !copy; attempt++) {
    try {
      copy = await gfetch<Copy>(dst, `${DRIVE}/files/${t.drive_id}/copy?fields=id,md5Checksum,size,mimeType`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t.name, parents: [parent] }),
      });
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404) || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }

  // 3. Prüfsumme und Grösse vergleichen
  let md5 = t.md5;
  let size = t.size;
  if (!md5 || size == null) {
    const orig = await gfetch<{ md5Checksum?: string; size?: string }>(src, `${DRIVE}/files/${t.drive_id}?fields=md5Checksum,size`);
    md5 = orig.md5Checksum ?? null;
    size = orig.size ? Number(orig.size) : null;
  }
  if (!md5 || copy.md5Checksum !== md5 || Number(copy.size) !== Number(size)) {
    await fetch(`${DRIVE}/files/${copy.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${dst}` } });
    throw new HttpError(409, "Kopie stimmt nicht mit dem Original überein – Original bleibt unverändert");
  }

  // 4. Original in den Papierkorb (30 Tage zurückholbar)
  await gfetch(src, `${DRIVE}/files/${t.drive_id}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });

  // Index, Favoriten und Teilen-Links nachführen
  const { data: old } = await admin.from("items").select("*").eq("account_id", t.src_account).eq("drive_id", t.drive_id).maybeSingle();
  await admin.from("items").delete().eq("account_id", t.src_account).eq("drive_id", t.drive_id);
  await admin.from("items").upsert({
    ...(old ?? {}),
    account_id: t.dst_account,
    owner_id: t.owner_id,
    drive_id: copy.id,
    name: t.name,
    is_folder: false,
    mime_type: copy.mimeType ?? old?.mime_type ?? null,
    parent_drive_id: parent,
    size: Number(copy.size),
    md5: copy.md5Checksum,
    path: `${t.path}/${t.name}`,
    parent_key: t.path.toLowerCase(),
  });
  await admin.from("shares").delete().eq("account_id", t.src_account).eq("drive_id", t.drive_id);
  await carryOver(admin, t, copy.id);
  return copy.id;
}

/**
 * Was am Foto hängt, zieht mit um – die Kopie hat ein anderes Konto und eine neue Google-ID:
 * Favorit, eigene Tags, KI-Fingerabdruck sowie 👍/👎 und gelernte Namen der KI-Suche.
 * Das Foto ist an dieser Stelle schon sicher verschoben; ein Fehler hier bricht nichts mehr ab.
 */
async function carryOver(admin: SupabaseClient, t: Task, newId: string) {
  const to = { account_id: t.dst_account, drive_id: newId };
  const warn = (what: string, error: { message: string } | null) => error && console.error(`Mitnehmen (${what})`, t.drive_id, error.message);
  const mine = <Q extends { eq: (column: string, value: string) => Q }>(q: Q) =>
    q.eq("owner_id", t.owner_id).eq("account_id", t.src_account).eq("drive_id", t.drive_id);

  warn("Favorit", (await mine(admin.from("favorites").update(to))).error);
  warn("Tags", (await mine(admin.from("item_tags").update(to))).error);
  // updated_at neu setzen: andere Geräte holen den Fingerabdruck unter dem neuen Schlüssel ab
  warn("KI-Fingerabdruck", (await mine(admin.from("ai_vectors").update({ ...to, updated_at: new Date().toISOString() }))).error);

  // 👍/👎 und Namen: Schlüssel „konto/datei“ steckt auch in der ID → neuer Eintrag, alter als gelöscht markiert
  // (so übernehmen es auch die Geräte beim nächsten Abgleich)
  const oldKey = `${t.src_account}/${t.drive_id}`;
  const newKey = `${t.dst_account}/${newId}`;
  const { data: fb, error } = await admin
    .from("ai_feedback")
    .select("english, vote, q")
    .eq("owner_id", t.owner_id)
    .eq("key", oldKey)
    .eq("deleted", false);
  warn("KI-Bewertungen", error);
  if (!fb?.length) return;
  const at = Date.now();
  const moved = await admin.from("ai_feedback").upsert(
    fb.map((f) => ({
      owner_id: t.owner_id,
      id: `${String(f.english ?? "").toLowerCase()}|${newKey}`,
      key: newKey,
      english: f.english,
      vote: f.vote,
      q: f.q,
      at,
      deleted: false,
    })),
    { onConflict: "owner_id,id" },
  );
  warn("KI-Bewertungen", moved.error);
  if (moved.error) return;
  warn(
    "KI-Bewertungen",
    (await admin.from("ai_feedback").update({ key: null, english: null, vote: null, q: null, at, deleted: true }).eq("owner_id", t.owner_id).eq("key", oldKey)).error,
  );
}

/** Freigaben entfernen und leere Quellordner in den Papierkorb legen. */
async function cleanup(admin: SupabaseClient, planId: string, emails: Map<string, string>) {
  const { data } = await admin.from("rebalance_tasks").select("src_account, dst_account, src_folder").eq("plan_id", planId);
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const key = `${r.src_folder}>${r.dst_account}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const src = (await getAccessToken(admin, r.src_account)).token;
      const perms = await gfetch<{ permissions: { id: string; emailAddress?: string }[] }>(
        src,
        `${DRIVE}/files/${r.src_folder}/permissions?fields=permissions(id,emailAddress)`,
      );
      const mail = emails.get(r.dst_account)?.toLowerCase();
      for (const p of perms.permissions.filter((x) => x.emailAddress?.toLowerCase() === mail)) {
        await fetch(`${DRIVE}/files/${r.src_folder}/permissions/${p.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${src}` } });
      }
      const left = await gfetch<{ files: unknown[] }>(
        src,
        `${DRIVE}/files?${new URLSearchParams({ q: `'${r.src_folder}' in parents and trashed = false`, fields: "files(id)", pageSize: "1" })}`,
      );
      if (!left.files.length) {
        await gfetch(src, `${DRIVE}/files/${r.src_folder}?fields=id`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        });
        await admin.from("items").delete().eq("account_id", r.src_account).eq("drive_id", r.src_folder);
      }
    } catch (e) {
      console.error("Aufräumen", r.src_folder, e);
    }
  }
}

/**
 * Arbeitet offene Pläne ab, bis die Zeit um ist. Gibt zurück, ob noch Arbeit wartet.
 * Kann beliebig oft aufgerufen werden – fertige Dateien werden nie doppelt kopiert.
 */
export async function runRebalance(admin: SupabaseClient, ownerId: string, deadline: number, log: Log = () => {}) {
  const { data: plans } = await admin
    .from("rebalance_plans")
    .select("id, owner_id, steps, status, total, expanded")
    .eq("owner_id", ownerId)
    .in("status", ["queued", "running"])
    .order("created_at");
  const { data: accs } = await admin.from("accounts").select("id, email").eq("owner_id", ownerId);
  const emails = new Map((accs ?? []).map((a) => [a.id as string, a.email as string]));
  const ctx = { emails, shared: new Set<string>(), folders: new FolderMaker(admin) };
  const summary: { plan_id: string; total: number; done: number; failed: number; status: string }[] = [];

  for (const plan of plans ?? []) {
    if (plan.status === "queued") log(`Plan ${plan.id}: ${await expandPlan(admin, plan)} Dateien eingereiht`);
    else if (!plan.expanded) continue; // ein anderer Lauf reiht gerade ein
    for (;;) {
      if (Date.now() > deadline) break;
      // Aufgaben exklusiv reservieren – parallele Läufe bekommen nie dieselben Fotos
      const { data: batch, error: claimError } = await admin.rpc("claim_rebalance_tasks", { p_plan: plan.id, p_limit: 8 });
      if (claimError) throw claimError;
      if (!batch?.length) break;
      // Erste Aufgabe allein (legt Freigabe und Zielordner an), danach parallel
      const first = batch.slice(0, 1);
      const rest = batch.slice(1);
      for (const group of [first, rest]) {
        await Promise.all(
          (group as Task[]).map(async (t) => {
            try {
              const newId = await moveOne(admin, t, ctx);
              await admin.from("rebalance_tasks").update({ status: "done", new_id: newId, updated_at: new Date().toISOString() }).eq("id", t.id);
            } catch (e) {
              await admin
                .from("rebalance_tasks")
                .update({ status: "failed", error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString() })
                .eq("id", t.id);
            }
          }),
        );
      }
    }

    const count = async (status: string) =>
      (await admin.from("rebalance_tasks").select("id", { count: "exact", head: true }).eq("plan_id", plan.id).eq("status", status)).count ?? 0;
    const [done, failed, pending] = [await count("done"), await count("failed"), (await count("pending")) + (await count("working"))];
    const total = done + failed + pending;
    // Plan noch nicht fertig eingereiht (anderer Lauf) → nicht abschliessen
    const { data: fresh } = await admin.from("rebalance_plans").select("expanded, status").eq("id", plan.id).single();
    if (fresh && fresh.status !== "running") {
      // ein anderer Lauf hat den Plan schon abgeschlossen
      summary.push({ plan_id: plan.id, total, done, failed, status: "done" });
      continue;
    }
    if (!fresh?.expanded) {
      summary.push({ plan_id: plan.id, total, done, failed, status: "running" });
      continue;
    }
    if (pending === 0) {
      // Nur ein Lauf schliesst ab (räumt auf und schreibt den Bericht)
      const { data: won } = await admin
        .from("rebalance_plans")
        .update({ finished_at: new Date().toISOString() })
        .eq("id", plan.id)
        // (hängt ein Abschluss seit 10 Minuten, darf ein anderer Lauf übernehmen)
        .or(`finished_at.is.null,finished_at.lt.${new Date(Date.now() - 10 * 60_000).toISOString()}`)
        .select("id");
      if (!won?.length) {
        summary.push({ plan_id: plan.id, total, done, failed, status: "done" });
        continue;
      }
      await cleanup(admin, plan.id, emails);
      const freed = (
        await admin.from("rebalance_tasks").select("size").eq("plan_id", plan.id).eq("status", "done")
      ).data?.reduce((s, r) => s + Number(r.size ?? 0), 0) ?? 0;
      const gb = (freed / 1024 ** 3).toFixed(1);
      const message = `Rebalancing fertig: ${done} Fotos (${gb} GB) verschoben${failed ? `, ${failed} fehlgeschlagen (Originale unverändert)` : ""}. Platz im Quellkonto wird frei, sobald der Papierkorb geleert ist (spätestens nach 30 Tagen).`;
      await admin
        .from("rebalance_plans")
        .update({ status: failed && !done ? "failed" : "done", done, failed, total, message, finished_at: new Date().toISOString() })
        .eq("id", plan.id);
      await admin.from("activity_log").insert({
        owner_id: ownerId,
        kind: failed ? "error" : "move",
        message,
        details: { plan: plan.id, schritte: (plan.steps as Step[]).map((s) => `${s.label}: ${emails.get(s.from)} → ${emails.get(s.to)}`) },
      });
      summary.push({ plan_id: plan.id, total, done, failed, status: "done" });
    } else {
      await admin.from("rebalance_plans").update({ done, failed, total }).eq("id", plan.id);
      summary.push({ plan_id: plan.id, total, done, failed, status: "running" });
      break; // Zeit ist um
    }
  }
  return { plans: summary, more: summary.some((s) => s.status === "running") };
}
