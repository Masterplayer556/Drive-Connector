import { useEffect, useRef, useState } from "react";
import { getThumb, peekThumb } from "../lib/thumbs";
import type { Item } from "../lib/types";
import Icon from "./Icon";

// Ein gemeinsamer Beobachter für alle Kacheln: lädt erst, wenn die Kachel bald sichtbar ist
const callbacks = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;
function observe(el: Element, cb: () => void) {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          observer!.unobserve(e.target);
          callbacks.get(e.target)?.();
          callbacks.delete(e.target);
        }
      },
      { rootMargin: "700px 0px" },
    );
  }
  callbacks.set(el, cb);
  observer.observe(el);
  return () => {
    callbacks.delete(el);
    observer?.unobserve(el);
  };
}

export default function Thumb({ item }: { item: Item }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(() => peekThumb(item));
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ready = peekThumb(item);
    if (ready) {
      setSrc(ready);
      return;
    }
    setSrc(null);
    setFailed(false);
    if (!ref.current) return;
    let alive = true;
    const stop = observe(ref.current, () => {
      getThumb(item)
        .then((u) => alive && setSrc(u))
        .catch(() => alive && setFailed(true));
    });
    return () => {
      alive = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.account_id, item.drive_id]);

  return (
    <div ref={ref} className={`thumb-wrap ${!loaded && !failed ? "skeleton" : ""}`}>
      {src && !failed && (
        <img
          className={`thumb ${loaded ? "loaded" : ""}`}
          src={src}
          alt={item.name}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
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
