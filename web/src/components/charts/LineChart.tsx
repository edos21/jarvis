import { useMemo, useState } from "react";

import { ChartEmpty, ChartLegend, Dot, TOOLTIP_CLASS, YGrid } from "./parts";
import { linear, niceTicks, pathOf, useWidth } from "./scale";

export type LinePoint = { x: number; y: number };
export type LineSeries = { key: string; label: string; color: string; points: LinePoint[] };
// A price drawn across the chart: what I paid, a stop, a target.
export type RefLine = { key: string; y: number; label: string; color: string };

type Props = {
  label: string;
  series: LineSeries[];
  refs?: RefLine[];
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  // Fixed bounds (percentages); otherwise the data and the reference lines decide.
  yDomain?: [number, number];
  height?: number;
};

const MARGIN = { top: 12, right: 12, bottom: 24, left: 52 };
const X_TICKS = 5;
// An estimate of the axis text's width, enough to keep two time labels from landing on each other.
const TICK_CHAR_WIDTH = 7;
const TICK_GAP = 16;
const DAY_MS = 86_400_000;
// One shared empty list, so the default never looks like a change to the memo below.
const NO_REFS: RefLine[] = [];

// Reference labels sit at the right end of their line; one too close to the previous goes to the left end instead.
const LABEL_GAP = 13;
// The reference label is 13px Plex Sans; its plate is sized from the text length, a little wider than the glyphs.
const LABEL_CHAR_WIDTH = 7.6;
const LABEL_PAD = 3;
const placeLabels = (refs: RefLine[], y: (v: number) => number): Map<string, "start" | "end"> => {
  const placed = new Map<string, "start" | "end">();
  const lastAt = { start: -Infinity, end: -Infinity };
  for (const r of [...refs].sort((a, b) => b.y - a.y)) {
    const at = y(r.y);
    const side = at - lastAt.end >= LABEL_GAP || at - lastAt.start < LABEL_GAP ? "end" : "start";
    placed.set(r.key, side);
    lastAt[side] = at;
  }
  return placed;
};

// Points come sorted by x: the closest one to the pointer by binary search.
const nearest = (points: LinePoint[], x: number): LinePoint | undefined => {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.x < x) lo = mid + 1;
    else hi = mid;
  }
  const after = points[lo];
  const before = points[lo - 1];
  return before && after && x - before.x < after.x - x ? before : after;
};

