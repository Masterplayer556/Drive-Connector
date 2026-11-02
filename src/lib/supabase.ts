import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** Ruft eine Edge Function auf und gibt verständliche Fehlermeldungen zurück. */
export async function callFunction<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const j = await ctx.clone().json();
        if (j?.error) message = j.error;
      } catch {
        /* keine JSON-Antwort */
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export const functionsUrl = `${url}/functions/v1`;
