import { useEffect, useState } from "react";
import { sizedThumb } from "../lib/google";
import { functionsUrl, supabase } from "../lib/supabase";
import type { Item } from "../lib/types";

const blobCache = new Map<string, string>();

/** Vorschau über den Edge-Function-Umweg (falls der Google-Link nicht lädt). */
export async function proxiedThumb(item: Item, size: number): Promise<string> {
  const key = `${item.account_id}|${item.drive_id}|${size}`;
  const hit = blobCache.get(key);
  if (hit) return hit;
  const { data } = await supabase.auth.getSession();
  const p = new URLSearchParams({ account_id: item.account_id, file_id: item.drive_id, size: String(size) });
  const res = await fetch(`${functionsUrl}/thumb?${p}`, {
    headers: {
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      apikey: import.meta.env.VITE_SUPABASE_KEY as string,
    },
  });
  if (!res.ok) throw new Error(`Vorschau ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  blobCache.set(key, url);
  return url;
}

export default function Thumb({ item, link, ready }: { item: Item; link?: string; ready: boolean }) {
  const [src, setSrc] = useState<string | null>(link ? sizedThumb(link, 400) : null);
  const [failed, setFailed] = useState(false);
  const [triedProxy, setTriedProxy] = useState(false);

  useEffect(() => {
    setSrc(link ? sizedThumb(link, 400) : null);
    setFailed(false);
    setTriedProxy(false);
  }, [link]);

  const fallback = () => {
    if (triedProxy) {
      setFailed(true);
      return;
    }
    setTriedProxy(true);
    proxiedThumb(item, 400)
      .then(setSrc)
      .catch(() => setFailed(true));
  };

  useEffect(() => {
    // Links fertig geladen, aber keiner für dieses Foto → Umweg über die Edge Function
    if (!ready || link) return;
    fallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, link, item.drive_id]);

  if (failed || !src) {
    return <div className="thumb placeholder">{failed ? "🖼️" : ""}</div>;
  }
  return (
    <img
      className="thumb"
      src={src}
      alt={item.name}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fallback}
    />
  );
}
