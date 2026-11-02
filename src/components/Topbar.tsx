import type { ReactNode } from "react";

/** Grosse Titelzeile im iOS-Stil, klebt beim Scrollen oben (Glas-Effekt). */
export default function Topbar({
  eyebrow,
  title,
  left,
  right,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        {left}
        <div className="topbar-title">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}
