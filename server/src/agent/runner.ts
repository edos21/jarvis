import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type HookCallbackMatcher, query } from "@anthropic-ai/claude-agent-sdk";

import { assertAgentAuth } from "../env.js";
import { checkToolAccess } from "./toolGuard.js";

export type AgentRequest<T> = {
  label: string;
  systemPrompt: string;
  prompt: string;
  schema: Record<string, unknown>;
  // Throws when the output breaks the contract.
  parse: (output: unknown) => T;
  model: string;
  maxBudgetUsd: number;
  timeoutMs: number;
  // Read-only tools the agent may use; anything else is denied (dontAsk). None by default.
  tools?: ReadOnlyTool[];
  // The only folders Read, Glob and Grep may touch, checked path by path before every call.
  readableDirs?: string[];
  maxTurns?: number;
  onCost?: (usd: number) => void;
};

export type ReadOnlyTool = "WebSearch" | "WebFetch" | "Read" | "Glob" | "Grep";

export type RunAgent = <T>(req: AgentRequest<T>) => Promise<T>;

const AGENT_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TERM",
  "LANG",
  "TZ",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
]);
const AGENT_ENV_PREFIXES = ["CLAUDE_", "LC_", "XDG_"];

// The SDK replaces the child environment instead of merging it, so this is everything the agent sees.
export const buildAgentEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const agentEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (AGENT_ENV.has(key) || AGENT_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) agentEnv[key] = value;
  }
  agentEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  // Otherwise the account's claude.ai connectors (mail, calendar, docs) load into every agent.
  agentEnv.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return agentEnv;
};

// An empty directory as cwd, so no repo's CLAUDE.md is loaded into the agent. Outside ~/.jarvis on purpose: that folder
// holds the secrets, and a cwd is where tools look by default.
const SANDBOX_DIR = join(tmpdir(), "jarvis-agent-sandbox");

// Every tool call goes through the guard: an agent that reads web pages must never reach ~/.jarvis or other files.
export const toolGuardHooks = (readableDirs: string[]): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> => ({
  PreToolUse: [
    {
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return {};
          const access = checkToolAccess(input.tool_name, input.tool_input, readableDirs);
          return access.allow
            ? {}
            : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: access.reason } };
        },
      ],
    },
  ],
});

// An agent that answers with structured output only; tool-less unless the request lists read-only tools.
export const runAgent: RunAgent = async <T>(req: AgentRequest<T>): Promise<T> => {
  assertAgentAuth();
  mkdirSync(SANDBOX_DIR, { recursive: true });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), req.timeoutMs);
  try {
    for await (const message of query({
      prompt: req.prompt,
      options: {
        systemPrompt: req.systemPrompt,
        model: req.model,
        permissionMode: "dontAsk",
        settingSources: [],
        persistSession: false,
        tools: req.tools ?? [],
        allowedTools: req.tools ?? [],
        additionalDirectories: req.readableDirs ?? [],
        ...(req.tools?.length ? { hooks: toolGuardHooks(req.readableDirs ?? []) } : {}),
        // Not ["*"]: structured output arrives through a tool call.
        disallowedTools: ["mcp__*"],
        outputFormat: { type: "json_schema", schema: req.schema },
        abortController,
        maxTurns: req.maxTurns ?? 3,
        maxBudgetUsd: req.maxBudgetUsd,
        cwd: SANDBOX_DIR,
        env: buildAgentEnv(process.env),
      },
    })) {
      if (message.type !== "result") continue;
      req.onCost?.(message.total_cost_usd);
      if (message.subtype !== "success") throw new Error(`${req.label}: agent stopped with ${message.subtype}`);
      return req.parse(message.structured_output);
    }
    throw new Error(`${req.label}: agent ended without a result`);
  } finally {
    clearTimeout(timer);
  }
};
