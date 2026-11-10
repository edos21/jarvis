export type AccountKind = "personal";

export type GoogleAccount = { email: string; kind: AccountKind; connectedAt: string };

export type GoogleStatus = { configured: boolean; accounts: GoogleAccount[] };
