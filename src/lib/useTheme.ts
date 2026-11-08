import { useEffect, useState } from "react";
import { currentTheme, THEME_EVENT, type ThemeId } from "./theme";

/** Aktives Design (folgt jedem Wechsel, auch durch „Automatisch hell/dunkel“). */
export function useThemeId(): ThemeId {
  const [id, setId] = useState<ThemeId>(currentTheme);
  useEffect(() => {
    const on = () => setId(currentTheme());
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  return id;
}
