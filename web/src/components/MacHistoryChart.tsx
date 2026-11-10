import { useState } from "react";

import { MAC_RANGES, MAC_SAMPLE_MINUTES, type MacRange, type MacSample } from "../../../shared/mac";
import { useMacHistory } from "@/lib/api";
import { shortDay, timeOf } from "@/lib/format";
import { LineChart } from "./charts/LineChart";
import { Segmented } from "./charts/Segmented";
import { ChartCard } from "./charts/parts";
import { SERIES_COLORS } from "./charts/scale";

const RANGE_LABELS: Record<MacRange, string> = { "24h": "24 h", "7d": "7 días", "30d": "30 días" };

const METRICS: { key: "cpuPct" | "memPct" | "diskPct"; label: string }[] = [
  { key: "cpuPct", label: "CPU" },
  { key: "memPct", label: "Memoria" },
  { key: "diskPct", label: "Disco" },
];

const pct = (n: number): string => `${Math.round(n)}%`;

// The figures under the chart: the same numbers as text, so no color has to be told apart to read them.
const Summary = ({ samples }: { samples: MacSample[] }) => (
  <table className="w-full text-body [font-variant-numeric:tabular-nums]">
    <thead className="text-left text-meta text-muted">
      <tr>
        <th className="py-1 font-medium" />
        <th className="py-1 text-right font-medium">Promedio</th>
        <th className="py-1 text-right font-medium">Máximo</th>
      </tr>
    </thead>
    <tbody>
      {METRICS.map((m, i) => {
        const values = samples.map((s) => s[m.key]);
        return (
          <tr key={m.key} className="border-t border-line">
            <td className="py-1">
              <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: SERIES_COLORS[i] }} />
              {m.label}
            </td>
            <td className="py-1 text-right font-mono">{pct(values.reduce((a, b) => a + b, 0) / values.length)}</td>
            <td className="py-1 text-right font-mono">{pct(Math.max(...values))}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

export const MacHistoryChart = () => {
  const [range, setRange] = useState<MacRange>("24h");
  const { data, error } = useMacHistory(range);
  return (
    <ChartCard title="Historia" actions={<Segmented label="Rango" choices={MAC_RANGES} value={range} onChange={setRange} labels={RANGE_LABELS} />}>
      {error && <p className="text-body text-critical">No pude leer la historia: {error.message}</p>}
      {data && data.length < 2 && <p className="text-body text-muted">Jarvis guarda una lectura cada {MAC_SAMPLE_MINUTES} minutos; la gráfica aparece con la segunda.</p>}
      {data && data.length >= 2 && (
        <>
          <LineChart
            label={`CPU, memoria y disco, ${RANGE_LABELS[range]}`}
            series={METRICS.map((m, i) => ({
              key: m.key,
              label: m.label,
              color: SERIES_COLORS[i] ?? "var(--muted)",
              points: data.map((s) => ({ x: Date.parse(s.at), y: s[m.key] })),
            }))}
            yDomain={[0, 100]}
            formatX={range === "24h" ? timeOf : shortDay}
            formatY={pct}
          />
          <Summary samples={data} />
        </>
      )}
    </ChartCard>
  );
};
