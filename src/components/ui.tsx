// Eigene Dialoge (Bestätigen / Eingabe) und Meldungen (Toasts) mit Animationen.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

type ToastKind = "info" | "ok" | "error";

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  leaving?: boolean;
}

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOpts {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
}

type Req =
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOpts)
  | ({ kind: "prompt"; resolve: (v: string | null) => void } & PromptOpts);

interface UI {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  toast: (text: string, kind?: ToastKind) => void;
}

const Ctx = createContext<UI | null>(null);

export function useUI(): UI {
  const ui = useContext(Ctx);
  if (!ui) throw new Error("UIProvider fehlt");
  return ui;
}

const TOAST_ICON: Record<ToastKind, IconName> = { info: "sparkles", ok: "checkCircle", error: "alert" };

export function UIProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Req | null>(null);
  const [closing, setClosing] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    const ms = kind === "error" ? 6000 : 3200;
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), ms);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms + 350);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setReq({ kind: "confirm", resolve, ...opts })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.initial ?? "");
        setInvalid(null);
        setReq({ kind: "prompt", resolve, ...opts });
      }),
    [],
  );

  useEffect(() => {
    if (req?.kind === "prompt") setTimeout(() => inputRef.current?.focus(), 120);
  }, [req]);

  const finish = (result: boolean) => {
    if (!req) return;
    if (req.kind === "prompt" && result) {
      const v = value.trim();
      const err = req.validate?.(v) ?? (v ? null : "Bitte etwas eingeben");
      if (err) {
        setInvalid(err);
        return;
      }
    }
    setClosing(true);
    setTimeout(() => {
      if (req.kind === "confirm") req.resolve(result);
      else req.resolve(result ? value.trim() : null);
      setReq(null);
      setClosing(false);
    }, 180);
  };

  return (
    <Ctx.Provider value={{ confirm, prompt, toast }}>
      {children}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind} ${t.leaving ? "leaving" : ""}`}>
            <Icon name={TOAST_ICON[t.kind]} size={18} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {req && (
        <div className={`modal-backdrop ${closing ? "closing" : ""}`} onClick={() => finish(false)}>
          <form
            className={`modal glass ${closing ? "closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              finish(true);
            }}
          >
            <h3>{req.title}</h3>
            {req.message && <p className="muted">{req.message}</p>}
            {req.kind === "prompt" && (
              <>
                <input
                  ref={inputRef}
                  className="input"
                  value={value}
                  placeholder={req.placeholder}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setInvalid(null);
                  }}
                />
                {invalid && <p className="error small">{invalid}</p>}
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => finish(false)}>
                Abbrechen
              </button>
              <button type="submit" className={`btn ${req.kind === "confirm" && req.danger ? "danger-solid" : "primary"}`}>
                {req.confirmLabel ?? (req.kind === "confirm" ? "OK" : "Erstellen")}
              </button>
            </div>
          </form>
        </div>
      )}
    </Ctx.Provider>
  );
}
