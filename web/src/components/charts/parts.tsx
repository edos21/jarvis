import { Heading } from "../Heading";
import { compact } from "./scale";

// The block every chart sits in: a title, its choices on the right, the chart and its notes below.
export const ChartCard = ({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) => (
  <section className="grid gap-3 rounded-lg border border-line bg-surface p-4">
    <header className="flex flex-wrap items-center gap-3">
      <Heading className="flex-1">{title}</Heading>
      {actions}
    </header>
    {children}
  </section>
);

export const ChartEmpty = () => <p className="text-meta text-muted">Todavía no hay datos para esta gráfica.</p>;

export const TOOLTIP_CLASS = "pointer-events-none absolute top-0 z-10 grid gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-meta shadow-sm";

export const ChartLegend = ({ items, swatch }: { items: { key: string; label: string; color: string }[]; swatch: "line" | "square" }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-fine text-muted">
    {items.map((item) => (
      <li key={item.key} className="flex items-center gap-1.5">
        <span className={`inline-block ${swatch === "line" ? "h-0.5 w-3 rounded" : "size-2.5 rounded-sm"}`} style={{ background: item.color }} />
        {item.label}
      </li>
    ))}
  </ul>
);

// Hairline gridlines with their values on the left.
export const YGrid = ({ ticks, y, left, width }: { ticks: number[]; y: (v: number) => number; left: number; width: number }) =>
  ticks.map((t) => (
    <g key={t}>
      <line x1={left} x2={left + width} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
      <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-fine">
        {compact(t, ticks)}
      </text>
    </g>
  ));

// A point on a line, ringed in the surface color so it stays readable where lines cross.
export const Dot = ({ cx, cy, color }: { cx: number; cy: number; color: string }) => (
  <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
);
