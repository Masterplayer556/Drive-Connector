import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkError, reloadOnce } from "../lib/reload";
import Icon from "./Icon";

interface Props {
  children: ReactNode;
  /** Ganzer Bildschirm (äusserster Fang) statt nur der Bereich einer Ansicht */
  full?: boolean;
  /** Für Hintergrund-Helfer ohne eigene Anzeige: bei einem Fehler einfach nichts zeigen (und nie neu laden) */
  silent?: boolean;
}

interface State {
  error: Error | null;
  /** Die Seite lädt gerade von selbst neu (App-Update) – so lange nichts anzeigen */
  reloading: boolean;
}

/**
 * Fängt Fehler beim Zeichnen ab. Ohne diesen Fang bleibt bei einem Fehler in einer Ansicht der ganze
 * Bildschirm leer – in der installierten App hilft dann nur noch, sie zu beenden.
 * Konnte nach einem App-Update ein Programmteil nicht nachgeladen werden, lädt die Seite einmal von selbst neu.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Anzeige-Fehler", error, info.componentStack);
    if (!this.props.silent && isChunkError(error) && reloadOnce()) this.setState({ reloading: true });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (reloading || this.props.silent) return null;

    const update = isChunkError(error);
    const title = update ? "Neue Version" : "Hoppla";
    const text = update
      ? "Die App wurde aktualisiert. Bitte neu laden, damit alles wieder zusammenpasst."
      : "Hier ist etwas schiefgegangen. Deine Fotos sind davon nicht betroffen.";
    const buttons = (
      <>
        <button className="btn primary" onClick={() => location.reload()}>
          Neu laden
        </button>
        {!update && (
          <button className="btn ghost" onClick={() => this.setState({ error: null })}>
            Nochmals versuchen
          </button>
        )}
      </>
    );

    if (this.props.full) {
      return (
        <div className="auth">
          <div className="auth-card glass" role="alert">
            <h1>{title}</h1>
            <p className="sub">{text}</p>
            {!update && <p className="error-detail">{error.message}</p>}
            {buttons}
          </div>
        </div>
      );
    }
    return (
      <div className="empty" role="alert">
        <div className="empty-icon">
          <Icon name="alert" size={30} />
        </div>
        <strong>{title}</strong>
        <span>{text}</span>
        {!update && <span className="error-detail">{error.message}</span>}
        <div className="error-actions">{buttons}</div>
      </div>
    );
  }
}
