import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { NoteFile, NotesList } from "../../../shared/notes.js";
import { createApp } from "../app.js";
import { listNotes, resolveNote, searchNotes } from "./files.js";
import { backupPrefix, notesRoutes } from "./routes.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-notes-"));
  const dir = join(root, "notes");
  const outside = join(root, "secret");
  for (const d of ["Inversiones", "fitness/garmin/.venv/lib", "fitness/garmin/venv/site-packages/x", ".obsidian", outside]) {
    mkdirSync(d.startsWith("/") ? d : join(dir, d), { recursive: true });
  }
  writeFileSync(join(dir, "Inversiones", "cartera.md"), "# Cartera\n\nCRDO con stop en 148.\n");
  writeFileSync(join(dir, "Inversiones", "perfil.md"), "Perfil del inversor");
  writeFileSync(join(dir, "fitness", "rutina.md"), "Lunes: piernas");
  writeFileSync(join(dir, "fitness", "garmin", ".venv", "lib", "LICENSE.md"), "MIT");
  writeFileSync(join(dir, "fitness", "garmin", "venv", "site-packages", "x", "README.md"), "pip");
  writeFileSync(join(dir, ".obsidian", "workspace.md"), "x");
  writeFileSync(join(dir, "Inversiones", "datos.txt"), "no es nota");
  writeFileSync(join(outside, "env.md"), "TOKEN=1");
  symlinkSync(join(outside, "env.md"), join(dir, "Inversiones", "fuga.md"));
  symlinkSync(outside, join(dir, "afuera"));
  const backupsDir = join(root, "backups");
  const trashDir = join(root, "Trash");
  const app = createApp({ tailnetHost: TAILNET, routes: [notesRoutes({ notesDir: dir, backupsDir, trashDir })] });
  const send = (method: string, path: string, body?: unknown, base = LOCAL) =>
    app.request(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { dir, backupsDir, trashDir, send };
};

describe("notes files", () => {
  it("lists only real notes: no hidden folders, environments, symlinks or other files", () => {
    const { dir } = setup();
    expect(listNotes(dir).map((n) => n.path)).toEqual(["fitness/rutina.md", "Inversiones/cartera.md", "Inversiones/perfil.md"]);
    expect(listNotes(dir)[1]).toMatchObject({ folder: "Inversiones", title: "cartera" });
  });

  it("resolves a note only inside the folder", () => {
    const { dir } = setup();
    expect(resolveNote(dir, "Inversiones/cartera.md")).toEqual({ path: "Inversiones/cartera.md", abs: join(dir, "Inversiones", "cartera.md") });
    expect(resolveNote(dir, "Inversiones/nueva.md")?.abs).toBe(join(dir, "Inversiones", "nueva.md"));
    for (const bad of ["../secret/env.md", "/etc/hosts.md", "Inversiones/datos.txt", ".obsidian/workspace.md", "Inversiones/fuga.md", "afuera/env.md", "Inversiones//cartera.md", "nope/x.md", 3]) {
      expect(resolveNote(dir, bad)).toBeNull();
    }
  });

  it("searches names first, then content with a snippet", async () => {
    const { dir } = setup();
    expect((await searchNotes(dir, "perfil")).map((h) => [h.path, h.snippet])).toEqual([
      ["Inversiones/perfil.md", null],
    ]);
    const [hit] = await searchNotes(dir, "STOP");
    expect(hit?.path).toBe("Inversiones/cartera.md");
    expect(hit?.snippet).toContain("CRDO con stop en 148.");
    expect(await searchNotes(dir, "  ")).toEqual([]);
  });
});

describe("note backups", () => {
  it("names each note's backups so two paths never share them", () => {
    expect(backupPrefix("Inversiones/cartera.md")).toBe("note-Inversiones_2f_cartera");
    expect(backupPrefix("año.md")).not.toBe(backupPrefix("a o.md"));
    expect(backupPrefix("a_b.md")).not.toBe(backupPrefix("a/b.md"));
  });

  it("finds the match where it is written, even after characters that lowercase longer", async () => {
    const { dir } = setup();
    writeFileSync(join(dir, "fitness", "viaje.md"), "İİİİ viaje a Estambul con rutina de piernas");
    const [hit] = await searchNotes(dir, "estambul");
    expect(hit?.snippet).toContain("Estambul");
  });
});

