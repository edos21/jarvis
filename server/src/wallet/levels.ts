import { eq } from "drizzle-orm";

import type { LevelInput, WalletLevel } from "../../../shared/wallet.js";
import type { Db } from "../db.js";
import { walletLevels } from "../schema.js";

export type LevelStore = {
  list(): WalletLevel[];
  create(input: LevelInput): WalletLevel;
  remove(id: number): boolean;
};

const COLUMNS = {
  id: walletLevels.id,
  symbol: walletLevels.symbol,
  direction: walletLevels.direction,
  price: walletLevels.price,
  kind: walletLevels.kind,
  note: walletLevels.note,
  researchId: walletLevels.researchId,
};

export const createLevelStore = (db: Db): LevelStore => ({
  list: () => db.select(COLUMNS).from(walletLevels).all(),
  create: ({ symbol, direction, price, kind, note, researchId }) =>
    db
      .insert(walletLevels)
      .values({ symbol, direction, price, kind, note: note?.trim() || null, researchId })
      .returning(COLUMNS)
      .get(),
  remove: (id) => db.delete(walletLevels).where(eq(walletLevels.id, id)).run().changes > 0,
});
