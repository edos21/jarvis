import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";

import { type LevelDirection, type LevelKind, LEVEL_KINDS, type WalletPosition, type WalletResponse, sameTicker } from "../../../shared/wallet";
import { useAddLevel, useDeleteLevel, useIsRemote, useResearchList, useStartResearch, useWallet, useWalletRefresh } from "@/lib/api";
import { LEVEL_DIRECTION_LABEL, LEVEL_KIND_LABEL, amountIn, moveTone, severityStripe, pct, signedPct, ticker, timeOf, usd, wholeUnits } from "@/lib/format";
import { useIsPhone } from "@/lib/phone";
import { go, routeHref } from "@/lib/route";
import { Button, MutationButton } from "./Button";
import { InvestigateButton } from "./InvestigateButton";
import { MoveArrow, SeverityLabel } from "./Status";
import { PositionChart, WalletHistoryChart } from "./WalletCharts";

const inputClass =
  "rounded-md border border-control bg-surface px-2 py-1 text-meta text-ink placeholder:text-muted focus:border-accent";

const FlexSetup = () => (
  <section className="grid gap-2 rounded-lg border border-line bg-surface p-4 text-body">
    <h2 className="font-semibold">Conecta IBKR</h2>
    <ol className="list-decimal space-y-1 pl-5 text-muted">
      <li>
        En el portal de IBKR: Performance &amp; Reports → Flex Queries → nueva Activity Flex Query "Jarvis positions", con
        las secciones Open Positions (Summary) y Cash Report con todos sus campos (Select All), formato XML y período
        "Last Business Day".
      </li>
      <li>En Flex Web Service Configuration, genera el token con la vigencia máxima.</li>
      <li>
        Pon <code>JARVIS_IBKR_FLEX_TOKEN</code> y <code>JARVIS_IBKR_FLEX_QUERY_ID</code> en <code>~/.jarvis/env</code> y
        reinicia Jarvis.
      </li>
    </ol>
  </section>
);

const Tile = ({ label, value, sub, tone = "" }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) => (
  <div className="rounded-lg border border-line bg-surface px-4 py-3">
    <p className="text-meta text-muted">{label}</p>
    <p className={`font-mono text-[22px] [font-variant-numeric:tabular-nums] ${tone}`}>{value}</p>
    {sub && <p className="text-meta text-muted">{sub}</p>}
  </div>
);

const LevelsEditor = ({ wallet, position }: { wallet: WalletResponse; position: WalletPosition }) => {
  const add = useAddLevel();
  const remove = useDeleteLevel();
  const [direction, setDirection] = useState<LevelDirection>("below");
  const [kind, setKind] = useState<LevelKind>("alert");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const levels = wallet.levels.filter((l) => sameTicker(l.symbol, position.symbol));
  return (
    <div className="grid gap-2 bg-bg px-4 py-3 text-body">
      {levels.length === 0 && <p className="text-muted">Sin niveles. Te aviso cuando el precio cruce uno.</p>}
      {levels.map((level) => (
        <p key={level.id} className="flex flex-wrap items-center gap-2">
          <span>
            <span className="text-muted">{LEVEL_KIND_LABEL[level.kind]}:</span>{" "}
            {LEVEL_DIRECTION_LABEL[level.direction]} <b>{amountIn(level.price, position.currency)}</b>
            {level.note && <span className="text-muted"> · {level.note}</span>}
            {level.researchId !== null && (
              <>
                {" · "}
                <a className="underline" href={routeHref("analisis", level.researchId)}>
                  análisis
                </a>
              </>
            )}
          </span>
          <MutationButton mutation={remove} variant="danger" onClick={() => remove.mutate(level.id)}>
            Borrar
          </MutationButton>
        </p>
      ))}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(
            { symbol: position.symbol, direction, price: Number(price.replace(",", ".")), kind, note, researchId: null },
            {
              onSuccess: () => {
                setPrice("");
                setNote("");
              },
            },
          );
        }}
      >
        <select aria-label="Tipo" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as LevelKind)}>
          {LEVEL_KINDS.map((k) => (
            <option key={k} value={k}>
              {LEVEL_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select aria-label="Dirección" className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as LevelDirection)}>
          <option value="below">Baja de</option>
          <option value="above">Sube de</option>
        </select>
        <input aria-label="Precio" className={`${inputClass} w-24`} inputMode="decimal" placeholder={position.price.toFixed(2)} value={price} onChange={(e) => setPrice(e.target.value)} required />
        <input aria-label="Nota" className={`${inputClass} min-w-40 flex-1`} placeholder="stop de tesis, venta parcial…" value={note} onChange={(e) => setNote(e.target.value)} />
        <MutationButton mutation={add} type="submit">
          Agregar nivel
        </MutationButton>
      </form>
    </div>
  );
};

