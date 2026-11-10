import type { OpenPr, PepperSummary, FactoryItem, WorkSummary } from "../../../shared/work.js";
import { type BoardHandoff, type PepperBoard, allInProduction } from "./pepper.js";

const IN_PROGRESS = new Set(["in_progress", "pr_open"]);

type WithHandoff = { identifier: string; title: string; handoff: BoardHandoff | null };

export const summarizePepper = (board: PepperBoard | null, boardUrl: string, myFactories: string[]): PepperSummary => {
  if (!board) {
    return { reachable: false, boardUrl, decisions: 0, factoryWaiting: [], factoryInProgress: 0, toVerify: [] };
  }
  // handedOff tickets left the Linear view but a factory may still be on them; their handoff fields are flat.
  const all: WithHandoff[] = [
    ...board.tickets,
    ...board.handedOff.map(({ identifier, title, ...handoff }) => ({ identifier, title, handoff })),
  ];
  const mine = new Set(myFactories.map((f) => f.toLowerCase()));
  const factory = all.filter(
    (t) => t.handoff?.kind === "factory" && t.handoff.outcome && mine.has(t.handoff.target.toLowerCase()),
  );
  const factoryWaiting = factory
    .filter((t) => t.handoff?.outcome?.result === "waiting_on_me")
    .map(
      (t): FactoryItem => ({
        identifier: t.identifier,
        title: t.title,
        factory: t.handoff?.target ?? "",
        stage: t.handoff?.outcome?.factoryStage ?? null,
        url: t.handoff?.url ?? boardUrl,
      }),
    );
  return {
    reachable: true,
    boardUrl,
    decisions: board.tickets.filter((t) => t.column === "needs_my_decision").length,
    factoryWaiting,
    factoryInProgress: factory.filter((t) => IN_PROGRESS.has(t.handoff?.outcome?.result ?? "")).length,
    toVerify: board.tickets
      .filter((t) => t.column === "awaiting_verification" && allInProduction(t.deploys))
      .map((t) => ({ identifier: t.identifier, title: t.title, url: t.url })),
  };
};

export const buildWorkSummary = (
  board: PepperBoard | null,
  prs: OpenPr[] | null,
  boardUrl: string,
  myFactories: string[],
  now: Date,
): WorkSummary => ({ pepper: summarizePepper(board, boardUrl, myFactories), prs, collectedAt: now.toISOString() });
