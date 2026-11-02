/** Schimmernde Platzhalter, während Inhalte laden. */
export function FolderSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="folders">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="folder skeleton" style={{ height: 64 }} />
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="thumb-wrap skeleton" />
      ))}
    </div>
  );
}

export function LineSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="stack pad">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton line" style={{ width: `${60 + ((i * 37) % 40)}%` }} />
      ))}
    </div>
  );
}
