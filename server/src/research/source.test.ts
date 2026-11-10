import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ResearchDetail } from "../../../shared/research.js";
import type { AgentRequest, RunAgent } from "../agent/runner.js";
import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { researchRoutes } from "./routes.js";
import { SatelliteAlreadyDone, ResearchBusy, createResearchSource } from "./source.js";
import { createResearchStore } from "./store.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// An agent that waits until the test lets it answer (or fail).
const controlledAgent = () => {
  const requests: AgentRequest<unknown>[] = [];
  const pending: {
    resolve: (markdown: string, levels?: unknown, jarvisNote?: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const runAgent = (<T>(req: AgentRequest<T>): Promise<T> => {
    requests.push(req as AgentRequest<unknown>);
    return new Promise<T>((resolve, reject) => {
      pending.push({
        resolve: (markdown, levels, jarvisNote) => {
          req.onCost?.(0.42);
          resolve(req.parse({ markdown, levels, jarvisNote }));
        },
        reject,
      });
    });
  }) as RunAgent;
  return { runAgent, requests, pending };
};

const setup = (opts: { satelliteNote?: string } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-inv-"));
  writeFileSync(join(dir, "Satellite Prompt Mensual.md"), opts.satelliteNote ?? "# Satellite\n\n## Notas\n\nx\n\n## PROMPT\n\nHacé un análisis de satellite picks.\n");
  const agent = controlledAgent();
  const store = createResearchStore(openDb(":memory:"));
  const source = createResearchSource({ store, runAgent: agent.runAgent, investmentsDir: dir, now: () => new Date(2026, 10, 3, 10) });
  const app = createApp({ tailnetHost: TAILNET, routes: [researchRoutes(source)] });
  const post = (path: string, body: unknown, base = LOCAL) =>
    app.request(`${base}/api${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  return { dir, agent, store, source, app, post };
};

describe("research", () => {
  it("investigate runs in the background with the read-only web tools and the notes dir", async () => {
    const { source, agent, dir } = setup();
    const run = source.start({ kind: "investigate", subject: { type: "ticker", symbol: "CRDO", context: "-7,2% hoy" } });
    expect(run).toMatchObject({ status: "running", title: "Investigar CRDO" });
    expect(agent.requests[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      maxBudgetUsd: 1,
      tools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep"],
      readableDirs: [dir],
    });
    expect(agent.requests[0]?.prompt).toContain("CRDO (-7,2% hoy)");
    agent.pending[0]?.resolve("## Qué pasó\n\nCayó.");
    await flush();
    expect(source.get(run.id)).toMatchObject({ status: "done", markdown: "## Qué pasó\n\nCayó.", costUsd: 0.42, suggestedLevels: [] });
  });

  it("keeps the levels the report suggests and drops the ones that do not validate", async () => {
    const { source, agent } = setup();
    const run = source.start({ kind: "investigate", subject: { type: "ticker", symbol: "CRDO" } });
    expect(agent.requests[0]?.systemPrompt).toContain("take_profit");
    agent.pending[0]?.resolve("## Qué pasó", [
      { symbol: "crdo", direction: "below", price: 148, kind: "stop", why: " Rompe el soporte de la tesis " },
      { symbol: "CRDO", direction: "above", price: -1, kind: "take_profit", why: "x" },
      { symbol: "CRDO", direction: "sideways", price: 260, kind: "alert", why: "x" },
      { symbol: "CRDO", direction: "above", price: 260, kind: "sell", why: "x" },
    ]);
    await flush();
    expect(source.get(run.id)?.suggestedLevels).toEqual([
      { symbol: "CRDO", direction: "below", price: 148, kind: "stop", why: "Rompe el soporte de la tesis" },
    ]);
    expect(source.list().runs[0]).not.toHaveProperty("suggestedLevels");
  });

  it("the satellite pick uses the owner's PROMPT section as written", () => {
    const { source, agent } = setup();
    source.start({ kind: "satellite", subject: { type: "satellite" } });
    expect(agent.requests[0]).toMatchObject({ model: "claude-opus-5-5", maxBudgetUsd: 5, maxTurns: 60 });
    expect(agent.requests[0]?.prompt).toContain("Hacé un análisis de satellite picks.");
    expect(agent.requests[0]?.prompt).not.toContain("## Notas");
  });

  it("a second run of the same kind while one is running is refused", () => {
    const { source } = setup();
    source.start({ kind: "satellite", subject: { type: "satellite" } });
    expect(() => source.start({ kind: "satellite", subject: { type: "satellite" } })).toThrow(ResearchBusy);
    expect(() => source.start({ kind: "investigate", subject: { type: "ticker", symbol: "CRDO" } })).not.toThrow();
  });

  it("this month's satellite pick already in the notes asks for confirmation", () => {
    const { source, dir } = setup();
    writeFileSync(join(dir, "satellite-picks-noviembre-2026.md"), "ya");
    expect(source.list().satelliteThisMonth).toBe("satellite-picks-noviembre-2026.md");
    expect(() => source.start({ kind: "satellite", subject: { type: "satellite" } })).toThrow(SatelliteAlreadyDone);
    expect(() => source.start({ kind: "satellite", subject: { type: "satellite" }, confirm: true })).not.toThrow();
  });

  it("keeps Jarvis's note next to the report, and never saves it to the notes", async () => {
    const { source, agent, dir } = setup();
    const run = source.start({ kind: "investigate", subject: { type: "ticker", symbol: "CRDO" } });
    expect(agent.requests[0]?.systemPrompt).toContain("jarvisNote");
    agent.pending[0]?.resolve("Informe.", [], "  Si me permite, señor: el mercado exagera.  ");
    await flush();
    expect(source.get(run.id)?.jarvisNote).toBe("Si me permite, señor: el mercado exagera.");
    const saved = source.save(run.id).savedPath ?? "";
    const file = readFileSync(join(dir, "investigaciones", saved.split("/").at(-1) ?? ""), "utf8");
    expect(file).toContain("Informe.");
    expect(file).not.toContain("el mercado exagera");
  });

  it("an empty or missing note is no note", async () => {
    const { source, agent } = setup();
    const empty = source.start({ kind: "investigate", subject: { type: "ticker", symbol: "CRDO" } });
    agent.pending[0]?.resolve("Informe.", [], "   ");
    await flush();
    expect(source.get(empty.id)?.jarvisNote).toBeNull();
    const missing = source.start({ kind: "investigate", subject: { type: "ticker", symbol: "VWCE" } });
    agent.pending[1]?.resolve("Informe.");
    await flush();
    expect(source.get(missing.id)?.jarvisNote).toBeNull();
  });

  it("a failed agent stores the error, not a 500", async () => {
    const { source, agent } = setup();
    const run = source.start({ kind: "investigate", subject: { type: "news", title: "Algo", url: "https://x.example/a" } });
    agent.pending[0]?.reject(new Error("investigate: agent stopped with error_max_budget_usd"));
    await flush();
    expect(source.get(run.id)).toMatchObject({ status: "failed", error: "investigate: agent stopped with error_max_budget_usd" });
  });

  it("save never overwrites", async () => {
    const { source, agent, dir } = setup();
    const run = source.start({ kind: "investigate", subject: { type: "ticker", symbol: "CRDO" } });
    agent.pending[0]?.resolve("Informe.");
    await flush();
    const first = source.save(run.id);
    const second = source.save(run.id);
    expect(first.savedPath).toBe(`${dir.split("/").at(-1)}/investigaciones/2026-11-03-investigar-crdo.md`);
    expect(second.savedPath).toBe(`${dir.split("/").at(-1)}/investigaciones/2026-11-03-investigar-crdo-2.md`);
    expect(readdirSync(join(dir, "investigaciones"))).toHaveLength(2);
    expect(readFileSync(join(dir, "investigaciones", "2026-11-03-investigar-crdo.md"), "utf8")).toContain("Informe.");
  });

  it("a restart fails the runs it left running", () => {
    const db = openDb(":memory:");
    const store = createResearchStore(db);
    const run = store.create({ kind: "investigate", subject: { type: "ticker", symbol: "X" }, title: "t", createdAt: "2026-11-03" });
    createResearchSource({ store, runAgent: controlledAgent().runAgent, investmentsDir: tmpdir() });
    expect(store.get(run.id)).toMatchObject({ status: "failed", error: "Jarvis se reinició antes de que terminara." });
  });
});

describe("research routes", () => {
  it("starts from the phone too, but saving is Mac-only", async () => {
    const { post, agent } = setup();
    const res = await post("/research", { kind: "investigate", subject: { type: "ticker", symbol: "CRDO" } }, `https://${TAILNET}`);
    expect(res.status).toBe(202);
    const run = (await res.json()) as ResearchDetail;
    agent.pending[0]?.resolve("x");
    await flush();
    expect((await post(`/research/${run.id}/save`, {}, `https://${TAILNET}`)).status).toBe(403);
    expect((await post(`/research/${run.id}/save`, {})).status).toBe(200);
  });

  it("refuses a run without a subject and says when one is busy or done this month", async () => {
    const { post, dir } = setup();
    expect((await post("/research", { kind: "investigate", subject: { type: "news", title: "x", url: "javascript:alert(1)" } })).status).toBe(400);
    writeFileSync(join(dir, "satellite-picks-noviembre-2026.md"), "ya");
    const res = await post("/research", { kind: "satellite" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("satellite-picks-noviembre-2026.md");
  });
});