export const LineChart = ({ label, series, refs = NO_REFS, formatX, formatY, yDomain, height = 220 }: Props) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  // Everything but the crosshair: moving the pointer redraws only that.
  const chart = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length === 0) return null;
    const ys = [...all.map((p) => p.y), ...refs.map((r) => r.y)];
    const ticks = niceTicks(...(yDomain ?? [Math.min(...ys), Math.max(...ys)]));
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    // A single day still gets a span, so its point sits in the middle instead of on the axis.
    const [x0, x1] = minX === maxX ? [minX - DAY_MS, maxX + DAY_MS] : [minX, maxX];
    const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
    const x = linear([x0, x1], [MARGIN.left, MARGIN.left + plotWidth]);
    const y = linear([ticks[0] ?? 0, ticks.at(-1) ?? 1], [height - MARGIN.bottom, MARGIN.top]);
    const anchor = series[0]?.points ?? [];
    // Evenly spread over the points, never two ticks that would print the same label, and only as many as fit.
    const spreadOver = (count: number): number[] =>
      count > 1 ? Array.from({ length: count }, (_, i) => anchor[Math.round((i * (anchor.length - 1)) / (count - 1))]!.x) : [minX];
    const widest = Math.max(...spreadOver(Math.min(X_TICKS, anchor.length)).map((t) => formatX(t).length)) * TICK_CHAR_WIDTH + TICK_GAP;
    // The end labels are anchored inward, so a neighbor needs room for one and a half labels.
    const fit = Math.max(Math.floor(plotWidth / (widest * 1.5)) + 1, 2);
    const spread = spreadOver(Math.min(X_TICKS, anchor.length, fit));
    const labels = new Map<string, number>();
    for (const t of spread) if (!labels.has(formatX(t))) labels.set(formatX(t), t);
    return {
      ticks,
      x0,
      x1,
      plotWidth,
      x,
      y,
      xTicks: [...labels].map(([text, t]) => ({ text, t })),
      paths: series.map((s) => pathOf(s.points, x, y)),
      labelSide: placeLabels(refs, y),
    };
  }, [series, refs, yDomain, width, height, formatX]);

  if (!chart) return <ChartEmpty />;
  const { ticks, x0, x1, plotWidth, x, y, xTicks, paths, labelSide } = chart;
  const hovered = hoverX === null ? undefined : nearest(series[0]?.points ?? [], hoverX);
  const hoveredPoints = hovered ? series.map((s) => ({ s, p: nearest(s.points, hovered.x) })) : [];
  const single = series.length === 1 ? series[0] : undefined;
  const baseline = y(ticks[0] ?? 0);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = Math.min(Math.max(event.clientX - box.left, MARGIN.left), MARGIN.left + plotWidth);
    setHoverX(x0 + ((px - MARGIN.left) / (plotWidth || 1)) * (x1 - x0));
  };

  return (
    <div className="grid gap-2">
      {series.length > 1 && <ChartLegend items={series} swatch="line" />}
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={label}
            className="touch-none select-none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHoverX(null)}
          >
            <YGrid ticks={ticks} y={y} left={MARGIN.left} width={plotWidth} />
            {xTicks.map(({ text, t }, i) => (
              <text
                key={t}
                x={x(t)}
                y={height - 6}
                textAnchor={xTicks.length === 1 ? "middle" : i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
                className="fill-muted text-fine"
              >
                {text}
              </text>
            ))}
            {refs.map((r) => (
              <line key={r.key} x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(r.y)} y2={y(r.y)} stroke={r.color} strokeWidth={1.5} strokeDasharray="4 4" />
            ))}
            {single && single.points.length > 1 && (
              <path
                d={`${paths[0]}L${x(single.points.at(-1)!.x)},${baseline}L${x(single.points[0]!.x)},${baseline}Z`}
                fill={single.color}
                opacity={0.1}
              />
            )}
            {series.map((s, i) => (
              <path key={s.key} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {/* Labels go over the price line, so their halo keeps them readable where the line crosses them. */}
            {refs.map((r) => {
              const start = labelSide.get(r.key) === "start";
              const lx = start ? MARGIN.left + 4 : MARGIN.left + plotWidth;
              const width = r.label.length * LABEL_CHAR_WIDTH + 2 * LABEL_PAD;
              return (
                <g key={r.key}>
                  {/* A plate in the surface color: a halo alone leaves the line showing between the words. */}
                  <rect
                    x={start ? lx - LABEL_PAD : lx - width + LABEL_PAD}
                    y={y(r.y) - 19}
                    width={width}
                    height={18}
                    rx={3}
                    fill="var(--surface)"
                  />
                  <text x={lx} y={y(r.y) - 5} textAnchor={start ? "start" : "end"} className="fill-ink text-fine">
                    {r.label}
                  </text>
                </g>
              );
            })}
            {series.map((s) => {
              const last = s.points.at(-1);
              return last && <Dot key={s.key} cx={x(last.x)} cy={y(last.y)} color={s.color} />;
            })}
            {hovered && (
              <g>
                <line x1={x(hovered.x)} x2={x(hovered.x)} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="var(--muted)" strokeWidth={1} />
                {hoveredPoints.map(({ s, p }) => p && <Dot key={s.key} cx={x(p.x)} cy={y(p.y)} color={s.color} />)}
              </g>
            )}
          </svg>
        )}
        {hovered && (
          <div className={TOOLTIP_CLASS} style={x(hovered.x) > width / 2 ? { right: width - x(hovered.x) + 8 } : { left: x(hovered.x) + 8 }}>
            <span className="text-muted">{formatX(hovered.x)}</span>
            {hoveredPoints.map(
              ({ s, p }) =>
                p && (
                  <span key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                    {series.length > 1 && <span className="text-muted">{s.label}</span>}
                    <span className="font-medium tabular-nums">{formatY(p.y)}</span>
                  </span>
                ),
            )}
          </div>
        )}
      </div>
    </div>
  );
};
