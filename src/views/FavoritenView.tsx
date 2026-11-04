import { lazy, Suspense, useEffect, useState } from "react";
import Icon from "../components/Icon";
import { GridSkeleton } from "../components/Skeleton";
import Thumb from "../components/Thumb";
import { TagDots } from "../components/TagSheet";
import { useTags } from "../lib/tags";
import Topbar from "../components/Topbar";
import { fetchFavoriteItems } from "../lib/db";
import { onFavoritesChange } from "../lib/favorites";
import { navigate } from "../lib/route";
import type { Account, Item } from "../lib/types";

const Viewer = lazy(() => import("../components/Viewer"));

export default function FavoritenView({ accounts }: { accounts: Account[] }) {
  useTags();
  const [items, setItems] = useState<Item[] | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);

  const load = () => fetchFavoriteItems().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void load();
    return onFavoritesChange(() => void load());
  }, []);

  return (
    <div className="view page-forward">
      <Topbar
        eyebrow={items ? `${items.length} Fotos` : "Lädt …"}
        title="Favoriten"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      {items === null ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="heart" size={30} />
          </div>
          <strong>Noch keine Favoriten</strong>
          <span>Tippe in der Foto-Ansicht auf das Herz.</span>
        </div>
      ) : (
        <div className="grid stagger">
          {items.map((f, i) => (
            <button key={`${f.account_id}|${f.drive_id}`} className="cell" style={{ ["--i" as string]: i }} onClick={() => setViewer(i)}>
              <Thumb item={f} />
              <TagDots item={f} />
              <span className="cell-name">{f.name}</span>
                          {f.mime_type?.startsWith("video/") && (
                            <span className="cell-play">
                              <Icon name="play" size={14} />
                            </span>
                          )}
            </button>
          ))}
        </div>
      )}
      {viewer !== null && items?.[viewer] && (
        <Suspense fallback={null}>
          <Viewer items={items} index={viewer} accounts={accounts} onIndex={setViewer} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </div>
  );
}
