import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import type { FlexSnapshot, NavPoint } from "../../../shared/wallet.js";
import type { Db } from "../db.js";
import { walletCash, walletMeta, walletNav, walletPositions } from "../schema.js";

// ibkr: the close from the NAV Flex Query; live: my own valuation of the day, until IBKR's close replaces it.
export type NavSource = "ibkr" | "live";

export type WalletMetaKey = "reportDate" | "cashBaseUsd" | "lastFlexAt" | "lastFlexError" | "carteraAt" | "carteraError" | "lastNavError";

export type WalletStore = {
  // Replaces the previous snapshot as a whole, so a sold position disappears.
  saveSnapshot(snapshot: FlexSnapshot): void;
  latestSnapshot(): FlexSnapshot | null;
  meta(key: WalletMetaKey): string | null;
  setMeta(key: WalletMetaKey, value: string | null): void;
  // IBKR's close replaces any value of that day; a live value never replaces IBKR's. A live value older than IBKR's
  // latest close was a day without a close (a market holiday) and is dropped.
  saveNav(points: NavPoint[], source: NavSource): void;
  nav(fromDate: string): NavPoint[];
};

export const createWalletStore = (db: Db): WalletStore => {
  const meta = (key: WalletMetaKey): string | null =>
    db.select().from(walletMeta).where(eq(walletMeta.key, key)).get()?.value ?? null;
  const setMeta = (key: WalletMetaKey, value: string | null): void => {
    if (value === null) db.delete(walletMeta).where(eq(walletMeta.key, key)).run();
    else db.insert(walletMeta).values({ key, value }).onConflictDoUpdate({ target: walletMeta.key, set: { value } }).run();
  };
  return {
    saveSnapshot: (snapshot) => {
      db.transaction((tx) => {
        tx.delete(walletPositions).run();
        tx.delete(walletCash).run();
        if (snapshot.positions.length > 0) tx.insert(walletPositions).values(snapshot.positions).run();
        if (snapshot.cash.length > 0) tx.insert(walletCash).values(snapshot.cash).run();
      });
      setMeta("reportDate", snapshot.reportDate);
      setMeta("cashBaseUsd", snapshot.cashBaseUsd === null ? null : String(snapshot.cashBaseUsd));
    },
    latestSnapshot: () => {
      const reportDate = meta("reportDate");
      if (!reportDate) return null;
      return {
        reportDate,
        positions: db.select().from(walletPositions).all(),
        cash: db.select().from(walletCash).all(),
        cashBaseUsd: meta("cashBaseUsd") === null ? null : Number(meta("cashBaseUsd")),
      };
    },
    meta,
    setMeta,
    saveNav: (points, source) => {
      if (points.length === 0) return;
      db.insert(walletNav)
        .values(points.map((p) => ({ ...p, source })))
        .onConflictDoUpdate({
          target: walletNav.date,
          set: { totalUsd: sql`excluded.total_usd`, source },
          setWhere: source === "live" ? eq(walletNav.source, "live") : undefined,
        })
        .run();
      const latest = points.reduce((max, p) => (p.date > max ? p.date : max), "");
      if (source === "ibkr") db.delete(walletNav).where(and(eq(walletNav.source, "live"), lt(walletNav.date, latest))).run();
    },
    nav: (fromDate) =>
      db
        .select({ date: walletNav.date, totalUsd: walletNav.totalUsd })
        .from(walletNav)
        .where(gte(walletNav.date, fromDate))
        .orderBy(asc(walletNav.date))
        .all(),
  };
};
