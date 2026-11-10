import { beforeEach, describe, expect, it, vi } from "vitest";

const seen: { options: Record<string, unknown> }[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: { options: Record<string, unknown> }) => {
    seen.push(args);
    return (async function* () {
      yield { type: "result", subtype: "success", total_cost_usd: 0.12, structured_output: { ok: true } };
    })();
  },
}));

const { runAgent } = await import("./runner.js");

const base = {
  label: "test",
  systemPrompt: "s",
  prompt: "p",
  schema: {},
  parse: (o: unknown) => o,
  model: "claude-haiku-5-5",
  maxBudgetUsd: 0.1,
  timeoutMs: 1000,
};

describe("runAgent", () => {
  beforeEach(() => {
    seen.length = 0;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test";
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("briefing still runs tool-less", async () => {
    await runAgent(base);
    expect(seen[0]?.options).toMatchObject({ tools: [], allowedTools: [], additionalDirectories: [], maxTurns: 3, permissionMode: "dontAsk", settingSources: [] });
  });

  it("runner passes only the read-only web tools and the notes dir, and reports the cost", async () => {
    let cost = 0;
    await runAgent({
      ...base,
      tools: ["WebSearch", "WebFetch", "Read"],
      readableDirs: ["/tmp"],
      maxTurns: 40,
      onCost: (usd) => {
        cost = usd;
      },
    });
    expect(seen[0]?.options).toMatchObject({
      tools: ["WebSearch", "WebFetch", "Read"],
      allowedTools: ["WebSearch", "WebFetch", "Read"],
      additionalDirectories: ["/tmp"],
      maxTurns: 40,
      permissionMode: "dontAsk",
    });
    expect(cost).toBe(0.12);
  });

  it("with tools, a guard hook denies reading outside the allowed folders", async () => {
    await runAgent({ ...base, tools: ["Read"], readableDirs: ["/tmp"] });
    const hooks = seen[0]?.options.hooks as { PreToolUse: { hooks: ((input: unknown) => Promise<unknown>)[] }[] };
    const guard = hooks.PreToolUse[0]!.hooks[0]!;
    const ask = (file_path: string) =>
      guard({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path }, tool_use_id: "t" });
    expect(await ask(`${process.env.HOME}/.jarvis/env`)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(await ask("/tmp")).toEqual({});
  });

  it("the briefing gets no hooks and no folders", async () => {
    await runAgent(base);
    expect(seen[0]?.options.hooks).toBeUndefined();
  });
});
