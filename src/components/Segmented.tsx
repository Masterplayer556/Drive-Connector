/** Schalter mit gleitendem Farbbalken (zwei oder mehr Teile). */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="segmented" style={{ ["--n" as string]: options.length, ["--idx" as string]: Math.max(0, index) }}>
      <span className={`seg-thumb ${index < 0 ? "none" : ""}`} />
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
