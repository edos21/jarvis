import { useState } from "react";

import { ChartEmpty, ChartLegend, TOOLTIP_CLASS, YGrid } from "./parts";
import { compact, linear, niceTicks, useWidth } from "./scale";

export type BarSegment = { key: string; value: number };
export type Bar = { key: string; label: string; segments: BarSegment[] };

type Props = {
  label: string;
  bars: Bar[];
  // Each segment key's color and name: the same entity keeps its color in every bar.
  legend: { key: string; label: string; color: string }[];
  formatValue: (n: number) => string;
  selected?: string | null;
  onSelect?: (key: string) => void;
  height?: number;
};

const MARGIN = { top: 18, right: 8, bottom: 24, left: 52 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

// A column with its top corners rounded and its base square, from y0 (bottom) to y1 (top).
const column = (x: number, w: number, y0: number, y1: number, rounded: boolean): string => {
  const r = rounded ? Math.min(RADIUS, (y0 - y1) / 2, w / 2) : 0;
  return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
};

// Only what adds up is stacked: a refund that leaves a category negative is in the table, not stacked under zero.
export const StackedBars = ({ label, bars, legend, formatValue, selected, onSelect, height = 220 }: Props) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  if (bars.length === 0) return <ChartEmpty />;
  // The stack is what adds up; its label is the bar's net total (refunds included), the same figure as in the table.
  const heights = bars.map((b) => b.segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0));
  const totals = bars.map((b) => b.segments.reduce((sum, s) => sum + s.value, 0));
  const ticks = niceTicks(0, Math.max(...heights));
  const y = linear([0, ticks.at(-1) ?? 1], [height - MARGIN.bottom, MARGIN.top]);
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const band = plotWidth / bars.length;
  const barWidth = Math.min(MAX_BAR, band * 0.6);
  const entryOf = new Map(legend.map((l) => [l.key, l]));
  const hovered = bars.find((b) => b.key === hover);

  return (
    <div className="grid gap-2">
      <ChartLegend items={legend} swatch="square" />
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label} className="select-none">
            <YGrid ticks={ticks} y={y} left={MARGIN.left} width={plotWidth} />
            {bars.map((bar, i) => {
              const left = MARGIN.left + band * i + (band - barWidth) / 2;
              const positive = bar.segments.filter((s) => s.value > 0);
              let base = 0;
              const dim = selected && selected !== bar.key;
              return (
                <g
                  key={bar.key}
                  className={onSelect ? "cursor-pointer" : undefined}
                  onClick={() => onSelect?.(bar.key)}
                  onPointerEnter={() => setHover(bar.key)}
                  onPointerLeave={() => setHover(null)}
                >
                  {/* The hit target is the whole band, not just the bar. */}
                  <rect x={MARGIN.left + band * i} y={MARGIN.top} width={band} height={height - MARGIN.top - MARGIN.bottom} fill="transparent" />
                  <g opacity={dim ? 0.45 : 1}>
                    {positive.map((s, j) => {
                      const y0 = y(base) - (j === 0 ? 0 : GAP / 2);
                      base += s.value;
                      const y1 = y(base) + (j === positive.length - 1 ? 0 : GAP / 2);
                      return y0 - y1 > 0.5 && <path key={s.key} d={column(left, barWidth, y0, y1, j === positive.length - 1)} fill={entryOf.get(s.key)?.color} />;
                    })}
                  </g>
                  <text x={left + barWidth / 2} y={y(heights[i] ?? 0) - 5} textAnchor="middle" className="fill-ink text-fine">
                    {compact(totals[i] ?? 0, ticks)}
                  </text>
                  <text x={left + barWidth / 2} y={height - 6} textAnchor="middle" className={`text-fine ${selected === bar.key ? "fill-ink font-semibold" : "fill-muted"}`}>
                    {bar.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hovered && (
          <div className={`${TOOLTIP_CLASS} right-0`}>
            <span className="text-muted">{hovered.label}</span>
            {hovered.segments.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block size-2 rounded-sm" style={{ background: entryOf.get(s.key)?.color }} />
                <span className="text-muted">{entryOf.get(s.key)?.label ?? s.key}</span>
                <span className="font-medium tabular-nums">{formatValue(s.value)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
