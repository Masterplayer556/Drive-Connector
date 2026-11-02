/** Zweiteiliger Schalter mit gleitendem Farbbalken. */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [{ value: T; label: string }, { value: T; label: string }];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="segmented">
      <span className={`seg-thumb ${index === 1 ? "second" : ""} ${index < 0 ? "none" : ""}`} />
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