const SatelliteButton = () => {
  const { data } = useResearchList();
  const start = useStartResearch();
  const [confirming, setConfirming] = useState(false);
  const done = data?.satelliteThisMonth;
  const month = new Date().toLocaleDateString("es-UY", { month: "long" });
  const run = (confirm: boolean) => start.mutate({ kind: "satellite", subject: { type: "satellite" }, confirm });
  if (done && confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 max-sm:gap-2">
        <span className="text-meta text-muted">Ya existe {done}. ¿Otro? (hasta US$ 5)</span>
        <MutationButton mutation={start} variant="primary" onClick={() => run(true)}>
          Sí
        </MutationButton>
        <Button onClick={() => setConfirming(false)}>No</Button>
      </span>
    );
  }
  return (
    <MutationButton mutation={start} onClick={() => (done ? setConfirming(true) : run(false))} title="Corre tu Satellite Prompt Mensual con búsqueda web (hasta US$ 5)">
      {done ? `Ya corriste el de ${month}` : "Satellite pick del mes"}
    </MutationButton>
  );
};

type OpenPanel = { symbol: string; panel: "chart" | "levels" } | null;

const DayFigure = ({ position: p }: { position: WalletPosition }) => (
  <>
    <MoveArrow n={p.dayChangePct} />
    {p.dayChangePct === null ? "—" : signedPct(p.dayChangePct)}
  </>
);

// In the table the column header carries the currency, so the figure goes bare.
const PnlFigure = ({ position: p, bare = false }: { position: WalletPosition; bare?: boolean }) => (
  <>
    <MoveArrow n={p.pnlUsd} />
    {p.pnlUsd >= 0 ? "+" : "-"}
    {bare ? wholeUnits(Math.abs(p.pnlUsd)) : usd(Math.abs(p.pnlUsd))}
  </>
);

const PositionActions = ({
  position: p,
  levels,
  open,
  toggle,
  className,
}: {
  position: WalletPosition;
  levels: number;
  open: OpenPanel;
  toggle: (symbol: string, panel: "chart" | "levels") => void;
  className: string;
}) => {
  const remote = useIsRemote();
  return (
    <div className={className}>
      <InvestigateButton
        subject={{
          type: "ticker",
          symbol: p.symbol,
          ...(p.dayChangePct !== null ? { context: `${signedPct(p.dayChangePct)} hoy` } : {}),
        }}
      />
      <Button aria-expanded={open?.symbol === p.symbol && open.panel === "chart"} onClick={() => toggle(p.symbol, "chart")}>
        Gráfica
      </Button>
      {!remote && (
        <Button aria-expanded={open?.symbol === p.symbol && open.panel === "levels"} onClick={() => toggle(p.symbol, "levels")}>
          Niveles{levels > 0 ? ` (${levels})` : ""}
        </Button>
      )}
    </div>
  );
};

const PHONE_FIGURE = "grid gap-0.5";
const PHONE_FIGURE_LABEL = "text-meta text-muted";

