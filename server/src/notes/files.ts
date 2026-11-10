import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import type { NoteEntry, NoteSearchHit } from "../../../shared/notes.js";

// Python environments and caches live inside the notes folder (garmin); none of it is a note.
const SKIPPED_DIRS = new Set(["__pycache__", "venv", "node_modules", "site-packages"]);
const MAX_HITS = 30;
const SNIPPET_AROUND = 60;

const skipped = (segment: string): boolean => segment.startsWith(".") || SKIPPED_DIRS.has(segment);

const entryOf = (dir: string, abs: string): NoteEntry => {
  const path = relative(dir, abs).split(sep).join("/");
  const slash = path.lastIndexOf("/");
  return {
    path,
    folder: slash < 0 ? "" : path.slice(0, slash),
    title: path.slice(slash + 1).replace(/\.md$/, ""),
    mtimeMs: statSync(abs).mtimeMs,
  };
};

export const listNotes = (dir: string): NoteEntry[] => {
  const found: NoteEntry[] = [];
  const walk = (current: string): void => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      if (skipped(item.name)) continue;
      const abs = join(current, item.name);
      // Symlinks are not followed: they could point anywhere on the Mac.
      if (item.isDirectory()) walk(abs);
      else if (item.isFile() && item.name.endsWith(".md")) found.push(entryOf(dir, abs));
    }
  };
  if (existsSync(dir)) walk(dir);
  return found.sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title));
};

const inside = (root: string, abs: string): boolean => {
  const rel = relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

// A note's path and where it is on disk, only for a ".md" really inside the notes folder; null for anything else. The
// file itself may not exist yet (a new note), but its folder must.
export const resolveNote = (dir: string, path: unknown): { path: string; abs: string } | null => {
  if (typeof path !== "string" || !path.endsWith(".md") || path.includes("\0") || isAbsolute(path)) return null;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === ".." || skipped(s))) return null;
  const abs = join(dir, ...segments);
  if (!existsSync(dir)) return null;
  const root = realpathSync(dir);
  const parent = dirname(abs);
  if (!existsSync(parent)) return null;
  const real = existsSync(abs) ? realpathSync(abs) : join(realpathSync(parent), segments.at(-1)!);
  if (!inside(root, real)) return null;
  if (existsSync(abs) && !statSync(abs).isFile()) return null;
  return { path, abs };
};

const snippetOf = (content: string, at: number, length: number): string => {
  const start = Math.max(0, at - SNIPPET_AROUND);
  const end = Math.min(content.length, at + length + SNIPPET_AROUND);
  const text = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < content.length ? "…" : ""}`;
};

// Name matches first, then content. The match is found on the text as written, not a lowercased copy, whose length
// can differ ("İ"), so the snippet lands on it.
export const searchNotes = async (dir: string, query: string): Promise<NoteSearchHit[]> => {
  const q = query.trim();
  if (!q) return [];
  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  const byName: NoteSearchHit[] = [];
  const byContent: NoteSearchHit[] = [];
  for (const note of listNotes(dir)) {
    if (pattern.test(note.path)) {
      byName.push({ ...note, snippet: null });
      continue;
    }
    const content = await readFile(join(dir, ...note.path.split("/")), "utf8");
    const match = pattern.exec(content);
    if (match) byContent.push({ ...note, snippet: snippetOf(content, match.index, match[0].length) });
  }
  return [...byName, ...byContent].slice(0, MAX_HITS);
};
