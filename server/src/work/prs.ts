import type { CiState, OpenPr, ReviewState } from "../../../shared/work.js";
import type { CommandRunner } from "../mac/collect.js";

const CACHE_MS = 2 * 60_000;
const FIRST_WAIT_MS = 3000;

type SearchHit = { url: string; title: string; isDraft: boolean; repository: { name: string } };

// A CheckRun carries status/conclusion, a commit StatusContext carries state.
type Check = { status?: string | null; conclusion?: string | null; state?: string | null };

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

export const ciState = (checks: Check[]): CiState | null => {
  if (checks.length === 0) return null;
  const outcomes = checks.map((c) => c.conclusion ?? c.state ?? null);
  if (outcomes.some((o) => o !== null && FAILED.has(o))) return "failing";
  const pending = checks.some(
    (c) => (c.status !== undefined && c.status !== null && c.status !== "COMPLETED") || c.state === "PENDING",
  );
  return pending ? "pending" : "passing";
};

export const reviewState = (decision: string | null | undefined): ReviewState =>
  decision === "APPROVED" ? "approved" : decision === "CHANGES_REQUESTED" ? "changes_requested" : "pending";

export type PrLister = { list(): Promise<OpenPr[] | null> };

export const createPrLister = (
  run: CommandRunner,
  now: () => Date = () => new Date(),
  firstWaitMs = FIRST_WAIT_MS,
  owners: string[] = [],
): PrLister => {
  let cached: { value: OpenPr[] | null; at: number } | null = null;
  let refreshing: Promise<void> | null = null;
  // Read through a function: TypeScript would keep the narrowing from before the await.
  const latest = (): { value: OpenPr[] | null } | null => cached;

  const read = async (): Promise<OpenPr[] | null> => {
      try {
        const hits = JSON.parse(
          await run("gh", [
            "search",
            "prs",
            "--author=@me",
            "--state=open",
            ...owners.map((o) => `--owner=${o}`),
            "--json",
            "url,title,repository,isDraft",
            "--limit",
            "50",
          ]),
        ) as SearchHit[];
        const value = await Promise.all(
          hits.map(async (hit): Promise<OpenPr> => {
            const detail = JSON.parse(
              await run("gh", ["pr", "view", hit.url, "--json", "reviewDecision,statusCheckRollup"]),
            ) as { reviewDecision: string | null; statusCheckRollup: Check[] | null };
            return {
              url: hit.url,
              repo: hit.repository.name,
              title: hit.title,
              draft: hit.isDraft,
              ci: ciState(detail.statusCheckRollup ?? []),
              review: reviewState(detail.reviewDecision),
            };
          }),
        );
        return value;
      } catch {
        // gh missing, logged out or offline: the panel says it could not read PRs.
        return null;
      }
  };

  // gh takes seconds when cold: an older answer goes out at once while a new one is read in the background.
  return {
    list: async () => {
      if (cached && now().getTime() - cached.at < CACHE_MS) return cached.value;
      refreshing ??= read()
        .then((value) => {
          cached = { value, at: now().getTime() };
        })
        .finally(() => {
          refreshing = null;
        });
      if (cached) return cached.value;
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, firstWaitMs));
      await Promise.race([refreshing, timeout]);
      return latest()?.value ?? null;
    },
  };
};
