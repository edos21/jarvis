import { describe, expect, it } from "vitest";

import type { BoardTicket, HandedOffTicket, PepperBoard } from "./pepper.js";
import { fetchPepperBoard } from "./pepper.js";
import { ciState, createPrLister } from "./prs.js";
import { summarizePepper } from "./summary.js";

const BOARD_URL = "http://127.0.0.1:4318";
const MINE = ["Atlas"];

const ticket = (over: Partial<BoardTicket>): BoardTicket => ({
  identifier: "ENG-1",
  title: "Ticket",
  url: "https://linear.app/x/ENG-1",
  column: "needs_analysis",
  handoff: null,
  deploys: null,
  ...over,
});

const factory = (result: string, stage: string | null = null) => ({
  kind: "factory" as const,
  target: "Atlas",
  url: "https://factory.example.com/atlas/ENG-9",
  outcome: { result: result as "waiting_on_me", factoryStage: stage },
});

const board = (tickets: BoardTicket[], handedOff: HandedOffTicket[] = []): PepperBoard => ({ tickets, handedOff });

describe("summarizePepper", () => {
  it("leaves out a teammate's factory: what it waits on is theirs, not mine", () => {
    const orion = { ...factory("waiting_on_me"), target: "Orion" };
    const s = summarizePepper(
      board([ticket({ identifier: "ENG-7", handoff: orion }), ticket({ identifier: "ENG-9", handoff: factory("waiting_on_me") })]),
      BOARD_URL,
      ["atlas"],
    );
    expect(s.factoryWaiting.map((f) => f.identifier)).toEqual(["ENG-9"]);
  });

  it("counts needs_my_decision", () => {
    const s = summarizePepper(
      board([ticket({ column: "needs_my_decision" }), ticket({ column: "needs_my_decision" }), ticket({})]),
      BOARD_URL,
      MINE,
    );
    expect(s.decisions).toBe(2);
  });

  it("lists factory waiting_on_me with panel url", () => {
    const s = summarizePepper(
      board([ticket({ identifier: "ENG-9", handoff: factory("waiting_on_me", "Necesita ingeniero") })]),
      BOARD_URL,
      MINE,
    );
    expect(s.factoryWaiting).toEqual([
      {
        identifier: "ENG-9",
        title: "Ticket",
        factory: "Atlas",
        stage: "Necesita ingeniero",
        url: "https://factory.example.com/atlas/ENG-9",
      },
    ]);
  });

  it("includes handedOff tickets", () => {
    const handed: HandedOffTicket = {
      ...factory("in_progress"),
      identifier: "ENG-7",
      title: "Gone from the view",
      ticketUrl: "https://linear.app/x/ENG-7",
    };
    const s = summarizePepper(board([ticket({ handoff: factory("pr_open") })], [handed]), BOARD_URL, MINE);
    expect(s.factoryInProgress).toBe(2);
  });

  it("toVerify only when every PR is live in production", () => {
    const s = summarizePepper(
      board([
        ticket({
          identifier: "ENG-2",
          column: "awaiting_verification",
          deploys: [{ url: "u", environment: "production", deploy: null }],
        }),
        ticket({
          identifier: "ENG-3",
          column: "awaiting_verification",
          deploys: [{ url: "u", environment: "production", deploy: "deploying" }],
        }),
        ticket({ identifier: "ENG-4", column: "awaiting_verification", deploys: null }),
      ]),
      BOARD_URL,
      MINE,
    );
    expect(s.toVerify.map((t) => t.identifier)).toEqual(["ENG-2"]);
  });

  it("pepper unreachable → reachable false, other fields empty", () => {
    expect(summarizePepper(null, BOARD_URL, MINE)).toEqual({
      reachable: false,
      boardUrl: BOARD_URL,
      decisions: 0,
      factoryWaiting: [],
      factoryInProgress: 0,
      toVerify: [],
    });
  });
});

describe("fetchPepperBoard", () => {
  it("returns null when the fetch throws", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await fetchPepperBoard(failing, "http://127.0.0.1:4317")).toBeNull();
  });

  it("returns null on timeout", async () => {
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const started = Date.now();
    expect(await fetchPepperBoard(slow, "http://127.0.0.1:4317", 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("open PRs", () => {
  it("ci failing when any check is FAILURE", () => {
    expect(ciState([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "FAILURE" }])).toBe(
      "failing",
    );
    expect(ciState([{ state: "ERROR" }])).toBe("failing");
  });

  it("ci pending while a check runs, passing when all completed, null without checks", () => {
    expect(ciState([{ status: "IN_PROGRESS", conclusion: null }])).toBe("pending");
    expect(ciState([{ status: "COMPLETED", conclusion: "SKIPPED" }, { state: "SUCCESS" }])).toBe("passing");
    expect(ciState([])).toBeNull();
  });

  it("prs null when gh fails", async () => {
    const lister = createPrLister(async () => {
      throw new Error("gh: not logged in");
    });
    expect(await lister.list()).toBeNull();
  });

  it("reads each PR's review and checks", async () => {
    const run = async (_cmd: string, args: string[]) =>
      args[0] === "search"
        ? JSON.stringify([
            { url: "https://github.com/acme/api/pull/1", title: "fix", isDraft: false, repository: { name: "api" } },
          ])
        : JSON.stringify({ reviewDecision: "APPROVED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] });
    expect(await createPrLister(run).list()).toEqual([
      { url: "https://github.com/acme/api/pull/1", repo: "api", title: "fix", draft: false, ci: "passing", review: "approved" },
    ]);
  });
});

describe("open PRs when gh is slow", () => {
  it("answers null after the first wait, then the result once gh finishes", async () => {
    let release: (value: string) => void = () => undefined;
    const run = (_cmd: string, args: string[]) =>
      args[0] === "search"
        ? new Promise<string>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(JSON.stringify({ reviewDecision: null, statusCheckRollup: [] }));
    const lister = createPrLister(run, () => new Date(), 20);
    expect(await lister.list()).toBeNull();
    release("[]");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await lister.list()).toEqual([]);
  });
});
