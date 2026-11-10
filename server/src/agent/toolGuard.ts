import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

// StructuredOutput is how the agent hands in its answer (outputFormat); without it no run can finish.
const ALWAYS_ALLOWED = new Set(["WebSearch", "WebFetch", "StructuredOutput"]);

export type ToolAccess = { allow: true } | { allow: false; reason: string };

const deny = (reason: string): ToolAccess => ({ allow: false, reason });

// The real location of a path, following links; for a file that does not exist yet, of its nearest existing parent.
const realLocation = (path: string): string => {
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  return resolve(realpathSync(existing), relative(existing, path));
};

const inside = (path: unknown, roots: string[]): boolean => {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  const real = realLocation(path);
  return roots.some((root) => {
    const rel = relative(realpathSync(root), real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
};

const staysInside = (pattern: unknown): boolean =>
  pattern === undefined || (typeof pattern === "string" && !isAbsolute(pattern) && !pattern.split(/[\\/]/).includes(".."));

// The research agent sees untrusted web pages and headlines and can fetch any URL, so what it may read is checked here,
// path by path, before every tool call: only the investment notes, never ~/.jarvis, ~/.ssh or anything else.
export const checkToolAccess = (tool: string, input: unknown, roots: string[]): ToolAccess => {
  if (ALWAYS_ALLOWED.has(tool)) return { allow: true };
  const args = (input ?? {}) as Record<string, unknown>;
  if (tool === "Read") return inside(args.file_path, roots) ? { allow: true } : deny("Solo puedes leer las notas de inversión.");
  if (tool === "Glob" || tool === "Grep") {
    if (!inside(args.path, roots)) return deny("Indica un path dentro de las notas de inversión.");
    if (tool === "Glob" && !staysInside(args.pattern)) return deny("El patrón tiene que quedar dentro de las notas.");
    if (tool === "Grep" && !staysInside(args.glob)) return deny("El glob tiene que quedar dentro de las notas.");
    return { allow: true };
  }
  return deny(`La herramienta ${tool} no está permitida.`);
};
