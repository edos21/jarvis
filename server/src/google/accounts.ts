import { eq } from "drizzle-orm";

import type { AccountKind, GoogleAccount } from "../../../shared/google.js";
import type { Db } from "../db.js";
import { googleAccounts } from "../schema.js";

export type StoredAccount = GoogleAccount & { refreshToken: string; scopes: string };

export type AccountStore = {
  list(): StoredAccount[];
  get(email: string): StoredAccount | null;
  save(account: { email: string; kind: AccountKind; refreshToken: string; scopes: string }): void;
  remove(email: string): boolean;
};

export const createAccountStore = (db: Db): AccountStore => ({
  list: () => db.select().from(googleAccounts).all(),
  get: (email) => db.select().from(googleAccounts).where(eq(googleAccounts.email, email)).get() ?? null,
  save: ({ email, kind, refreshToken, scopes }) => {
    db.insert(googleAccounts)
      .values({ email, kind, refreshToken, scopes })
      .onConflictDoUpdate({
        target: googleAccounts.email,
        set: { kind, refreshToken, scopes, connectedAt: new Date().toISOString() },
      })
      .run();
  },
  remove: (email) => db.delete(googleAccounts).where(eq(googleAccounts.email, email)).run().changes > 0,
});

// What the API may show of an account: never the token.
export const publicAccount = ({ email, kind, connectedAt }: StoredAccount): GoogleAccount => ({ email, kind, connectedAt });
