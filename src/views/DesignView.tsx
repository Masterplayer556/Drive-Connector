import Icon from "../components/Icon";
import ThemePicker from "../components/ThemePicker";
import Topbar from "../components/Topbar";
import { navigate } from "../lib/route";
import { THEMES } from "../lib/theme";
import { useThemeId } from "../lib/useTheme";

/** Eigene Seite für Design & Farbe (unter „Mehr“). */
export default function DesignView() {
  const theme = useThemeId();
  return (
    <div className="view page-fade">
      <Topbar
        eyebrow={`Aktiv: ${THEMES.find((t) => t.id === theme)?.name ?? ""}`}
        title="Design"
        left={
          <button className="icon-btn" onClick={() => navigate("mehr")} aria-label="Zurück">
            <Icon name="chevronLeft" />
          </button>
        }
      />
      <ThemePicker />
    </div>
  );
}
