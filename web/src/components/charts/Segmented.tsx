import { touchTarget } from "../Button";

// One row of choices above a chart (a range, a currency), the current one marked.
export const Segmented = <T extends string>({
  label,
  choices,
  value,
  onChange,
  labels,
}: {
  label: string;
  choices: readonly T[];
  value: T;
  onChange: (choice: T) => void;
  labels?: Record<T, string>;
}) => (
  <div role="group" aria-label={label} className="inline-flex rounded-md border border-control p-0.5 text-meta">
    {choices.map((c) => (
      <button
        key={c}
        type="button"
        aria-pressed={c === value}
        onClick={() => onChange(c)}
        className={`rounded px-2 py-0.5 max-sm:min-w-11 ${touchTarget} ${c === value ? "bg-highlight font-medium text-ink" : "text-muted hover:text-ink"}`}
      >
        {labels?.[c] ?? c}
      </button>
    ))}
  </div>
);
