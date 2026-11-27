import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

/** Steuerung von aussen (Doppeltippen spult, Leertaste pausiert) */
export interface VideoHandle {
  seekBy: (s: number) => void;
  toggle: () => void;
}

/** So lange darf das Video hängen (lädt, obwohl es spielen sollte), bevor es neu angefordert wird */
const STALL_MS = 7000;
/** Höchstens so oft neu anfordern – danach bleibt es beim Ladekreis */
const MAX_RELOADS = 3;

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Video mit eigener Steuerung statt der des Browsers: Die eingebaute fing jede Berührung ab (kein Blättern,
 * kein Antippen zum Ausblenden) und sprang beim Drehen des iPhones in den Vollbild-Player, aus dem man
 * nicht sauber zurückkam. Hier gehen Berührungen auf dem Bild an die Ansicht; nur die Leiste unten
 * (Zeit, Spulen, Ton) gehört dem Video.
 */
export default function VideoPlayer({
  src,
  hidden,
  handle,
  onError,
  onShown,
  onPlaying,
}: {
  src: string;
  /** Leisten ausgeblendet (Antippen) → Steuerung auch */
  hidden: boolean;
  handle: React.RefObject<VideoHandle | null>;
  onError: () => void;
  /** Erstes Bild ist da – die Vorschau darunter kann weg */
  onShown: () => void;
  onPlaying: (playing: boolean) => void;
}) {
  const v = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [muted, setMuted] = useState(false);
  /** Position beim Ziehen am Balken (0–1), solange gezogen wird */
  const [scrub, setScrub] = useState<number | null>(null);
  const [hint, setHint] = useState<{ dir: 1 | -1; id: number } | null>(null);
  // Hängt die Wiedergabe (häufig beim zweiten Abspielen), wird die Adresse neu angefordert und an derselben
  // Stelle weitergemacht. Bei Blob-Adressen (ganz geladen) gibt es nichts neu anzufordern.
  const [reload, setReload] = useState(0);
  const resumeAt = useRef<number | null>(null);
  const wantPlay = useRef(true);
  const stallTimer = useRef(0);
  const url = reload && !src.startsWith("blob:") ? `${src}${src.includes("?") ? "&" : "?"}r=${reload}` : src;

  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;
  useEffect(() => onPlayingRef.current(playing), [playing]);
  useEffect(() => () => onPlayingRef.current(false), []);
  useEffect(() => () => clearTimeout(stallTimer.current), []);

  const play = () => {
    const el = v.current;
    if (!el) return;
    wantPlay.current = true;
    // Ende erreicht (falls das Wiederholen einmal nicht greift) → von vorne
    if (el.ended || (el.duration && el.currentTime >= el.duration - 0.05)) el.currentTime = 0;
    el.play().catch(() => setPlaying(false));
  };
  const toggle = () => {
    const el = v.current;
    if (!el) return;
    if (el.paused) play();
    else {
      wantPlay.current = false;
      el.pause();
    }
  };
  const seekTo = (t: number) => {
    const el = v.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(t, el.duration - 0.05));
    setCur(el.currentTime);
  };
  handle.current = {
    toggle,
    seekBy: (s) => {
      const el = v.current;
      if (!el) return;
      seekTo(el.currentTime + s);
      setHint({ dir: s > 0 ? 1 : -1, id: Date.now() });
    },
  };
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 650);
    return () => clearTimeout(t);
  }, [hint]);
  useEffect(
    () => () => {
      handle.current = null;
    },
    [handle],
  );

  const armStall = () => {
    clearTimeout(stallTimer.current);
    stallTimer.current = window.setTimeout(() => {
      const el = v.current;
      // Nur wenn es spielen soll (nicht pausiert, nicht von iOS am Autostart gehindert)
      if (!el || !wantPlay.current || el.paused || src.startsWith("blob:")) return;
      setReload((n) => {
        if (n >= MAX_RELOADS) return n;
        resumeAt.current = el.currentTime;
        return n + 1;
      });
    }, STALL_MS);
  };
  const clearStall = () => clearTimeout(stallTimer.current);

  // Balken: Finger/Maus folgt direkt, gespult wird gedrosselt (jeder Sprung ist beim Streamen ein neuer Abruf)
  const track = useRef<HTMLDivElement>(null);
  const lastSeek = useRef(0);
  const wasPlaying = useRef(false);
  const fracAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const scrubMove = (clientX: number, final = false) => {
    const f = fracAt(clientX);
    setScrub(final ? null : f);
    const now = performance.now();
    if (final || now - lastSeek.current > 180) {
      lastSeek.current = now;
      seekTo(f * dur);
    }
  };

  const shownFrac = scrub ?? (dur ? cur / dur : 0);
  // Antippen blendet alles aus; nur pausiert bleibt der Abspielknopf, damit man weiss, wie es weitergeht
  const showBar = !hidden;
  const showCenter = !hidden || !playing;

  return (
    <>
      <video
        ref={v}
        className="viewer-video"
        src={url}
        autoPlay
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDur(el.duration);
          if (resumeAt.current !== null) {
            el.currentTime = resumeAt.current;
            resumeAt.current = null;
            if (wantPlay.current) el.play().catch(() => undefined);
          }
          el.muted = muted;
        }}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onLoadedData={onShown}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (scrub === null) setCur(el.currentTime);
          if (!el.paused && el.readyState >= 3) {
            clearStall();
            setWaiting(false);
          }
        }}
        onProgress={(e) => {
          const el = e.currentTarget;
          const b = el.buffered;
          for (let i = 0; i < b.length; i++)
            if (b.start(i) <= el.currentTime + 0.5 && b.end(i) >= el.currentTime) return setBuffered(b.end(i));
        }}
        onPlay={() => {
          wantPlay.current = true;
          setPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
          clearStall();
        }}
        onPlaying={() => {
          setWaiting(false);
          clearStall();
        }}
        onWaiting={() => {
          setWaiting(true);
          armStall();
        }}
        onStalled={() => wantPlay.current && armStall()}
        onSeeking={() => wantPlay.current && armStall()}
        onSeeked={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        // Falls das Wiederholen (loop) einmal nicht greift: von vorne weiter
        onEnded={() => wantPlay.current && play()}
        onError={() => {
          // Neu angeforderte Adresse scheitert → wie ein Fehler beim ersten Mal (Rückfall: ganz laden)
          clearStall();
          onError();
        }}
      />
      {hint && (
        <div key={hint.id} className={`video-seek-hint ${hint.dir === 1 ? "fwd" : "back"}`}>
          {hint.dir === 1 ? "+10 s" : "−10 s"}
        </div>
      )}
      {waiting && wantPlay.current && scrub === null ? (
        <div className="video-center">
          <span className="spinner" />
        </div>
      ) : (
        <button
          className={`video-play glass ${showCenter ? "" : "off"}`}
          onClick={toggle}
          aria-label={playing ? "Pause" : "Abspielen"}
          tabIndex={showCenter ? 0 : -1}
        >
          <Icon name={playing ? "pause" : "play"} size={30} />
        </button>
      )}
      <div className={`video-bar glass ${showBar ? "" : "off"}`} inert={!showBar}>
        <button className="video-btn" onClick={toggle} aria-label={playing ? "Pause" : "Abspielen"}>
          <Icon name={playing ? "pause" : "play"} size={20} />
        </button>
        <span className="video-time">{fmt(scrub !== null ? scrub * dur : cur)}</span>
        <div
          ref={track}
          className={`video-track ${scrub !== null ? "active" : ""}`}
          role="slider"
          aria-label="Position im Video"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur) || 0}
          aria-valuenow={Math.round(cur)}
          aria-valuetext={`${fmt(cur)} von ${fmt(dur)}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              e.stopPropagation();
              handle.current?.seekBy(e.key === "ArrowLeft" ? -5 : 5);
            }
          }}
          onPointerDown={(e) => {
            if (!dur) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            wasPlaying.current = !!v.current && !v.current.paused;
            v.current?.pause();
            lastSeek.current = 0;
            scrubMove(e.clientX);
          }}
          onPointerMove={(e) => scrub !== null && scrubMove(e.clientX)}
          onPointerUp={(e) => {
            if (scrub === null) return;
            scrubMove(e.clientX, true);
            if (wasPlaying.current) play();
          }}
          onPointerCancel={() => {
            setScrub(null);
            if (wasPlaying.current) play();
          }}
        >
          <div className="video-track-bg">
            <div className="video-track-buf" style={{ width: `${dur ? Math.min(100, (buffered / dur) * 100) : 0}%` }} />
            <div className="video-track-fill" style={{ width: `${shownFrac * 100}%` }} />
          </div>
          <div className="video-track-knob" style={{ left: `${shownFrac * 100}%` }} />
        </div>
        <span className="video-time">{fmt(dur)}</span>
        <button
          className="video-btn"
          onClick={() => {
            const m = !muted;
            setMuted(m);
            if (v.current) v.current.muted = m;
          }}
          aria-label={muted ? "Ton an" : "Ton aus"}
        >
          <Icon name={muted ? "volumeOff" : "volume"} size={20} />
        </button>
      </div>
    </>
  );
}
