// Vektor ↔ kurzer Text (Float32-Skalierung + Int8, Base64) – für Supabase.

/** Vektor → kurzer Text (gerundet auf 8 Bit; für die Suche genau genug). */
export function encodeVec(v: Float32Array): string {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max || 1;
  const bytes = new Uint8Array(4 + v.length);
  new DataView(bytes.buffer).setFloat32(0, scale, true);
  for (let i = 0; i < v.length; i++) bytes[4 + i] = (Math.round((v[i] / scale) * 127) + 256) % 256;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Text → Vektor (wieder auf Länge 1 gebracht). */
export function decodeVec(text: string): Float32Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const scale = new DataView(bytes.buffer).getFloat32(0, true);
  const v = new Float32Array(bytes.length - 4);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const b = bytes[4 + i];
    v[i] = ((b > 127 ? b - 256 : b) / 127) * scale;
    sum += v[i] * v[i];
  }
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
