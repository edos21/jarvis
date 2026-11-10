// A note of the notes folder; path is relative to it, always with "/" and ending in ".md".
export type NoteEntry = { path: string; folder: string; title: string; mtimeMs: number };

// root: the folder on disk, which is how Obsidian finds the vault a note belongs to.
export type NotesList = { root: string; notes: NoteEntry[] };

export type NoteFile = { path: string; content: string; mtimeMs: number };

export type NoteSearchHit = NoteEntry & { snippet: string | null };

// What is saved is a note as it was read, with new content.
export type NoteSave = NoteFile;

export type NoteCreate = { folder: string; name: string };
