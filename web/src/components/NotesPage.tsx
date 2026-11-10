import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import type { NoteEntry, NoteFile } from "../../../shared/notes";
import { ApiError, useCreateNote, useDeleteNote, useNote, useNoteSearch, useNotes, useSaveNote } from "@/lib/api";
import { dateTimeOf } from "@/lib/format";
import { go, useRouteParam, useUnsavedGuard } from "@/lib/route";
import { Button, LinkButton, MutationButton, fieldClass } from "./Button";
import { Markdown } from "./Markdown";
import { StatusText } from "./Status";

// CodeMirror is most of a megabyte: it loads the first time a note is edited, not with the app.
const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

// By full path, not vault name: two vaults can share a name, and Obsidian opens the one that holds the file.
const obsidianUrl = (root: string, path: string): string => `obsidian://open?path=${encodeURIComponent(`${root}/${path}`)}`;

// Searching reads every note: wait until typing pauses.
const useDebounced = (value: string, ms: number): string => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
};

const NoteLink = ({ note, active, snippet }: { note: NoteEntry; active: boolean; snippet?: string | null }) => (
  <li>
    <button
      type="button"
      onClick={() => go("notas", note.path)}
      aria-current={active ? "true" : undefined}
      className={`grid w-full gap-0.5 rounded-md px-3 py-1.5 text-left text-body ${active ? "bg-highlight" : "hover:bg-surface"}`}
    >
      <span className="truncate">{note.title}</span>
      {snippet !== undefined && <span className="truncate text-meta text-muted">{snippet ?? note.folder}</span>}
    </button>
  </li>
);

const NewNote = ({ folders }: { folders: string[] }) => {
  const create = useCreateNote();
  const [folder, setFolder] = useState(folders[0] ?? "");
  const [name, setName] = useState("");
  return (
    <form
      className="grid gap-2 rounded-lg border border-line px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ folder, name }, { onSuccess: (note) => (setName(""), go("notas", note.path)) });
      }}
    >
      <select aria-label="Carpeta" className={fieldClass} value={folder} onChange={(e) => setFolder(e.target.value)}>
        {folders.map((f) => (
          <option key={f} value={f}>
            {f || "(raíz)"}
          </option>
        ))}
      </select>
      <input aria-label="Nombre" className={fieldClass} placeholder="Nombre de la nota" value={name} onChange={(e) => setName(e.target.value)} required />
      <MutationButton mutation={create} type="submit">
        Crear nota
      </MutationButton>
    </form>
  );
};

const NoteList = ({ notes, selected }: { notes: NoteEntry[]; selected: string | null }) => {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useNoteSearch(useDebounced(query.trim(), 250));
  const folders = useMemo(() => [...new Set(notes.map((n) => n.folder))], [notes]);
  const searching = query.trim().length >= 2;
  return (
    <div className="grid content-start gap-3">
      <input type="search" aria-label="Buscar en tus notas" className={fieldClass} placeholder="Buscar en tus notas" value={query} onChange={(e) => setQuery(e.target.value)} />
      {searching ? (
        <ul className="grid gap-0.5">
          {search.data?.length === 0 && <li className="px-3 text-body text-muted">Nada con "{query.trim()}".</li>}
          {search.data?.map((hit) => (
            <NoteLink key={hit.path} note={hit} active={hit.path === selected} snippet={hit.snippet} />
          ))}
        </ul>
      ) : (
        folders.map((folder) => (
          <details key={folder} open className="grid gap-0.5">
            <summary className="cursor-pointer px-1 text-meta font-medium text-muted">{folder || "Raíz"}</summary>
            <ul className="grid gap-0.5">
              {notes
                .filter((n) => n.folder === folder)
                .map((note) => (
                  <NoteLink key={note.path} note={note} active={note.path === selected} />
                ))}
            </ul>
          </details>
        ))
      )}
      {creating ? <NewNote folders={folders} /> : <Button onClick={() => setCreating(true)}>Nueva nota</Button>}
    </div>
  );
};

