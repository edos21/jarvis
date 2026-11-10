import { linear, pathOf } from "./scale";

// A trend beside a number: no axes, the last point marked. Too few points draw nothing.
export const Sparkline = ({ values, label, width = 96, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) => {
  if (values.length < 2) return null;
  const x = linear([0, values.length - 1], [3, width - 4]);
  const y = linear([Math.min(...values), Math.max(...values)], [height - 4, 4]);
  const d = pathOf(values.map((v, i) => ({ x: i, y: v })), x, y);
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      <path d={d} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
};
