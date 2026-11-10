import { execFile } from "node:child_process";

import type { CommandRunner } from "./mac/collect.js";

// No shell: arguments go to the program as they are. stdin is closed at once, so a tool that would stop to ask
// something gets end-of-input instead of waiting until the timeout.
export const commandRunner =
  (timeoutMs: number, env?: Record<string, string>): CommandRunner =>
  (cmd, args) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        cmd,
        args,
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin?.end();
    });

export const runCommand: CommandRunner = commandRunner(60_000);
