import { useMemo, useState } from "react";

import type { SpendingMonth } from "../../../shared/statements";
import { useSpending } from "@/lib/api";
import { amountIn, dayToMs } from "@/lib/format";
import { Segmented } from "./charts/Segmented";
import { StackedBars } from "./charts/StackedBars";
import { ChartCard } from "./charts/parts";
import { OTHER_COLOR, SERIES_COLORS } from "./charts/scale";

const OTHERS = "Otros";

const monthLabel = (month: string): string => new Date(dayToMs(month)).toLocaleDateString("es-UY", { month: "short", year: "numeric" });

// The biggest categories of the currency keep a color each, in fixed order; the rest add up as "Otros".
const colorsFor = (months: SpendingMonth[]): Map<string, string> => {
  const totals = new Map<string, number>();
  for (const month of months) for (const c of month.categories) totals.set(c.category, (totals.get(c.category) ?? 0) + c.total);
  const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  return new Map(ranked.map((category, i) => [category, SERIES_COLORS[i] ?? OTHER_COLOR]));
};

export const SpendingChart = () => {
  const { data, error } = useSpending();
  const currencies = useMemo(() => [...new Set(data?.months.map((m) => m.currency))], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const currency = picked && currencies.includes(picked) ? picked : currencies[0];
  const months = useMemo(() => data?.months.filter((m) => m.currency === currency) ?? [], [data, currency]);
  const colors = useMemo(() => colorsFor(months), [months]);
  const named = [...colors].filter(([, color]) => color !== OTHER_COLOR);
  const keyOf = (category: string) => (colors.get(category) === OTHER_COLOR ? OTHERS : category);
  const month = months.find((m) => m.month === selected) ?? months.at(-1);
  const money = (n: number) => amountIn(n, currency ?? "USD");

  if (error) return <p className="text-critical">No pude calcular los gastos: {error.message}</p>;
  if (!data || months.length === 0) return null;
  return (
    <ChartCard
      title="Gastos por mes"
      actions={
        currencies.length > 1 &&
        currency && <Segmented label="Moneda" choices={currencies} value={currency} onChange={(c) => (setPicked(c), setSelected(null))} />
      }
    >
      <StackedBars
        label={`Gastos por mes en ${currency}, por categoría`}
        bars={months.map((m) => {
          const segments = new Map<string, number>();
          for (const c of m.categories) segments.set(keyOf(c.category), (segments.get(keyOf(c.category)) ?? 0) + c.total);
          return { key: m.month, label: monthLabel(m.month), segments: [...segments].map(([key, value]) => ({ key, value })) };
        })}
        legend={[
          ...named.map(([category, color]) => ({ key: category, label: category, color })),
          ...(named.length < colors.size ? [{ key: OTHERS, label: OTHERS, color: OTHER_COLOR }] : []),
        ]}
        formatValue={money}
        selected={month?.month ?? null}
        onSelect={setSelected}
      />
      {month && (
        <table className="w-full text-body [font-variant-numeric:tabular-nums]">
          <caption className="pb-1 text-left text-meta text-muted">
            {monthLabel(month.month)}: {money(month.total)}. Toca otro mes para ver su detalle.
          </caption>
          <tbody>
            {month.categories.map((c) => (
              <tr key={c.category} className="border-t border-line">
                <td className="py-1">
                  <span className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: colors.get(c.category) }} />
                  {c.category}
                </td>
                <td className={`py-1 text-right font-mono ${c.total < 0 ? "text-good" : ""}`}>{money(c.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-body text-muted">
        Si el estado trae la categoría, se usa esa; si no, sale de tus patrones en <code>{data.rulesFile}</code> (una línea{" "}
        <code>PATRÓN=Categoría</code> por comercio).
        {data.skipped.length > 0 && ` No pude leer ${data.skipped.join(", ")}, así que no cuenta.`}
      </p>
    </ChartCard>
  );
};
