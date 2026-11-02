import { useEffect, useState } from "react";
import { sizedThumb } from "../lib/google";
import { functionsUrl, supabase } from "../lib/supabase";
import type { Item } from "../lib/types";
import Icon from "./Icon";

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

const SIZE = 360;

export default function Thumb({ item, link, ready }: { item: Item; link?: string; ready: boolean }) {
  const [src, setSrc] = useState<string | null>(link ? sizedThumb(link, SIZE) : null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [triedProxy, setTriedProxy] = useState(false);

  useEffect(() => {
    if (link) {
      setSrc(sizedThumb(link, SIZE));
      setFailed(false);
    }
  }, [link]);

  const fallback = () => {
    if (triedProxy) {
      setFailed(true);
      return;
    }
    setTriedProxy(true);
    proxiedThumb(item, SIZE)
      .then(setSrc)
      .catch(() => setFailed(true));
  };

  useEffect(() => {
    // Links fertig geladen, aber keiner für dieses Foto → Umweg über die Edge Function
    if (!ready || link) return;
    fallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, link, item.drive_id]);

  return (
    <div className={`thumb-wrap ${!loaded && !failed ? "skeleton" : ""}`}>
      {src && !failed && (
        <img
          className={`thumb ${loaded ? "loaded" : ""}`}
          src={src}
          alt={item.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={fallback}
        />
      )}
      {failed && (
        <div className="thumb-placeholder">
          <Icon name="image" />
        </div>
      )}
    </div>
  );
}
