import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import type { Hono } from "hono";

import type { NoteCreate, NoteFile, NoteSave, NoteSearchHit, NotesList } from "../../../shared/notes.js";
import { type ApiError, macOnly } from "../app.js";
import { freeName, safeWrite, writeNew } from "../files.js";
import { listNotes, resolveNote, searchNotes } from "./files.js";

const MAC_ONLY = "Las notas solo se abren desde la Mac.";
const NOT_A_NOTE = "Esa nota no existe o está fuera de la carpeta de notas.";
const BACKUPS_PER_NOTE = 20;

// A note's backups are named after its path, so each one keeps its own history. Every character outside [A-Za-z0-9-]
// becomes "_<hex>_" ("_" included), so two paths never share a name: "año" and "a o" stay apart.
export const backupPrefix = (path: string): string =>
  `note-${path.replace(/\.md$/, "").replace(/[^A-Za-z0-9-]/gu, (ch) => `_${ch.codePointAt(0)!.toString(16)}_`)}`;

const noteFile = (path: string, abs: string): NoteFile => ({ path, content: readFileSync(abs, "utf8"), mtimeMs: statSync(abs).mtimeMs });

export const notesRoutes =
  (deps: { notesDir: string; backupsDir: string; trashDir: string; now?: () => Date }) =>
  (app: Hono): void => {
    const now = deps.now ?? (() => new Date());
    macOnly(app, "/notes", MAC_ONLY);

    app.get("/notes", (c) => c.json<NotesList>({ root: deps.notesDir, notes: listNotes(deps.notesDir) }));

    app.get("/notes/search", async (c) => c.json<NoteSearchHit[]>(await searchNotes(deps.notesDir, c.req.query("q") ?? "")));

    app.get("/notes/file", (c) => {
      const note = resolveNote(deps.notesDir, c.req.query("path"));
      if (!note) return c.json<ApiError>({ error: NOT_A_NOTE }, 404);
      try {
        return c.json<NoteFile>(noteFile(note.path, note.abs));
      } catch {
        return c.json<ApiError>({ error: NOT_A_NOTE }, 404);
      }
    });

    app.put("/notes/file", async (c) => {
      const body = await c.req.json<Partial<NoteSave>>().catch((): Partial<NoteSave> => ({}));
      const note = resolveNote(deps.notesDir, body.path);
      if (!note || typeof body.content !== "string" || typeof body.mtimeMs !== "number") {
        return c.json<ApiError>({ error: NOT_A_NOTE }, 400);
      }
      const result = safeWrite({
        file: note.abs,
        content: body.content,
        backupsDir: deps.backupsDir,
        backupPrefix: backupPrefix(note.path),
        keep: BACKUPS_PER_NOTE,
        now: now(),
        expectedMtimeMs: body.mtimeMs,
      });
      switch (result.status) {
        case "ok":
          return c.json<NoteFile>({ path: note.path, content: body.content, mtimeMs: result.mtimeMs });
        case "changed":
          return c.json<ApiError>({ error: "La nota cambió fuera de Jarvis." }, 409);
        case "failed":
          return c.json<ApiError>({ error: result.error }, 500);
      }
    });

    // To the macOS Trash, not gone: it comes back from Finder. Only the version I was looking at is thrown away.
    app.delete("/notes/file", (c) => {
      const note = resolveNote(deps.notesDir, c.req.query("path"));
      if (!note || !existsSync(note.abs)) return c.json<ApiError>({ error: NOT_A_NOTE }, 404);
      if (statSync(note.abs).mtimeMs !== Number(c.req.query("mtimeMs"))) {
        return c.json<ApiError>({ error: "La nota cambió fuera de Jarvis; ábrela de nuevo antes de borrarla." }, 409);
      }
      try {
        mkdirSync(deps.trashDir, { recursive: true });
        renameSync(note.abs, join(deps.trashDir, freeName(deps.trashDir, basename(note.abs))));
      } catch (error) {
        // EPERM without access to the Trash, EXDEV with the notes on another disk: the note stays where it was.
        const code = (error as NodeJS.ErrnoException).code ?? "error";
        return c.json<ApiError>({ error: `No pude mandar la nota a la Papelera (${code}); bórrala desde Obsidian o Finder.` }, 500);
      }
      return c.json({ ok: true });
    });

    app.post("/notes/file", async (c) => {
      const body = await c.req.json<Partial<NoteCreate>>().catch((): Partial<NoteCreate> => ({}));
      const name = typeof body.name === "string" ? body.name.trim().replace(/\.md$/, "") : "";
      const folder = typeof body.folder === "string" ? body.folder.replace(/^\/+|\/+$/g, "") : "";
      if (!name || name.includes("/")) return c.json<ApiError>({ error: "Falta un nombre válido para la nota." }, 400);
      const path = folder ? `${folder}/${name}.md` : `${name}.md`;
      const note = resolveNote(deps.notesDir, path);
      if (!note) return c.json<ApiError>({ error: "Esa carpeta no existe dentro de tus notas." }, 400);
      if (!writeNew(note.abs, "")) return c.json<ApiError>({ error: "Ya existe una nota con ese nombre." }, 409);
      return c.json<NoteFile>(noteFile(note.path, note.abs), 201);
    });
  };
