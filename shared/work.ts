// A ticket a factory (a build agent) is working on, named by the factory that has it.
export type FactoryItem = { identifier: string; title: string; factory: string; stage: string | null; url: string };

export type TicketRef = { identifier: string; title: string; url: string };

export type CiState = "passing" | "failing" | "pending";

export type ReviewState = "approved" | "changes_requested" | "pending";

export type OpenPr = { url: string; repo: string; title: string; draft: boolean; ci: CiState | null; review: ReviewState };

export type PepperSummary = {
  reachable: boolean;
  boardUrl: string;
  decisions: number;
  factoryWaiting: FactoryItem[];
  factoryInProgress: number;
  // Merged work already live in production that is waiting for me to verify it.
  toVerify: TicketRef[];
};

export type WorkSummary = { pepper: PepperSummary; prs: OpenPr[] | null; collectedAt: string };