// A table can't be read at phone width without scrolling sideways: each position becomes a short block, and its
// actions wait behind a tap on it so the list reads as figures, not as a wall of buttons.
const PositionRow = ({
  position: p,
  wallet,
  shown,
  onShow,
  open,
  toggle,
}: {
  position: WalletPosition;
  wallet: WalletResponse;
  shown: boolean;
  onShow: () => void;
  open: OpenPanel;
  toggle: (symbol: string, panel: "chart" | "levels") => void;
}) => (
  <li className="grid gap-2 px-4 py-3">
    <button type="button" aria-expanded={shown} onClick={onShow} className="grid gap-2 text-left">
      <span className="block">
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex items-baseline gap-1.5 text-title font-semibold">
            {ticker(p.symbol)}
            <ChevronDown
              className={`size-4 self-center text-muted transition-transform ${shown ? "rotate-180" : ""}`}
              strokeWidth={2.25}
              aria-hidden
            />
          </span>
          <span className="font-mono text-title">{usd(p.valueUsd)}</span>
        </span>
        <span className="block truncate text-meta text-muted">{p.description}</span>
      </span>
      <span className="grid grid-cols-3 gap-2 text-body">
        <span className={PHONE_FIGURE}>
          <span className={PHONE_FIGURE_LABEL}>Hoy</span>
          <span className={`whitespace-nowrap font-mono ${moveTone(p.dayChangePct)}`}>
            <DayFigure position={p} />
          </span>
        </span>
        <span className={PHONE_FIGURE}>
          <span className={PHONE_FIGURE_LABEL}>P&amp;L</span>
          <span className={`whitespace-nowrap font-mono ${moveTone(p.pnlUsd)}`}>
            <PnlFigure position={p} />
          </span>
        </span>
        <span className={PHONE_FIGURE}>
          <span className={PHONE_FIGURE_LABEL}>Peso</span>
          <span className="font-mono">{pct(p.weightPct)}</span>
        </span>
      </span>
      <span className="block text-meta text-muted [font-variant-numeric:tabular-nums]">
        {p.quantity} a {amountIn(p.price, p.currency)}
        {p.priceSource === "ibkr-close" && " · cierre IBKR"}
      </span>
    </button>
    {shown && (
      <PositionActions
        position={p}
        levels={wallet.levels.filter((l) => sameTicker(l.symbol, p.symbol)).length}
        open={open}
        toggle={toggle}
        className="flex flex-wrap gap-2"
      />
    )}
    {shown &&
      open?.symbol === p.symbol &&
      (open.panel === "chart" ? <PositionChart position={p} /> : <LevelsEditor wallet={wallet} position={p} />)}
  </li>
);

