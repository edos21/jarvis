// The slice of Pepper's GET /api/board that Jarvis reads (Pepper's shared/board.ts and shared/deploys.ts).
// Copied, not imported: Jarvis never depends on another repo's code.

export type HandoffResult =
  | "in_progress"
  | "waiting_on_me"
  | "pr_open"
  | "merged"
  | "done"
  | "canceled"
  | "closed_without_merge";

export type BoardHandoff = {
  kind: "factory" | "local" | "local_phi" | "pr";
  target: string;
  url: string | null;
  outcome: { result: HandoffResult; factoryStage: string | null } | null;
};

export type PrReach = {
  url: string;
  environment: "production" | "staging" | "unknown";
  deploy: "deployed" | "deploying" | "failed" | null;
};

export type BoardTicket = {
  identifier: string;
  title: string;
  url: string;
  column: string;
  handoff: BoardHandoff | null;
  deploys: PrReach[] | null;
};

export type HandedOffTicket = BoardHandoff & { identifier: string; title: string; ticketUrl: string };

export type PepperBoard = { tickets: BoardTicket[]; handedOff: HandedOffTicket[] };

// Live in production: every merged PR reached it and none is still deploying or failed to.
export const allInProduction = (deploys: PrReach[] | null): boolean =>
  !!deploys?.length &&
  deploys.every(
    ({ environment, deploy }) => environment === "production" && (deploy === null || deploy === "deployed"),
  );

// A GET without Origin passes Pepper's guard. Null when Pepper is not running or too slow: Jarvis never starts it.
export const fetchPepperBoard = async (
  fetchFn: typeof fetch,
  baseUrl: string,
  timeoutMs = 1500,
): Promise<PepperBoard | null> => {
  try {
    const res = await fetchFn(`${baseUrl}/api/board`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as PepperBoard;
  } catch {
    return null;
  }
};