const Editor = ({ note, onDone }: { note: NoteFile; onDone: () => void }) => {
  const save = useSaveNote();
  const reload = useNote(note.path);
  const [draft, setDraft] = useState(note.content);
  useUnsavedGuard(draft !== note.content && !save.isSuccess);
  // The version the draft started from: saving over a newer one is only done when I choose to.
  const [base] = useState(note.mtimeMs);
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  const submit = (mtimeMs: number) => save.mutate({ path: note.path, content: draft, mtimeMs }, { onSuccess: onDone });
  return (
    <div className="grid gap-3">
      <Suspense fallback={<p className="text-muted">Abriendo el editor…</p>}>
        <MarkdownEditor label="Contenido de la nota" value={draft} onChange={setDraft} />
      </Suspense>
      {conflict ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning px-3 py-2 text-body">
          <StatusText severity="warning" className="flex-1">
            La nota cambió fuera de Jarvis (¿Obsidian?) mientras la editabas.
          </StatusText>
          <Button onClick={() => void reload.refetch().then(() => onDone())}>Descartar lo mío y ver la nueva</Button>
          <Button
            variant="danger"
            onClick={() =>
              void reload.refetch().then(({ data }) => data && submit(data.mtimeMs))
            }
          >
            Guardar igual
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <MutationButton mutation={save} variant="primary" onClick={() => submit(base)}>
            Guardar
          </MutationButton>
          <Button onClick={onDone}>Cancelar</Button>
          <span className="text-meta text-muted">Se guarda una copia de la versión anterior en ~/.jarvis/backups.</span>
        </div>
      )}
    </div>
  );
};

const NoteView = ({ path, root }: { path: string; root: string }) => {
  const { data: note, error } = useNote(path);
  const remove = useDeleteNote();
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [path]);
  if (error) return <p className="text-critical">No pude abrir la nota: {error.message}</p>;
  if (!note) return <p className="text-muted">Abriendo…</p>;
  return (
    <article className="grid content-start gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[24px] leading-tight">{path.split("/").at(-1)?.replace(/\.md$/, "")}</h2>
          <p className="text-meta text-muted">
            {path} · {dateTimeOf(new Date(note.mtimeMs).toISOString())}
          </p>
        </div>
        {!editing && (
          <>
            <Button variant="primary" onClick={() => setEditing(true)}>
              Editar
            </Button>
            <LinkButton href={obsidianUrl(root, path)} newTab={false}>
              Abrir en Obsidian
            </LinkButton>
            <MutationButton
              mutation={remove}
              variant="danger"
              onClick={() => {
                if (window.confirm(`¿Mandar "${note.path}" a la Papelera? Se recupera desde Finder.`)) {
                  remove.mutate(note, { onSuccess: () => go("notas") });
                }
              }}
            >
              Borrar
            </MutationButton>
          </>
        )}
      </header>
      {editing ? (
        <Editor key={path} note={note} onDone={() => setEditing(false)} />
      ) : note.content.trim() ? (
        <Markdown>{note.content}</Markdown>
      ) : (
        <p className="text-muted">Nota vacía. Usa "Editar" para escribir.</p>
      )}
    </article>
  );
};

export const NotesPage = () => {
  const selected = useRouteParam();
  const { data, error } = useNotes();
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[18rem_1fr]">
      <section className="grid content-start gap-3">
        <h1 className="font-serif text-[28px] leading-tight">Notas</h1>
        {error && <p className="text-critical">{error.message}</p>}
        {data && <NoteList notes={data.notes} selected={selected} />}
      </section>
      <section className="min-w-0">
        {selected && data ? (
          <NoteView path={selected} root={data.root} />
        ) : (
          <p className="text-muted">Elige una nota o búscala.</p>
        )}
      </section>
    </main>
  );
};
