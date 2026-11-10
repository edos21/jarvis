import { useEffect, useRef, useState } from "react";

export type Scale = (value: number) => number;

export const linear = (domain: [number, number], range: [number, number]): Scale => {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
};

export const pathOf = (points: { x: number; y: number }[], x: Scale, y: Scale): string =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("");

// Round steps (1, 2, 2.5, 5 × 10ⁿ) that cover the data, so axis labels read as clean numbers.
export const niceTicks = (min: number, max: number, count = 4): number[] => {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return niceTicks(min - pad, max + pad, count);
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 0.999; t += step) ticks.push(Number(t.toPrecision(12)));
  return ticks;
};

// Full under 10,000 and compact above it (12.9K, 1.2M), one style per axis.
export const compact = (n: number, ticks: number[]): string => {
  const top = Math.max(...ticks.map(Math.abs));
  return top >= 10_000
    ? n.toLocaleString("es-UY", { notation: "compact", maximumFractionDigits: 1 })
    : n.toLocaleString("es-UY", { maximumFractionDigits: 2 });
};

// The chart draws at the width its column gives it.
export const useWidth = <T extends HTMLElement>(): [React.RefObject<T | null>, number] => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

// Fixed order, never cycled: a category keeps its color across months and filters.
export const SERIES_COLORS = Array.from({ length: 7 }, (_, i) => `var(--series-${i + 1})`);
export const OTHER_COLOR = "var(--muted)";
