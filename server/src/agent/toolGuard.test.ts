import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkToolAccess } from "./toolGuard.js";

const setup = () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "jarvis-guard-")));
  const notes = join(base, "notes", "Inversiones");
  const secrets = join(base, "dot-jarvis");
  mkdirSync(notes, { recursive: true });
  mkdirSync(secrets);
  writeFileSync(join(notes, "cartera.md"), "x");
  writeFileSync(join(secrets, "env"), "JARVIS_IBKR_FLEX_TOKEN=secret");
  // A link inside the allowed folder that points out of it.
  symlinkSync(join(secrets, "env"), join(notes, "sneaky.md"));
  return { notes, secrets, roots: [notes] };
};

describe("checkToolAccess", () => {
  it("allows reading inside the investments folder", () => {
    const { notes, roots } = setup();
    expect(checkToolAccess("Read", { file_path: join(notes, "cartera.md") }, roots).allow).toBe(true);
    expect(checkToolAccess("Read", { file_path: join(notes, "nuevo.md") }, roots).allow).toBe(true);
    expect(checkToolAccess("Grep", { pattern: "VWCE", path: notes }, roots).allow).toBe(true);
    expect(checkToolAccess("Glob", { pattern: "satellite-picks-*.md", path: notes }, roots).allow).toBe(true);
  });

  it("denies reading the secrets, other folders, relative paths and symlinks that leave the folder", () => {
    const { notes, secrets, roots } = setup();
    expect(checkToolAccess("Read", { file_path: join(secrets, "env") }, roots).allow).toBe(false);
    expect(checkToolAccess("Read", { file_path: join(notes, "..", "..", "dot-jarvis", "env") }, roots).allow).toBe(false);
    expect(checkToolAccess("Read", { file_path: "cartera.md" }, roots).allow).toBe(false);
    expect(checkToolAccess("Read", { file_path: join(notes, "sneaky.md") }, roots).allow).toBe(false);
    expect(checkToolAccess("Read", {}, roots).allow).toBe(false);
  });

  it("Glob and Grep need an explicit path inside the folder and a pattern that stays in it", () => {
    const { notes, secrets, roots } = setup();
    expect(checkToolAccess("Grep", { pattern: "TOKEN" }, roots).allow).toBe(false);
    expect(checkToolAccess("Grep", { pattern: "TOKEN", path: secrets }, roots).allow).toBe(false);
    expect(checkToolAccess("Glob", { pattern: "**/*" }, roots).allow).toBe(false);
    expect(checkToolAccess("Glob", { pattern: "/Users/**/env", path: notes }, roots).allow).toBe(false);
    expect(checkToolAccess("Glob", { pattern: "../../**", path: notes }, roots).allow).toBe(false);
    expect(checkToolAccess("Grep", { pattern: "x", path: notes, glob: "../**" }, roots).allow).toBe(false);
  });

  it("web tools and the final structured answer are allowed; anything else is denied", () => {
    const { roots } = setup();
    expect(checkToolAccess("StructuredOutput", { markdown: "x" }, roots).allow).toBe(true);
    expect(checkToolAccess("WebSearch", { query: "CRDO earnings" }, roots).allow).toBe(true);
    expect(checkToolAccess("WebFetch", { url: "https://example.com" }, roots).allow).toBe(true);
    for (const tool of ["Bash", "Write", "Edit", "Agent", "mcp__x__y"]) {
      expect(checkToolAccess(tool, {}, roots).allow).toBe(false);
    }
  });
});
