// Wann lohnt es sich, einen Aufruf an Google zu wiederholen? (getestet in retry.test.ts)
// Google bremst bei vielen Aufrufen kurz hintereinander (429 bzw. 403 „rateLimitExceeded“) und hat
// gelegentlich einen Aussetzer (5xx). Beides geht nach kurzem Warten meist von selbst vorbei.

export const MAX_RETRIES = 3;

const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

/**
 * Darf dieser Aufruf wiederholt werden?
 * - gebremst (429 / 403 mit Rate-Limit-Grund): immer – Google hat den Aufruf gar nicht ausgeführt
 * - Server-Aussetzer (500–504): nur wenn das Wiederholen nichts verdoppeln kann, also nicht bei POST
 *   (sonst entstünde z. B. ein Ordner zweimal, wenn der erste Versuch doch noch durchging)
 */
export async function shouldRetry(res: Response, method: string): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.status >= 500 && res.status <= 504) return method.toUpperCase() !== "POST";
  if (res.status !== 403) return false;
  try {
    const body = await res.clone().json();
    return ((body?.error?.errors ?? []) as { reason?: string }[]).some((e) => RATE_REASONS.has(e.reason ?? ""));
  } catch {
    return false;
  }
}

/** Wartezeit vor dem nächsten Versuch: was Google vorgibt (Retry-After), sonst 0,6 s · 2ⁿ mit etwas Zufall. */
export function backoffMs(attempt: number, res?: Response, random: () => number = Math.random): number {
  const after = Number(res?.headers.get("Retry-After"));
  if (Number.isFinite(after) && after > 0) return Math.min(after * 1000, 20_000);
  return Math.round(600 * 2 ** attempt * (0.75 + random() * 0.5));
}