describe("notes routes", () => {
  it("reads and saves a note, with a backup of the previous version", async () => {
    const { dir, backupsDir, send } = setup();
    const list = (await (await send("GET", "/notes")).json()) as NotesList;
    expect(list.root).toBe(dir);
    const note = (await (await send("GET", "/notes/file?path=Inversiones/cartera.md")).json()) as NoteFile;
    const saved = await send("PUT", "/notes/file", { path: note.path, content: "# Nueva", mtimeMs: note.mtimeMs });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(dir, "Inversiones", "cartera.md"), "utf8")).toBe("# Nueva");
    const [backup] = readdirSync(backupsDir);
    expect(backup).toMatch(/^note-Inversiones_2f_cartera-/);
  });

  it("does not overwrite a note changed outside Jarvis", async () => {
    const { dir, send } = setup();
    const note = (await (await send("GET", "/notes/file?path=fitness/rutina.md")).json()) as NoteFile;
    utimesSync(join(dir, "fitness", "rutina.md"), new Date(), new Date(note.mtimeMs + 5000));
    const res = await send("PUT", "/notes/file", { path: note.path, content: "pisado", mtimeMs: note.mtimeMs });
    expect(res.status).toBe(409);
    expect(readFileSync(join(dir, "fitness", "rutina.md"), "utf8")).toBe("Lunes: piernas");
  });

  it("creates a new note once and refuses names outside the folder", async () => {
    const { dir, send } = setup();
    expect((await send("POST", "/notes/file", { folder: "Inversiones", name: "ideas" })).status).toBe(201);
    expect(readFileSync(join(dir, "Inversiones", "ideas.md"), "utf8")).toBe("");
    expect((await send("POST", "/notes/file", { folder: "Inversiones", name: "ideas.md" })).status).toBe(409);
    expect((await send("POST", "/notes/file", { folder: "..", name: "x" })).status).toBe(400);
    expect((await send("POST", "/notes/file", { folder: "Inversiones", name: "a/b" })).status).toBe(400);
  });

  it("deletes to the Trash, never a note changed since I opened it", async () => {
    const { dir, trashDir, send } = setup();
    const note = (await (await send("GET", "/notes/file?path=fitness/rutina.md")).json()) as NoteFile;
    expect((await send("DELETE", `/notes/file?path=fitness/rutina.md&mtimeMs=${note.mtimeMs - 1}`)).status).toBe(409);
    expect((await send("DELETE", `/notes/file?path=fitness/rutina.md&mtimeMs=${note.mtimeMs}`)).status).toBe(200);
    expect(existsSync(join(dir, "fitness", "rutina.md"))).toBe(false);
    expect(readFileSync(join(trashDir, "rutina.md"), "utf8")).toBe("Lunes: piernas");
    expect((await send("DELETE", "/notes/file?path=../secret/env.md&mtimeMs=0")).status).toBe(404);
    expect((await send("DELETE", `/notes/file?path=Inversiones/cartera.md&mtimeMs=0`, undefined, `https://${TAILNET}`)).status).toBe(403);
  });

  it("a Trash it cannot reach is a clear error and the note stays", async () => {
    const { dir, trashDir, send } = setup();
    writeFileSync(trashDir, "not a folder");
    const note = (await (await send("GET", "/notes/file?path=fitness/rutina.md")).json()) as NoteFile;
    const res = await send("DELETE", `/notes/file?path=fitness/rutina.md&mtimeMs=${note.mtimeMs}`);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("Papelera");
    expect(existsSync(join(dir, "fitness", "rutina.md"))).toBe(true);
  });

  it("refuses a path outside the notes and everything from the phone", async () => {
    const { send } = setup();
    expect((await send("GET", "/notes/file?path=../secret/env.md")).status).toBe(404);
    expect((await send("GET", "/notes/file?path=Inversiones/fuga.md")).status).toBe(404);
    expect((await send("GET", "/notes", undefined, `https://${TAILNET}`)).status).toBe(403);
    expect((await send("GET", "/notes/file?path=Inversiones/cartera.md", undefined, `https://${TAILNET}`)).status).toBe(403);
  });
});
