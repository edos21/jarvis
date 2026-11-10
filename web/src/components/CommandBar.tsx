import { useEffect, useMemo, useRef, useState } from "react";

import { useCompleteTask, useIsRemote, useMailSelectionAction, useMarkPaid, useToday } from "@/lib/api";
import { ROUTES, go } from "@/lib/route";

type Command = { id: string; label: string; hint: string; run: () => void };

export const useCommandBar = (): [boolean, (open: boolean) => void] => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
};

export const CommandBar = ({ onClose, onToggleTheme }: { onClose: () => void; onToggleTheme: () => void }) => {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { data } = useToday();
  const markPaid = useMarkPaid();
  const archive = useMailSelectionAction();
  const complete = useCompleteTask();
  const remote = useIsRemote();

  const commands = useMemo<Command[]>(() => {
    const pepperUrl = data?.side.work?.pepper.boardUrl;
    const list: Command[] = [
      ...ROUTES.filter((r) => !(remote && r.macOnly)).map((r) => ({ id: `go:${r.id}`, label: `Ir a ${r.label}`, hint: "Sección", run: () => go(r.id) })),
      { id: "theme", label: "Cambiar tema", hint: "Claro u oscuro", run: onToggleTheme },
    ];
    if (pepperUrl && !remote) {
      list.push({ id: "pepper", label: "Abrir Pepper", hint: "Tablero", run: () => window.open(pepperUrl, "_blank") });
    }
    // Today's cards, as things to do without leaving the keyboard: the same actions their buttons run.
    for (const card of data?.cards ?? []) {
      for (const action of card.actions) {
        if (action.kind === "mark_paid") {
          list.push({
            id: `paid:${action.paymentId}:${action.period}`,
            label: `Marcar pagado: ${card.title.replace(/^Pagar /, "").split(" · ")[0]}`,
            hint: "Pagos",
            run: () => markPaid.mutate({ paymentId: action.paymentId, period: action.period }),
          });
        } else if (action.kind === "complete_task") {
          list.push({
            id: `task:${action.taskId}`,
            label: `Completar tarea: ${card.title}`,
            hint: "Tareas",
            run: () => complete.mutate({ account: action.account, listId: action.listId, taskId: action.taskId }),
          });
        } else if (action.kind === "archive_mail") {
          list.push({
            id: `mail:${action.messageId}`,
            label: `Archivar: ${card.title}`,
            hint: "Correo",
            run: () => archive.mutate({ account: action.account, ids: [action.messageId], action: "archive" }),
          });
        }
      }
    }
    return list;
  }, [data, markPaid, complete, archive, onToggleTheme, remote]);

  const q = query.trim().toLowerCase();
  const matches = commands.filter((c) => c.label.toLowerCase().includes(q));

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-black/30 px-4 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Comandos"
        className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          id="command-query"
          aria-label="Buscar un comando"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-body text-ink placeholder:text-muted focus-visible:[outline-offset:-2px]"
          placeholder="Busca una sección o una acción…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, matches.length - 1));
            if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
            if (e.key === "Enter") run(matches[index]);
          }}
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 && <li className="px-4 py-3 text-body text-muted">No hay comandos con ese nombre.</li>}
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-body ${i === index ? "bg-highlight/40" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(c)}
              >
                <span>{c.label}</span>
                <span className="text-meta text-muted">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
