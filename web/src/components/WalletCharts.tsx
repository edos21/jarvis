import { useState } from "react";

import { HISTORY_RANGES, type HistoryRange, type LevelKind, type WalletPosition } from "../../../shared/wallet";
import { usePositionHistory, useWalletHistory } from "@/lib/api";
import { LEVEL_KIND_LABEL, amountIn, dayToMs, shortDay, ticker, usd } from "@/lib/format";
import { StatusText } from "./Status";
import { LineChart } from "./charts/LineChart";
import { Segmented } from "./charts/Segmented";
import { ChartCard } from "./charts/parts";

const RANGE_LABELS: Record<HistoryRange, string> = { "1m": "1M", "3m": "3M", "1y": "1A" };

// Status colors, as on the alerts: a stop is the danger line, a target the good one.
const LEVEL_COLOR: Record<LevelKind, string> = { stop: "var(--critical)", take_profit: "var(--good)", alert: "var(--warning)" };

export const WalletHistoryChart = () => {
  const [range, setRange] = useState<HistoryRange>("3m");
  const { data, error } = useWalletHistory(range);
  return (
    <ChartCard title="Valor de la cuenta IBKR" actions={<Segmented label="Rango" choices={HISTORY_RANGES} value={range} onChange={setRange} labels={RANGE_LABELS} />}>
      {error && <p className="text-body text-critical">No pude leer la historia: {error.message}</p>}
      {data && (
        <LineChart
          label={`Valor de la cuenta IBKR en USD, ${RANGE_LABELS[range]}`}
          series={[{ key: "nav", label: "Cuenta IBKR", color: "var(--series-1)", points: data.points.map((p) => ({ x: dayToMs(p.date), y: p.totalUsd })) }]}
          formatX={shortDay}
          formatY={usd}
        />
      )}
      {data && !data.navConfigured && (
        <p className="text-meta text-muted">
          La curva empieza el día en que Jarvis guardó su primer valor. Para ver el año anterior, crea en IBKR una segunda Flex
          Query con la sección "Net Asset Value (NAV) in Base", período "Last 365 Calendar Days" y formato XML, y pon su id en{" "}
          <code>JARVIS_IBKR_FLEX_NAV_QUERY_ID</code> dentro de <code>~/.jarvis/env</code>.
        </p>
      )}
      {data?.navError && (
        <p className="text-body">
          <StatusText severity="warning">No pude leer el NAV de IBKR: {data.navError}</StatusText>
        </p>
      )}
    </ChartCard>
  );
};

export const PositionChart = ({ position }: { position: WalletPosition }) => {
  const [range, setRange] = useState<HistoryRange>("3m");
  const { data, error, isLoading } = usePositionHistory(position.symbol, range);
  const money = (n: number) => amountIn(n, data?.currency ?? position.currency);
  return (
    <div className="grid gap-3 px-4 py-3">
      <header className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-meta text-muted">
          {ticker(position.symbol)} al cierre de cada día, con lo que pagaste y tus niveles
        </p>
        <Segmented label="Rango" choices={HISTORY_RANGES} value={range} onChange={setRange} labels={RANGE_LABELS} />
      </header>
      {isLoading && <p className="text-body text-muted">Pidiendo el historial a Yahoo…</p>}
      {error && <p className="text-body text-critical">{error.message}</p>}
      {data && (
        <LineChart
          label={`Precio de ${ticker(position.symbol)}, ${RANGE_LABELS[range]}`}
          series={[{ key: "close", label: ticker(position.symbol), color: "var(--series-1)", points: data.points.map((p) => ({ x: dayToMs(p.date), y: p.close })) }]}
          refs={[
            ...(data.costBasisPrice > 0 ? [{ key: "cost", y: data.costBasisPrice, label: `Tu costo ${money(data.costBasisPrice)}`, color: "var(--muted)" }] : []),
            ...data.levels.map((l) => ({ key: `level-${l.id}`, y: l.price, label: `${LEVEL_KIND_LABEL[l.kind]} ${money(l.price)}`, color: LEVEL_COLOR[l.kind] })),
          ]}
          formatX={shortDay}
          formatY={money}
        />
      )}
    </div>
  );
};