export const WalletPage = () => {
  const { data: wallet, error, isLoading } = useWallet();
  const refresh = useWalletRefresh();
  const phone = useIsPhone();
  // One expanded row at a time, showing either the position's chart or its levels.
  const [open, setOpen] = useState<OpenPanel>(null);
  // On the phone, the one position whose actions are showing.
  const [shownRow, setShownRow] = useState<string | null>(null);
  const toggle = (symbol: string, panel: "chart" | "levels") =>
    setOpen((current) => (current?.symbol === symbol && current.panel === panel ? null : { symbol, panel }));
  const view = wallet?.view;
  return (
    <main className="mx-auto grid max-w-5xl content-start gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[28px] leading-tight">Cartera</h1>
          {view && (
            <p className="text-meta text-muted">
              IBKR al cierre del {view.flexReportDate}
              {view.pricesAt ? ` · precios de las ${timeOf(view.pricesAt)}` : " · sin precios en vivo todavía"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 max-sm:gap-2">
          <MutationButton mutation={refresh} onClick={() => refresh.mutate("prices")} disabled={!view}>
            Actualizar precios
          </MutationButton>
          {wallet?.configured && (
            <Button onClick={() => refresh.mutate("flex")} disabled={refresh.isPending}>
              Actualizar IBKR
            </Button>
          )}
          <SatelliteButton />
          <Button onClick={() => go("analisis")}>Análisis</Button>
        </div>
      </header>
      {isLoading && <p className="text-muted">Leyendo la cartera…</p>}
      {error && <p className="text-critical">No pude leer la cartera: {error.message}</p>}
      {wallet && !wallet.configured && !view && <FlexSetup />}
      {wallet?.alerts
        .filter((a) => a.kind === "sync")
        .map((a) => (
          <div key={a.key} className="grid gap-0.5 rounded-lg border border-l-4 border-line bg-surface px-4 py-3 text-body" style={severityStripe(a.severity)}>
            <SeverityLabel severity={a.severity} />
            <p>
              <b>{a.title}.</b> <span className="text-muted">{a.detail}</span>
            </p>
          </div>
        ))}
      {view && wallet && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="IBKR ahora" value={usd(view.totalIbkrUsd)} sub={`incluye ${usd(view.cashUsd)} en cash`} />
            <Tile
              label="Hoy"
              value={
                view.dayChangePct === null ? (
                  "—"
                ) : (
                  <>
                    <MoveArrow n={view.dayChangePct} />
                    {`${view.dayChangeUsd >= 0 ? "+" : "-"}${usd(Math.abs(view.dayChangeUsd))}`}
                  </>
                )
              }
              sub={view.dayChangePct === null ? "mercado cerrado o sin precios de hoy" : signedPct(view.dayChangePct)}
              tone={moveTone(view.dayChangePct)}
            />
            {wallet.others && (
              <Tile
                label="Toda la cartera"
                value={usd(view.totalIbkrUsd + wallet.others.totalUsd)}
                sub={`otros custodios a mano${wallet.others.asOf ? `, al ${wallet.others.asOf}` : ""}`}
              />
            )}
          </div>
          <WalletHistoryChart />
          {phone ? (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {view.positions.map((p) => (
                <PositionRow
                  key={p.symbol}
                  position={p}
                  wallet={wallet}
                  shown={shownRow === p.symbol}
                  onShow={() => {
                    setShownRow((s) => (s === p.symbol ? null : p.symbol));
                    setOpen(null);
                  }}
                  open={open}
                  toggle={toggle}
                />
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[46rem] text-body [font-variant-numeric:tabular-nums]">
                <thead className="whitespace-nowrap text-left text-meta text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Ticker</th>
                    <th className="px-2 py-2 text-right font-medium">Shares</th>
                    <th className="px-2 py-2 text-right font-medium">Precio</th>
                    <th className="px-2 py-2 text-right font-medium">Hoy</th>
                    <th className="px-2 py-2 text-right font-medium">Valor USD</th>
                    <th className="px-2 py-2 text-right font-medium">P&amp;L USD</th>
                    <th className="px-2 py-2 text-right font-medium">%</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {view.positions.map((p) => {
                    const levels = wallet.levels.filter((l) => sameTicker(l.symbol, p.symbol)).length;
                    return (
                      <Fragment key={p.symbol}>
                        <tr className="border-b border-line last:border-0">
                          <td className="px-4 py-2">
                            <p className="font-medium">{ticker(p.symbol)}</p>
                            <p className="max-w-32 truncate text-meta text-muted">{p.description}</p>
                          </td>
                          <td className="px-2 py-2 text-right font-mono">{p.quantity}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-right font-mono">
                            {amountIn(p.price, p.currency)}
                            {p.priceSource === "ibkr-close" && <span className="block text-meta text-muted">cierre IBKR</span>}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-2 text-right font-mono ${moveTone(p.dayChangePct)}`}>
                            <DayFigure position={p} />
                          </td>
                          <td className="px-2 py-2 text-right font-mono">{wholeUnits(p.valueUsd)}</td>
                          <td className={`whitespace-nowrap px-2 py-2 text-right font-mono ${moveTone(p.pnlUsd)}`}>
                            <PnlFigure position={p} bare />
                          </td>
                          <td className="px-2 py-2 text-right font-mono">{pct(p.weightPct)}</td>
                          <td className="px-4 py-2">
                            <PositionActions position={p} levels={levels} open={open} toggle={toggle} className="flex justify-end gap-1.5" />
                          </td>
                        </tr>
                        {open?.symbol === p.symbol && (
                          <tr className="border-b border-line">
                            <td colSpan={8}>
                              {open.panel === "chart" ? <PositionChart position={p} /> : <LevelsEditor wallet={wallet} position={p} />}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
};
