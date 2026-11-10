import type { Hono } from "hono";

import type { WorkSummary } from "../../../shared/work.js";
import { fetchPepperBoard } from "./pepper.js";
import type { PrLister } from "./prs.js";
import { buildWorkSummary } from "./summary.js";

export type WorkSource = { read(): Promise<WorkSummary> };

export const createWorkSource = (deps: {
  fetchFn: typeof fetch;
  pepperUrl: string;
  pepperWebUrl: string;
  myFactories: string[];
  prs: PrLister;
  now?: () => Date;
}): WorkSource => ({
  read: async () => {
    const [board, prs] = await Promise.all([fetchPepperBoard(deps.fetchFn, deps.pepperUrl), deps.prs.list()]);
    return buildWorkSummary(board, prs, deps.pepperWebUrl, deps.myFactories, (deps.now ?? (() => new Date()))());
  },
});

export const workRoutes =
  (source: WorkSource) =>
  (app: Hono): void => {
    app.get("/work", async (c) => c.json<WorkSummary>(await source.read()));
  };
