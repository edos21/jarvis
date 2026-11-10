import { type WalletResponse, sameTicker } from "../../../shared/wallet";
import { useNews, useWalletHistory } from "@/lib/api";
import { moveTone, signedPct, ticker, usd } from "@/lib/format";
import { MoveArrow } from "./Status";
import { Sparkline } from "./charts/Sparkline";

// Today's side column: the wallet at a glance, the three biggest movers and news about what I hold.
const NO_SYMBOLS: string[] = [];

// hideSymbols: tickers with their own card on Today, left out of the movers.
export const WalletBlock = ({ wallet, hideSymbols = NO_SYMBOLS }: { wallet: WalletResponse | null; hideSymbols?: string[] }) => {
  const { data: news } = useNews("markets");
  const { data: history } = useWalletHistory("1m");
  if (!wallet) return <p className="text-meta text-muted">No se pudo leer la cartera.</p>;
  const view = wallet.view;
  if (!view) {
    return (
      <p className="text-meta text-muted">
        Conecta IBKR en <a className="underline" href="#cartera">Cartera</a>.
      </p>
    );
  }
  const movers = view.positions
    .filter((p) => p.dayChangePct !== null && !hideSymbols.some((s) => sameTicker(s, p.symbol)))
    .sort((a, b) => Math.abs(b.dayChangePct ?? 0) - Math.abs(a.dayChangePct ?? 0))
    .slice(0, 3);
  // The newest headline of each held ticker, at most three: one busy ticker must not fill the column.
  const headlines = (news?.items ?? [])
    .filter((item, i, all) => item.ticker && all.findIndex((other) => other.ticker === item.ticker) === i)
    .slice(0, 3);
  return (
    <div className="grid gap-2 text-body">
      <a href="#cartera" className="flex items-baseline justify-between gap-2 hover:text-accent max-sm:min-h-11 max-sm:items-center">
        <span className="whitespace-nowrap font-mono text-[18px] [font-variant-numeric:tabular-nums]">{usd(view.totalIbkrUsd)}</span>
        <Sparkline values={history?.points.map((p) => p.totalUsd) ?? []} label="La cuenta IBKR en el último mes" />
        <span className={`whitespace-nowrap font-mono ${moveTone(view.dayChangePct)}`}>
          <MoveArrow n={view.dayChangePct} />
          {view.dayChangePct === null ? "—" : signedPct(view.dayChangePct)}
        </span>
      </a>
      {movers.length > 0 && (
        <ul>
          {movers.map((p) => (
            <li key={p.symbol} className="flex justify-between py-0.5">
              <span>{ticker(p.symbol)}</span>
              <span className={`whitespace-nowrap font-mono ${moveTone(p.dayChangePct)}`}>
                <MoveArrow n={p.dayChangePct} />
                {signedPct(p.dayChangePct ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {headlines.length > 0 && (
        <ul className="grid gap-1 border-t border-line pt-2">
          {headlines.map((item) => (
            <li key={item.id}>
              <a href={item.url} target="_blank" rel="noreferrer" className="line-clamp-2 hover:text-accent max-sm:min-h-11">
                <b>{item.ticker}</b> · {item.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
